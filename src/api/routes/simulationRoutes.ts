/**
 * Kriya AI — Agent Simulation & Dry-Run Sandbox REST Routes
 * Endpoints for Scenario Management, Dry-Run Executions, and Behavioral Regression Reports (§14, §17 of CLAUDE.md).
 */

import { FastifyInstance } from 'fastify';
import {
  CreateScenarioRequestSchema,
  RunScenarioRequestSchema,
  ListScenariosQuerySchema,
  ListRunsQuerySchema,
} from '../../simulation/types/simulationTypes.js';
import { SimulationService } from '../../simulation/service/simulationService.js';
import { authenticate } from '../middleware/authMiddleware.js';
import { requirePermission } from '../middleware/rbacMiddleware.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';

export async function simulationRoutes(fastify: FastifyInstance): Promise<void> {
  const service = new SimulationService();

  // 1. Create Simulation Scenario
  fastify.post(
    '/api/v1/simulation/scenarios',
    { preHandler: [authenticate, requirePermission('agent:write')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const body = CreateScenarioRequestSchema.parse(request.body);
        const scenario = await service.createScenario(body);
        return reply.status(201).send(scenario);
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 2. List Simulation Scenarios
  fastify.get(
    '/api/v1/simulation/scenarios',
    { preHandler: [authenticate, requirePermission('agent:read')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const query = ListScenariosQuerySchema.parse(request.query);
        const scenarios = await service.listScenarios({
          category: query.category,
          targetAgentId: query.targetAgentId,
          limit: query.limit,
        });
        return reply.status(200).send({ scenarios, count: scenarios.length });
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 3. Get Simulation Scenario by ID
  fastify.get(
    '/api/v1/simulation/scenarios/:id',
    { preHandler: [authenticate, requirePermission('agent:read')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const { id } = request.params as { id: string };
        const scenario = await service.getScenario(id);
        return reply.status(200).send(scenario);
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 4. Run Scenario in Dry-Run Sandbox
  fastify.post(
    '/api/v1/simulation/scenarios/:id/run',
    { preHandler: [authenticate, requirePermission('agent:write')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const { id } = request.params as { id: string };
        const body = RunScenarioRequestSchema.parse(request.body || {});
        const run = await service.runScenario(id, body);
        return reply.status(201).send(run);
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 5. List Simulation Execution Runs
  fastify.get(
    '/api/v1/simulation/runs',
    { preHandler: [authenticate, requirePermission('audit:read')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const query = ListRunsQuerySchema.parse(request.query);
        const runs = await service.listRuns({
          scenarioId: query.scenarioId,
          status: query.status,
          limit: query.limit,
        });
        return reply.status(200).send({ runs, count: runs.length });
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 6. Get Simulation Run by ID
  fastify.get(
    '/api/v1/simulation/runs/:id',
    { preHandler: [authenticate, requirePermission('audit:read')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const { id } = request.params as { id: string };
        const run = await service.getRun(id);
        return reply.status(200).send(run);
      }, { userId: user.userId, roles: user.roles });
    }
  );
}
