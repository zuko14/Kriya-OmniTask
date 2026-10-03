/**
 * Kriya AI — Agent Registry & Lifecycle REST Routes
 * Fastify route definitions for agent management, template bootstrap, and state machine transitions.
 */

import { FastifyInstance } from 'fastify';
import { AgentRegistryService } from '../../agents/registry/agentRegistry.js';
import { AgentLifecycleManager } from '../../agents/lifecycle/agentLifecycleManager.js';
import { AgentTransitionActionEnum } from '../../agents/types/agentTypes.js';
import { authenticate } from '../middleware/authMiddleware.js';
import { requirePermission } from '../middleware/rbacMiddleware.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';
import { z } from 'zod';

const TransitionBodySchema = z.object({
  action: AgentTransitionActionEnum,
  reason: z.string().min(3),
  metadata: z.record(z.unknown()).optional(),
});

export async function agentRoutes(fastify: FastifyInstance): Promise<void> {
  const registryService = new AgentRegistryService();
  const lifecycleManager = new AgentLifecycleManager();

  // 1. List Available Built-in System Templates
  fastify.get(
    '/api/v1/agents/templates',
    { preHandler: [authenticate, requirePermission('agent:read')] },
    async (request, reply) => {
      const templates = registryService.getSystemTemplates();
      return reply.status(200).send({ templates });
    }
  );

  // 2. Bootstrap Built-in Templates for Active Tenant
  fastify.post(
    '/api/v1/agents/bootstrap',
    { preHandler: [authenticate, requirePermission('agent:write')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const agents = await registryService.bootstrapSystemTemplates();
        return reply.status(201).send({
          status: 'bootstrapped',
          createdCount: agents.length,
          agents,
        });
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 3. Register a New Agent
  fastify.post(
    '/api/v1/agents',
    { preHandler: [authenticate, requirePermission('agent:write')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const spec = request.body as any;
        const agent = await registryService.registerAgent(spec);
        return reply.status(201).send({ agent });
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 4. List Agents with Filters
  fastify.get(
    '/api/v1/agents',
    { preHandler: [authenticate, requirePermission('agent:read')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const query = request.query as {
          category?: string;
          department?: string;
          status?: string;
        };

        const agents = await registryService.listAgents({
          category: query.category as any,
          department: query.department as any,
          status: query.status as any,
        });

        return reply.status(200).send({ agents });
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 5. Get Agent Details by ID
  fastify.get(
    '/api/v1/agents/:id',
    { preHandler: [authenticate, requirePermission('agent:read')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const { id } = request.params as { id: string };
        const agent = await registryService.getAgent(id);
        return reply.status(200).send({ agent });
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 6. Update Agent Specification
  fastify.patch(
    '/api/v1/agents/:id',
    { preHandler: [authenticate, requirePermission('agent:write')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const { id } = request.params as { id: string };
        const updates = request.body as any;
        const agent = await registryService.updateAgent(id, updates);
        return reply.status(200).send({ agent });
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 7. Delete Agent
  fastify.delete(
    '/api/v1/agents/:id',
    { preHandler: [authenticate, requirePermission('agent:write')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const { id } = request.params as { id: string };
        await registryService.deleteAgent(id);
        return reply.status(200).send({ status: 'deleted', agentId: id });
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 8. Trigger Lifecycle State Transition
  fastify.post(
    '/api/v1/agents/:id/transition',
    { preHandler: [authenticate, requirePermission('agent:deploy')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const { id } = request.params as { id: string };
        const body = TransitionBodySchema.parse(request.body);

        const result = await lifecycleManager.transition({
          agentId: id,
          action: body.action,
          reason: body.reason,
          actorType: 'human_operator',
          metadata: body.metadata,
        });

        return reply.status(200).send({
          status: 'transitioned',
          agent: result.agent,
          event: result.event,
        });
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 9. Get Agent Lifecycle Transition History
  fastify.get(
    '/api/v1/agents/:id/history',
    { preHandler: [authenticate, requirePermission('agent:read')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const { id } = request.params as { id: string };
        const history = await lifecycleManager.getLifecycleHistory(id);
        return reply.status(200).send({ history });
      }, { userId: user.userId, roles: user.roles });
    }
  );
}
