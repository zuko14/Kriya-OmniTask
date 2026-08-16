/**
 * Xylarc AI — Production Infrastructure REST Routes
 * API endpoints for worker queues, connection pool metrics, scheduled jobs, and secret audits.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../../storage/db.js';
import { InfrastructureRepository } from '../../infrastructure/repositories/infrastructureRepository.js';
import { InfrastructureService } from '../../infrastructure/service/infrastructureService.js';
import { authenticate } from '../middleware/authMiddleware.js';
import { requirePermission } from '../middleware/rbacMiddleware.js';
import { z } from 'zod';
import { ValidationError } from '../../core/errors/errors.js';

const EnqueueJobBodySchema = z.object({
  jobType: z.string().min(1),
  payload: z.record(z.string(), z.any()),
  queueName: z.enum(['high', 'default', 'low', 'batch']).default('default'),
  priority: z.number().int().min(1).max(100).default(50),
  runAt: z.string().optional(),
  maxRetries: z.number().int().nonnegative().default(3),
});

const RegisterScheduledJobBodySchema = z.object({
  name: z.string().min(1),
  cronExpression: z.string().min(1),
  jobType: z.string().min(1),
  metadata: z.record(z.string(), z.any()).optional(),
});

export async function infrastructureRoutes(app: FastifyInstance): Promise<void> {
  const repo = new InfrastructureRepository(db.getClient());
  const service = new InfrastructureService(repo);

  // 1. Enqueue Background Job
  app.post(
    '/api/v1/infra/jobs/enqueue',
    { preHandler: [authenticate, requirePermission('workflow:execute')] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const tenantId = (req as any).user.tenantId;
      const parse = EnqueueJobBodySchema.safeParse(req.body);
      if (!parse.success) {
        throw new ValidationError('Invalid job payload', { issues: parse.error.issues });
      }

      const job = await service.enqueueJob(
        tenantId,
        parse.data.jobType,
        parse.data.payload,
        {
          queueName: parse.data.queueName,
          priority: parse.data.priority,
          runAt: parse.data.runAt,
          maxRetries: parse.data.maxRetries,
        }
      );
      return reply.status(201).send(job);
    }
  );

  // 2. List Jobs for Tenant
  app.get(
    '/api/v1/infra/jobs',
    { preHandler: [authenticate, requirePermission('workflow:read')] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const tenantId = (req as any).user.tenantId;
      const jobs = await service.listJobs(tenantId);
      return reply.send({ count: jobs.length, jobs });
    }
  );

  // 3. Get Specific Job
  app.get(
    '/api/v1/infra/jobs/:id',
    { preHandler: [authenticate, requirePermission('workflow:read')] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const tenantId = (req as any).user.tenantId;
      const { id } = req.params as { id: string };
      const job = await service.getJob(id, tenantId);
      if (!job) {
        return reply.status(404).send({ error: 'Job not found' });
      }
      return reply.send(job);
    }
  );

  // 4. Get Database Connection Pool Stats (Operator Only)
  app.get(
    '/api/v1/infra/pool/stats',
    { preHandler: [authenticate, requirePermission('system:admin')] },
    async (_req: FastifyRequest, reply: FastifyReply) => {
      const stats = service.getConnectionPoolStats();
      return reply.send(stats);
    }
  );

  // 5. Trigger Secret Inventory & Entropy Audit (Operator Only)
  app.post(
    '/api/v1/infra/secrets/audit',
    { preHandler: [authenticate, requirePermission('system:admin')] },
    async (_req: FastifyRequest, reply: FastifyReply) => {
      const report = await service.runSecretAudit();
      return reply.status(201).send(report);
    }
  );

  // 6. Get Latest Secret Audit Report (Operator Only)
  app.get(
    '/api/v1/infra/secrets/audit/latest',
    { preHandler: [authenticate, requirePermission('system:admin')] },
    async (_req: FastifyRequest, reply: FastifyReply) => {
      const report = await service.getLatestSecretAuditReport();
      return reply.send(report || { message: 'No secret audit report generated yet' });
    }
  );

  // 7. List Scheduled Jobs (Operator Only)
  app.get(
    '/api/v1/infra/schedules',
    { preHandler: [authenticate, requirePermission('system:admin')] },
    async (_req: FastifyRequest, reply: FastifyReply) => {
      const schedules = await service.listScheduledJobs();
      return reply.send({ count: schedules.length, schedules });
    }
  );

  // 8. Register Scheduled Job (Operator Only)
  app.post(
    '/api/v1/infra/schedules',
    { preHandler: [authenticate, requirePermission('system:admin')] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const parse = RegisterScheduledJobBodySchema.safeParse(req.body);
      if (!parse.success) {
        throw new ValidationError('Invalid scheduled job parameters', { issues: parse.error.issues });
      }

      const schedule = await service.registerScheduledJob(
        parse.data.name,
        parse.data.cronExpression,
        parse.data.jobType,
        parse.data.metadata
      );
      return reply.status(201).send(schedule);
    }
  );
}
