/**
 * Kriya AI — Agent Evaluation Benchmark REST Routes
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

  // ---------------------------------------------------------------------------
  // WP-6.2: Evals-as-CI & Regression Gating Endpoints
  // ---------------------------------------------------------------------------

  const ciService = new (await import('../../evaluation/ci/service/evalsAsCiService.js')).EvalsAsCiService();
  const ciRepo = new (await import('../../evaluation/ci/repositories/evaluationCiRepository.js')).EvaluationCiRepository();
  const {
    RunCiSuiteRequestSchema,
    ModelSwapGateRequestSchema,
    CharterUpdateGateRequestSchema,
  } = await import('../../evaluation/ci/types/evalCiTypes.js');

  // 7. Run CI Golden Suite Evaluation
  fastify.post(
    '/api/v1/evaluation/ci/run',
    { preHandler: [authenticate, requirePermission('agent:write')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const body = RunCiSuiteRequestSchema.parse(request.body || {});
        const report = await ciService.runCiPipeline({
          tenantId: user.tenantId,
          agentSlugs: body.agentSlugs,
          modelId: body.modelId,
          passKTrials: body.passKTrials,
          strictMode: body.strictMode,
          executionMode: body.executionMode,
        });
        const statusCode = report.exitCode === 0 ? 200 : 422;
        return reply.status(statusCode).send(report);
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 8. Gate Proposed Model Swap Before Activation
  fastify.post(
    '/api/v1/evaluation/ci/gate-model-swap',
    { preHandler: [authenticate, requirePermission('agent:write')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const body = ModelSwapGateRequestSchema.parse(request.body || {});
        const result = await ciService.evaluateModelSwap({
          tenantId: user.tenantId,
          currentModelId: body.currentModelId,
          proposedModelId: body.proposedModelId,
          agentSlugs: body.agentSlugs,
          passKTrials: body.passKTrials,
          strictMode: body.strictMode,
        });
        const statusCode = result.verdict === 'release_blocked_regression' ? 422 : 200;
        return reply.status(statusCode).send(result);
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 9. Gate Proposed Charter Update Before Deployment
  fastify.post(
    '/api/v1/evaluation/ci/gate-charter',
    { preHandler: [authenticate, requirePermission('agent:write')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const body = CharterUpdateGateRequestSchema.parse(request.body || {});
        const result = await ciService.evaluateCharterUpdate({
          tenantId: user.tenantId,
          agentSlug: body.agentSlug,
          currentCharter: body.currentCharter,
          proposedCharter: body.proposedCharter,
          passKTrials: body.passKTrials,
          strictMode: body.strictMode,
        });
        const statusCode = result.blockedByRegression ? 422 : 200;
        return reply.status(statusCode).send(result);
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 10. List CI & Regression Gating Runs
  fastify.get(
    '/api/v1/evaluation/ci/runs',
    { preHandler: [authenticate, requirePermission('audit:read')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const query = request.query as Record<string, string | undefined>;
        const runs = await ciRepo.listRuns({
          tenantId: user.tenantId,
          agentSlug: query.agentSlug,
          evaluationType: query.evaluationType,
          verdict: query.verdict,
          limit: query.limit ? parseInt(query.limit, 10) : 50,
        });
        return reply.status(200).send({ runs, count: runs.length });
      }, { userId: user.userId, roles: user.roles });
    }
  );
}
