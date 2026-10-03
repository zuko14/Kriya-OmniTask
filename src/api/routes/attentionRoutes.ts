/**
 * Kriya AI — Human Attention Center & Priority Exception Queue REST Routes
 * Endpoints for Escalation Items, Approvals, and Live Conversation Takeovers (§14, §16 of CLAUDE.md).
 */

import { FastifyInstance } from 'fastify';
import {
  CreateAttentionItemRequestSchema,
  ResolveAttentionItemRequestSchema,
  StartTakeoverRequestSchema,
  ListAttentionItemsQuerySchema,
} from '../../attention/types/attentionTypes.js';
import { AttentionService } from '../../attention/service/attentionService.js';
import { authenticate } from '../middleware/authMiddleware.js';
import { requirePermission } from '../middleware/rbacMiddleware.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';

import { GraphRunRepository } from '../../runtime/graph/graphRunRepository.js';
import { GraphExecutor } from '../../runtime/graph/executor.js';

export async function attentionRoutes(fastify: FastifyInstance): Promise<void> {
  const service = new AttentionService();

  // 1. Escalate Event to Human Attention Queue
  fastify.post(
    '/api/v1/attention/items',
    { preHandler: [authenticate, requirePermission('agent:write')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const body = CreateAttentionItemRequestSchema.parse(request.body);
        const item = await service.escalateToHuman(body);
        return reply.status(201).send(item);
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 2. List Attention Items with Filtering
  fastify.get(
    '/api/v1/attention/items',
    { preHandler: [authenticate, requirePermission('customer:read')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const query = ListAttentionItemsQuerySchema.parse(request.query);
        const items = await service.listItems({
          status: query.status,
          priority: query.priority,
          reasonCategory: query.reasonCategory,
          assignedUserId: query.assignedUserId,
          limit: query.limit,
        });
        return reply.status(200).send({ items, count: items.length });
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 3. Get Attention Item by ID
  fastify.get(
    '/api/v1/attention/items/:id',
    { preHandler: [authenticate, requirePermission('customer:read')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const { id } = request.params as { id: string };
        const item = await service.getItem(id);
        return reply.status(200).send(item);
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 4. Claim Attention Item
  fastify.post(
    '/api/v1/attention/items/:id/claim',
    { preHandler: [authenticate, requirePermission('customer:write')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const { id } = request.params as { id: string };
        const claimed = await service.claimItem(id, user.userId);
        return reply.status(200).send(claimed);
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 5. Resolve Attention Item
  fastify.post(
    '/api/v1/attention/items/:id/resolve',
    { preHandler: [authenticate, requirePermission('customer:write')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const { id } = request.params as { id: string };
        const body = ResolveAttentionItemRequestSchema.parse(request.body);
        const resolved = await service.resolveItem(id, body);

        // WP-2.5: If this item was created by a human_gate in a workflow run, automatically resume the run
        let runOutcome: unknown = undefined;
        if (resolved.context_data_json) {
          try {
            const ctx = JSON.parse(resolved.context_data_json) as Record<string, unknown>;
            if (ctx.runId && (body.action === 'approved' || body.action === 'rejected')) {
              const graphRepo = new GraphRunRepository();
              const run = await graphRepo.getRun(String(ctx.runId));
              if (run && run.status === 'parked') {
                const executor = new GraphExecutor({}, graphRepo, undefined, service);
                runOutcome = await executor.resume(String(ctx.runId), {
                  decision: body.action,
                  notes: body.notes,
                  humanApproverId: user.userId,
                  attentionItemId: id,
                });
              }
            }
          } catch {
            // Keep resolution intact even if resume encounters an error
          }
        }

        return reply.status(200).send({
          ...resolved,
          ...(runOutcome ? { runOutcome } : {}),
        });
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 6. Start Live Human Takeover
  fastify.post(
    '/api/v1/attention/takeovers',
    { preHandler: [authenticate, requirePermission('customer:write')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const body = StartTakeoverRequestSchema.parse(request.body);
        const takeover = await service.startTakeover(user.userId, body);
        return reply.status(201).send(takeover);
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 7. Handback Takeover to AI
  fastify.post(
    '/api/v1/attention/takeovers/:customerId/handback',
    { preHandler: [authenticate, requirePermission('customer:write')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const { customerId } = request.params as { customerId: string };
        const success = await service.handbackTakeover(customerId);
        return reply.status(200).send({ success, customerId, handedBack: true });
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 8. Check Active Takeover Status
  fastify.get(
    '/api/v1/attention/takeovers/active/:customerId',
    { preHandler: [authenticate, requirePermission('customer:read')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const { customerId } = request.params as { customerId: string };
        const isUnderTakeover = await service.isUnderTakeover(customerId);
        return reply.status(200).send({ customerId, isUnderTakeover });
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 9. Get Attention Metrics Overview
  fastify.get(
    '/api/v1/attention/metrics',
    { preHandler: [authenticate, requirePermission('customer:read')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const metrics = await service.getMetricsOverview();
        return reply.status(200).send(metrics);
      }, { userId: user.userId, roles: user.roles });
    }
  );
}
