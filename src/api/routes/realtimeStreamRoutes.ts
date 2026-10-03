/**
 * Kriya Omnitask — Real-Time SSE Stream Routes (§19 of CLAUDE1.md)
 * Endpoints for Live Event Streaming, Initial Snapshot Backfill, and Gap Self-Healing.
 *
 * SPEC (§19):
 * Endpoint: GET /api/v2/tenants/{id}/stream with tenant-scoped auth.
 * Event Envelope: { seq, ts, tenant_id, type, agent_id, execution_id, payload }
 * Features: Backfill-then-stream, Last-Event-ID reconnection, Sequence integrity, Server-side tenant filtering.
 */

import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../middleware/authMiddleware.js';
import { requirePermission } from '../middleware/rbacMiddleware.js';
import { realtimeStreamHub, RealtimeStreamHub } from '../../realtime/services/realtimeStreamHub.js';
import { RealtimeEventTypeSchema } from '../../realtime/types/realtimeTypes.js';
import { ForbiddenError } from '../../core/errors/errors.js';
import { logger } from '../../core/logger/logger.js';

const PublishEventSchema = z.object({
  type: RealtimeEventTypeSchema,
  agentId: z.string().optional(),
  executionId: z.string().optional(),
  payload: z.record(z.unknown()).optional().default({}),
});

const BackfillQuerySchema = z.object({
  from: z.coerce.number().int().nonnegative(),
  to: z.coerce.number().int().nonnegative(),
  limit: z.coerce.number().int().positive().optional().default(200),
});

export const realtimeStreamRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const hub: RealtimeStreamHub = realtimeStreamHub;

  // 1. Initial Snapshot ("Backfill then stream" §19)
  fastify.get(
    '/api/v2/tenants/:tenantId/stream/initial',
    { preHandler: [authenticate, requirePermission('agent:read')] },
    async (request, reply) => {
      const user = request.user!;
      const { tenantId } = request.params as { tenantId: string };

      // Verify server-side tenant isolation (§19, §22 Rule 14)
      if (user.tenantId !== tenantId && !user.roles.includes('system') && !user.roles.includes('operator')) {
        throw new ForbiddenError('Tenant isolation violation: Access to other tenant stream is forbidden.');
      }

      const limit = Number((request.query as any)?.limit || 50);
      const snapshot = await hub.getInitialSnapshot(tenantId, limit);
      return reply.status(200).send(snapshot);
    }
  );

  // 2. Sequence Gap Self-Healing Backfill (§19)
  fastify.get(
    '/api/v2/tenants/:tenantId/stream/backfill',
    { preHandler: [authenticate, requirePermission('agent:read')] },
    async (request, reply) => {
      const user = request.user!;
      const { tenantId } = request.params as { tenantId: string };

      if (user.tenantId !== tenantId && !user.roles.includes('system') && !user.roles.includes('operator')) {
        throw new ForbiddenError('Tenant isolation violation: Access to other tenant stream is forbidden.');
      }

      const query = BackfillQuerySchema.parse(request.query);
      const result = await hub.getBackfill(tenantId, query.from, query.to);
      return reply.status(200).send(result);
    }
  );

  // 3. Publish Internal Event (§19)
  fastify.post(
    '/api/v2/tenants/:tenantId/stream/publish',
    { preHandler: [authenticate, requirePermission('agent:write')] },
    async (request, reply) => {
      const user = request.user!;
      const { tenantId } = request.params as { tenantId: string };

      if (user.tenantId !== tenantId && !user.roles.includes('system') && !user.roles.includes('operator')) {
        throw new ForbiddenError('Tenant isolation violation: Cannot publish to other tenant stream.');
      }

      const body = PublishEventSchema.parse(request.body);
      const envelope = await hub.publishEvent({
        tenantId,
        type: body.type,
        agentId: body.agentId,
        executionId: body.executionId,
        payload: body.payload,
      });

      return reply.status(201).send(envelope);
    }
  );

  // 4. Live SSE Event Stream (§19: GET /api/v2/tenants/{id}/stream)
  fastify.get(
    '/api/v2/tenants/:tenantId/stream',
    { preHandler: [authenticate, requirePermission('agent:read')] },
    async (request, reply) => {
      const user = request.user!;
      const { tenantId } = request.params as { tenantId: string };

      // Strict server-side tenant isolation enforcement (§19, §22 Rule 14)
      if (user.tenantId !== tenantId && !user.roles.includes('system') && !user.roles.includes('operator')) {
        throw new ForbiddenError('Tenant isolation violation: Access to other tenant stream is forbidden.');
      }

      // Check Last-Event-ID header or query param (§19)
      const lastEventIdHeader = request.headers['last-event-id'] as string;
      const lastEventIdQuery = (request.query as any)?.lastEventId;
      const lastSeq = lastEventIdHeader ? parseInt(lastEventIdHeader, 10) : lastEventIdQuery ? parseInt(lastEventIdQuery, 10) : null;

      // Set SSE headers
      reply.raw.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      reply.raw.setHeader('Cache-Control', 'no-cache, no-transform');
      reply.raw.setHeader('Connection', 'keep-alive');
      reply.raw.setHeader('X-Accel-Buffering', 'no'); // Disable nginx proxy buffering
      reply.raw.flushHeaders?.();

      // Catch-up missed events if reconnecting with Last-Event-ID (§19)
      if (lastSeq !== null && !isNaN(lastSeq) && lastSeq > 0) {
        try {
          const missed = await hub.getEventsSince(tenantId, lastSeq);
          for (const ev of missed) {
            reply.raw.write(`id: ${ev.seq}\nevent: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`);
          }
        } catch (err) {
          logger.warn(`Failed to replay missed events after seq ${lastSeq}`, { err });
        }
      }

      // Subscribe to live events
      const unsubscribe = hub.subscribe(tenantId, (event) => {
        try {
          reply.raw.write(`id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
        } catch (err) {
          logger.warn(`Error writing SSE event seq=${event.seq} to client`, { err });
        }
      });

      // Keepalive heartbeat ping every 15 seconds
      const pingInterval = setInterval(() => {
        try {
          reply.raw.write(`: ping ${Date.now()}\n\n`);
        } catch {
          clearInterval(pingInterval);
        }
      }, 15000);

      // Clean up on disconnect
      request.raw.on('close', () => {
        clearInterval(pingInterval);
        unsubscribe();
      });

      request.raw.on('end', () => {
        clearInterval(pingInterval);
        unsubscribe();
      });
    }
  );
};
