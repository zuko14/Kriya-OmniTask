/**
 * Kriya AI — Cost Intelligence REST API Routes
 * Endpoints for cost attribution, business outcome unit economics, and hard budget policies (§10–§14, §24).
 */

import { FastifyInstance } from 'fastify';
import { CostService } from '../../cost/service/costService.js';
import {
  RecordCostRequestSchema,
  RecordOutcomeRequestSchema,
  UpdateBudgetPolicyRequestSchema,
} from '../../cost/types/costTypes.js';
import { authenticate } from '../middleware/authMiddleware.js';
import { requirePermission } from '../middleware/rbacMiddleware.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';

export async function costRoutes(fastify: FastifyInstance): Promise<void> {
  const service = new CostService();

  // 1. Record Cost Attribution Event
  fastify.post(
    '/api/v1/cost/records',
    { preHandler: [authenticate, requirePermission('tenant:write')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const body = RecordCostRequestSchema.parse(request.body);
        const record = await service.recordCost(body);
        return reply.status(201).send(record);
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 2. List Cost Records
  fastify.get(
    '/api/v1/cost/records',
    { preHandler: [authenticate, requirePermission('tenant:read')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const { limit } = request.query as { limit?: string };
        const parsedLimit = limit ? parseInt(limit, 10) : 100;
        const records = await service.listCostRecords(parsedLimit);
        return reply.status(200).send({ records, count: records.length });
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 3. Record Business Outcome
  fastify.post(
    '/api/v1/cost/outcomes',
    { preHandler: [authenticate, requirePermission('tenant:write')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const body = RecordOutcomeRequestSchema.parse(request.body);
        const outcome = await service.recordOutcome(body);
        return reply.status(201).send(outcome);
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 4. List Business Outcomes
  fastify.get(
    '/api/v1/cost/outcomes',
    { preHandler: [authenticate, requirePermission('tenant:read')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const { limit } = request.query as { limit?: string };
        const parsedLimit = limit ? parseInt(limit, 10) : 100;
        const outcomes = await service.listBusinessOutcomes(parsedLimit);
        return reply.status(200).send({ outcomes, count: outcomes.length });
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 5. Get Outcome Unit Economics Summary
  fastify.get(
    '/api/v1/cost/outcomes/unit-economics',
    { preHandler: [authenticate, requirePermission('tenant:read')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const economics = await service.getUnitEconomics();
        return reply.status(200).send({ economics });
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 6. Get Spend Breakdown Summary
  fastify.get(
    '/api/v1/cost/summary',
    { preHandler: [authenticate, requirePermission('tenant:read')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const summary = await service.getSpendBreakdown();
        return reply.status(200).send(summary);
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 7. Get Tenant Budget Policy
  fastify.get(
    '/api/v1/cost/budget',
    { preHandler: [authenticate, requirePermission('tenant:read')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const policy = await service.getBudgetPolicy();
        return reply.status(200).send(policy || { message: 'No explicit budget policy configured.' });
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 8. Update Tenant Budget Policy
  fastify.put(
    '/api/v1/cost/budget',
    { preHandler: [authenticate, requirePermission('tenant:write')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const body = UpdateBudgetPolicyRequestSchema.parse(request.body);
        const policy = await service.updateBudgetPolicy(body);
        return reply.status(200).send(policy);
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 9. Reset Tripped Circuit Breaker
  fastify.post(
    '/api/v1/cost/budget/reset-circuit',
    { preHandler: [authenticate, requirePermission('tenant:write')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        await service.resetCircuitBreaker();
        return reply.status(200).send({ message: 'Budget circuit breaker reset successfully.' });
      }, { userId: user.userId, roles: user.roles });
    }
  );
}
