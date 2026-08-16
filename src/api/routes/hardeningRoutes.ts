/**
 * Xylarc AI — Production Hardening REST Routes
 * API endpoints for multi-tenant stress testing, chaos experiments, red-team scans, and readiness certification.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../../storage/db.js';
import { HardeningRepository } from '../../hardening/repositories/hardeningRepository.js';
import { HardeningService } from '../../hardening/service/hardeningService.js';
import { authenticate } from '../middleware/authMiddleware.js';
import { requirePermission } from '../middleware/rbacMiddleware.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';
import {
  RunStressTestSchema,
  RunChaosExperimentSchema,
  RunRedTeamAuditSchema,
} from '../../hardening/types/hardeningTypes.js';
import { ValidationError } from '../../core/errors/errors.js';

export async function hardeningRoutes(app: FastifyInstance): Promise<void> {
  const repo = new HardeningRepository(db.getClient());
  const service = new HardeningService(repo);

  // 1. Run Multi-Tenant Concurrency Stress Benchmark (Operator Only)
  app.post(
    '/api/v1/hardening/stress/run',
    { preHandler: [authenticate, requirePermission('system:admin')] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = req.user!;
      return TenantContextManager.withTenant(
        user.tenantId,
        user.organizationId || 'default',
        async () => {
          const parse = RunStressTestSchema.safeParse(req.body || {});
          if (!parse.success) {
            throw new ValidationError('Invalid stress test parameters', { issues: parse.error.issues });
          }

          const run = await service.runStressBenchmark(parse.data);
          return reply.status(201).send(run);
        },
        { userId: user.userId, roles: user.roles }
      );
    }
  );

  // 2. List Stress Benchmark Runs
  app.get(
    '/api/v1/hardening/stress/runs',
    { preHandler: [authenticate, requirePermission('audit:read')] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = req.user!;
      return TenantContextManager.withTenant(
        user.tenantId,
        user.organizationId || 'default',
        async () => {
          const query = req.query as { limit?: string };
          const limit = query.limit ? parseInt(query.limit, 10) : 20;
          const runs = await service.listStressRuns(limit);
          return reply.send({ count: runs.length, runs });
        },
        { userId: user.userId, roles: user.roles }
      );
    }
  );

  // 3. Run Chaos Injection Experiment (Operator Only)
  app.post(
    '/api/v1/hardening/chaos/experiments',
    { preHandler: [authenticate, requirePermission('system:admin')] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = req.user!;
      return TenantContextManager.withTenant(
        user.tenantId,
        user.organizationId || 'default',
        async () => {
          const parse = RunChaosExperimentSchema.safeParse(req.body);
          if (!parse.success) {
            throw new ValidationError('Invalid chaos experiment parameters', { issues: parse.error.issues });
          }

          const exp = await service.runChaosExperiment(parse.data);
          return reply.status(201).send(exp);
        },
        { userId: user.userId, roles: user.roles }
      );
    }
  );

  // 4. List Chaos Experiments
  app.get(
    '/api/v1/hardening/chaos/experiments',
    { preHandler: [authenticate, requirePermission('audit:read')] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = req.user!;
      return TenantContextManager.withTenant(
        user.tenantId,
        user.organizationId || 'default',
        async () => {
          const query = req.query as { limit?: string };
          const limit = query.limit ? parseInt(query.limit, 10) : 20;
          const experiments = await service.listChaosExperiments(limit);
          return reply.send({ count: experiments.length, experiments });
        },
        { userId: user.userId, roles: user.roles }
      );
    }
  );

  // 5. Run Adversarial Red-Team Scan (Operator Only)
  app.post(
    '/api/v1/hardening/red-team/audit',
    { preHandler: [authenticate, requirePermission('system:admin')] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = req.user!;
      return TenantContextManager.withTenant(
        user.tenantId,
        user.organizationId || 'default',
        async () => {
          const parse = RunRedTeamAuditSchema.safeParse(req.body || {});
          if (!parse.success) {
            throw new ValidationError('Invalid red-team audit payload', { issues: parse.error.issues });
          }

          const audit = await service.runRedTeamAudit(parse.data.auditName);
          return reply.status(201).send(audit);
        },
        { userId: user.userId, roles: user.roles }
      );
    }
  );

  // 6. List Red-Team Audits
  app.get(
    '/api/v1/hardening/red-team/audits',
    { preHandler: [authenticate, requirePermission('audit:read')] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = req.user!;
      return TenantContextManager.withTenant(
        user.tenantId,
        user.organizationId || 'default',
        async () => {
          const query = req.query as { limit?: string };
          const limit = query.limit ? parseInt(query.limit, 10) : 20;
          const audits = await service.listRedTeamAudits(limit);
          return reply.send({ count: audits.length, audits });
        },
        { userId: user.userId, roles: user.roles }
      );
    }
  );

  // 7. Get Production Readiness Certificate
  app.get(
    '/api/v1/hardening/readiness/certificate',
    { preHandler: [authenticate, requirePermission('audit:read')] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = req.user!;
      return TenantContextManager.withTenant(
        user.tenantId,
        user.organizationId || 'default',
        async () => {
          const cert = await service.getProductionReadinessCertificate();
          return reply.send(cert);
        },
        { userId: user.userId, roles: user.roles }
      );
    }
  );
}
