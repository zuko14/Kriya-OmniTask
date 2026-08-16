/**
 * Xylarc AI — Agent Observability & Distributed Tracing REST Routes
 * Endpoints for Waterfall Traces, Telemetry Metrics, and Drift Diagnostics (§14, §16 of CLAUDE.md).
 */

import { FastifyInstance } from 'fastify';
import {
  ListTracesQuerySchema,
} from '../../observability/types/observabilityTypes.js';
import { ObservabilityService } from '../../observability/service/observabilityService.js';
import { authenticate } from '../middleware/authMiddleware.js';
import { requirePermission } from '../middleware/rbacMiddleware.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';
import { z } from 'zod';

const EvaluateDriftBodySchema = z.object({
  modelFinalOutput: z.string().optional(),
  retrievedEvidence: z.array(z.string()).default([]),
});

export async function observabilityRoutes(fastify: FastifyInstance): Promise<void> {
  const service = new ObservabilityService();

  // 1. List Traces with Filters
  fastify.get(
    '/api/v1/observability/traces',
    { preHandler: [authenticate, requirePermission('audit:read')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const query = ListTracesQuerySchema.parse(request.query);
        const traces = await service.listTraces({
          agentId: query.agentId,
          status: query.status,
          driftOnly: query.driftOnly === 'true',
          limit: query.limit,
        });
        return reply.status(200).send({ traces, count: traces.length });
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 2. Get Trace Waterfall View
  fastify.get(
    '/api/v1/observability/traces/:id',
    { preHandler: [authenticate, requirePermission('audit:read')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const { id } = request.params as { id: string };
        const waterfall = await service.getTraceWaterfall(id);
        return reply.status(200).send(waterfall);
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 3. Get Telemetry & Metrics Overview
  fastify.get(
    '/api/v1/observability/metrics',
    { preHandler: [authenticate, requirePermission('audit:read')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const overview = await service.getMetricsOverview();
        return reply.status(200).send(overview);
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 4. Re-evaluate Drift on Trace
  fastify.post(
    '/api/v1/observability/traces/:id/evaluate-drift',
    { preHandler: [authenticate, requirePermission('audit:read')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const { id } = request.params as { id: string };
        const body = EvaluateDriftBodySchema.parse(request.body || {});
        const finalized = await service.completeTrace(id, {
          modelFinalOutput: body.modelFinalOutput,
          retrievedEvidence: body.retrievedEvidence,
        });
        return reply.status(200).send(finalized);
      }, { userId: user.userId, roles: user.roles });
    }
  );
}
