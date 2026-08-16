/**
 * Xylarc AI — Agent Evaluation Benchmark REST Routes
 * Endpoints for Golden Datasets, Benchmark Runs, and Release Gate Decisions (§14, §18 of CLAUDE.md).
 */

import { FastifyInstance } from 'fastify';
import {
  CreateDatasetRequestSchema,
  RunBenchmarkRequestSchema,
  ListDatasetsQuerySchema,
  ListBenchmarksQuerySchema,
} from '../../evaluation/types/evaluationTypes.js';
import { EvaluationService } from '../../evaluation/service/evaluationService.js';
import { authenticate } from '../middleware/authMiddleware.js';
import { requirePermission } from '../middleware/rbacMiddleware.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';

export async function evaluationRoutes(fastify: FastifyInstance): Promise<void> {
  const service = new EvaluationService();

  // 1. Create Golden Dataset
  fastify.post(
    '/api/v1/evaluation/datasets',
    { preHandler: [authenticate, requirePermission('agent:write')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const body = CreateDatasetRequestSchema.parse(request.body);
        const dataset = await service.createDataset(body);
        return reply.status(201).send(dataset);
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 2. List Golden Datasets
  fastify.get(
    '/api/v1/evaluation/datasets',
    { preHandler: [authenticate, requirePermission('agent:read')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const query = ListDatasetsQuerySchema.parse(request.query);
        const datasets = await service.listDatasets({
          targetAgentId: query.targetAgentId,
          limit: query.limit,
        });
        return reply.status(200).send({ datasets, count: datasets.length });
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 3. Get Golden Dataset by ID
  fastify.get(
    '/api/v1/evaluation/datasets/:id',
    { preHandler: [authenticate, requirePermission('agent:read')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const { id } = request.params as { id: string };
        const dataset = await service.getDataset(id);
        return reply.status(200).send(dataset);
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 4. Run Benchmark against Golden Dataset
  fastify.post(
    '/api/v1/evaluation/datasets/:id/benchmark',
    { preHandler: [authenticate, requirePermission('agent:write')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const { id } = request.params as { id: string };
        const body = RunBenchmarkRequestSchema.parse(request.body || {});
        const benchmark = await service.runBenchmark(id, body);
        return reply.status(201).send(benchmark);
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 5. List Benchmark Runs
  fastify.get(
    '/api/v1/evaluation/benchmarks',
    { preHandler: [authenticate, requirePermission('audit:read')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const query = ListBenchmarksQuerySchema.parse(request.query);
        const benchmarks = await service.listBenchmarks({
          datasetId: query.datasetId,
          verdict: query.verdict,
          limit: query.limit,
        });
        return reply.status(200).send({ benchmarks, count: benchmarks.length });
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 6. Get Benchmark Run by ID
  fastify.get(
    '/api/v1/evaluation/benchmarks/:id',
    { preHandler: [authenticate, requirePermission('audit:read')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const { id } = request.params as { id: string };
        const benchmark = await service.getBenchmark(id);
        return reply.status(200).send(benchmark);
      }, { userId: user.userId, roles: user.roles });
    }
  );
}
