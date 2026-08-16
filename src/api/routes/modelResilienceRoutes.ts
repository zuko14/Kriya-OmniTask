/**
 * Xylarc AI — Model Provider Resilience REST API Routes
 * Endpoints for model registry, tenant provider policies, dynamic execution, and routing audits (§10–§14).
 */

import { FastifyInstance } from 'fastify';
import { ModelResilienceService } from '../../model/resilience/service/modelResilienceService.js';
import {
  RegisterModelRequestSchema,
  UpdateTenantModelPolicyRequestSchema,
  ExecuteWithResilienceRequestSchema,
  ModelStatus,
} from '../../model/resilience/types/modelResilienceTypes.js';
import { authenticate } from '../middleware/authMiddleware.js';
import { requirePermission } from '../middleware/rbacMiddleware.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';
import { z } from 'zod';

export async function modelResilienceRoutes(fastify: FastifyInstance): Promise<void> {
  const service = new ModelResilienceService();

  // 1. List Registered Models
  fastify.get(
    '/api/v1/model-resilience/models',
    { preHandler: [authenticate, requirePermission('tenant:read')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const { status } = request.query as { status?: ModelStatus };
        const models = await service.listRegisteredModels(status);
        return reply.status(200).send({ models, count: models.length });
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 2. Register / Update Approved Model
  fastify.post(
    '/api/v1/model-resilience/models',
    { preHandler: [authenticate, requirePermission('tenant:write')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const body = RegisterModelRequestSchema.parse(request.body);
        const record = await service.registerModel(body);
        return reply.status(201).send(record);
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 3. Get Tenant Model Policy
  fastify.get(
    '/api/v1/model-resilience/policy',
    { preHandler: [authenticate, requirePermission('tenant:read')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const policy = await service.getTenantPolicy();
        return reply.status(200).send(policy || { message: 'No custom policy set. System default active.' });
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 4. Update Tenant Model Policy
  fastify.put(
    '/api/v1/model-resilience/policy',
    { preHandler: [authenticate, requirePermission('tenant:write')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const body = UpdateTenantModelPolicyRequestSchema.parse(request.body);
        const policy = await service.updateTenantPolicy(body);
        return reply.status(200).send(policy);
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 5. Execute Prompt with Dynamic Resilience Routing
  fastify.post(
    '/api/v1/model-resilience/execute',
    { preHandler: [authenticate, requirePermission('tenant:write')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const body = ExecuteWithResilienceRequestSchema.parse(request.body);
        const { mockFailures } = (request.body as { mockFailures?: string[] }) || {};
        const response = await service.executeWithResilience(body, { mockFailures });
        return reply.status(200).send(response);
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 6. List Routing Decision Audits
  fastify.get(
    '/api/v1/model-resilience/decisions',
    { preHandler: [authenticate, requirePermission('tenant:read')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const { limit } = request.query as { limit?: string };
        const parsedLimit = limit ? parseInt(limit, 10) : 50;
        const decisions = await service.listRoutingDecisions(parsedLimit);
        return reply.status(200).send({ decisions, count: decisions.length });
      }, { userId: user.userId, roles: user.roles });
    }
  );
}
