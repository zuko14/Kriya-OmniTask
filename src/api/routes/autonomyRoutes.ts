/**
 * Kriya Omnitask — Error-Budget Autonomy Throttling REST Routes
 * (CLAUDE.md §15, §37; Blueprint §14; docs/kriya WP-6.3, ADR-026)
 *
 * REST API endpoints for inspecting agent error budgets, triggering evaluation,
 * restoring throttled autonomy under human governance, and auditing transitions.
 */

import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { authenticate } from '../middleware/authMiddleware.js';
import { requirePermission } from '../middleware/rbacMiddleware.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';
import { AutonomyThrottlingService } from '../../throttling/service/autonomyThrottlingService.js';
import {
  EvaluateAutonomyRequestSchema,
  RestoreAutonomyRequestSchema,
} from '../../throttling/types/autonomyThrottlingTypes.js';

export const autonomyRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const service = new AutonomyThrottlingService();

  /**
   * GET /api/v1/autonomy/status
   * Lists error budgets and autonomy throttle status across all agents in the tenant.
   */
  fastify.get(
    '/api/v1/autonomy/status',
    { preHandler: [authenticate, requirePermission('agent:read')] },
    async (request, reply) => {
      const tenantId = (request as any).user?.tenantId ?? TenantContextManager.getTenantId();
      const onlyThrottled = (request.query as any)?.onlyThrottled === 'true';

      const budgets = await service.getRepo().listBudgets(tenantId, onlyThrottled);
      return reply.send({
        success: true,
        data: {
          tenantId,
          total: budgets.length,
          throttledCount: budgets.filter((b) => b.is_throttled).length,
          budgets,
        },
      });
    }
  );

  /**
   * GET /api/v1/autonomy/status/:agentSlug
   * Returns error budget and throttle status for a specific agent.
   */
  fastify.get(
    '/api/v1/autonomy/status/:agentSlug',
    { preHandler: [authenticate, requirePermission('agent:read')] },
    async (request, reply) => {
      const tenantId = (request as any).user?.tenantId ?? TenantContextManager.getTenantId();
      const { agentSlug } = request.params as { agentSlug: string };

      const budget = await service.getRepo().getBudget(tenantId, agentSlug);
      if (!budget) {
        return reply.status(404).send({
          error: {
            code: 'NOT_FOUND',
            message: `No error budget tracked for agent '${agentSlug}' in tenant '${tenantId}'`,
            statusCode: 404,
          },
        });
      }

      return reply.send({
        success: true,
        data: budget,
      });
    }
  );

  /**
   * POST /api/v1/autonomy/evaluate
   * Evaluates rolling error budget from outcomes, applying step-down throttling if burned.
   */
  fastify.post(
    '/api/v1/autonomy/evaluate',
    { preHandler: [authenticate, requirePermission('agent:write')] },
    async (request, reply) => {
      const tenantId = (request as any).user?.tenantId ?? TenantContextManager.getTenantId();
      const body = EvaluateAutonomyRequestSchema.parse(request.body ?? {});

      if (body.agentSlug) {
        const result = await service.evaluateAgent(tenantId, body.agentSlug, undefined, {
          windowHours: body.windowHours,
        });
        return reply.send({
          success: true,
          data: result,
        });
      }

      const results = await service.evaluateFleet(tenantId, undefined, undefined, {
        windowHours: body.windowHours,
      });
      return reply.send({
        success: true,
        data: {
          tenantId,
          evaluatedCount: results.length,
          throttledCount: results.filter((r) => r.action === 'throttled').length,
          results,
        },
      });
    }
  );

  /**
   * POST /api/v1/autonomy/restore
   * Human-in-the-loop restoration of agent autonomy after review.
   */
  fastify.post(
    '/api/v1/autonomy/restore',
    { preHandler: [authenticate, requirePermission('agent:write')] },
    async (request, reply) => {
      const tenantId = (request as any).user?.tenantId ?? TenantContextManager.getTenantId();
      const user = (request as any).user;
      const rawBody = (request.body as Record<string, unknown>) ?? {};

      const body = RestoreAutonomyRequestSchema.parse({
        ...rawBody,
        restoredBy: rawBody.restoredBy ?? user?.id ?? user?.email ?? 'human_supervisor',
      });

      const restored = await service.restoreAutonomy(tenantId, body);
      return reply.send({
        success: true,
        data: {
          message: `Agent '${restored.agent_slug}' autonomy successfully restored to '${restored.effective_tier_cap}'`,
          budget: restored,
        },
      });
    }
  );

  /**
   * GET /api/v1/autonomy/events
   * Returns paginated audit log of autonomy events (throttled, restored, warnings).
   */
  fastify.get(
    '/api/v1/autonomy/events',
    { preHandler: [authenticate, requirePermission('agent:read')] },
    async (request, reply) => {
      const tenantId = (request as any).user?.tenantId ?? TenantContextManager.getTenantId();
      const q = request.query as any;
      const agentSlug = q?.agentSlug;
      const limit = q?.limit ? parseInt(q.limit, 10) : 50;
      const offset = q?.offset ? parseInt(q.offset, 10) : 0;

      const { events, total } = await service.getRepo().listEvents(tenantId, {
        agentSlug,
        limit,
        offset,
      });

      return reply.send({
        success: true,
        data: {
          tenantId,
          total,
          limit,
          offset,
          events,
        },
      });
    }
  );
};
