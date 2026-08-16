/**
 * Xylarc AI — Site Reliability Engineering (SRE) REST Routes
 * API endpoints for waterfall trace rendering, SLO tracking, burn rates, and multi-channel alerts.
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db } from '../../storage/db.js';
import { SreRepository } from '../../sre/repositories/sreRepository.js';
import { TraceRepository } from '../../observability/repositories/traceRepository.js';
import { SreService } from '../../sre/service/sreService.js';
import { authenticate } from '../middleware/authMiddleware.js';
import { requirePermission } from '../middleware/rbacMiddleware.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';
import { z } from 'zod';
import { ValidationError } from '../../core/errors/errors.js';

const CreateSloBodySchema = z.object({
  name: z.string().min(1),
  serviceName: z.string().min(1),
  targetMetric: z.enum([
    'availability',
    'p95_latency_ms',
    'p99_latency_ms',
    'error_rate',
    'workflow_success_rate',
  ]),
  targetThreshold: z.number().positive(),
  windowDays: z.number().int().positive().default(30),
});

const EvaluateSloBodySchema = z.object({
  actualMetricValue: z.number(),
});

export async function sreRoutes(app: FastifyInstance): Promise<void> {
  const sreRepo = new SreRepository(db.getClient());
  const traceRepo = new TraceRepository(db.getClient());
  const service = new SreService(sreRepo, traceRepo);

  // 1. Get Waterfall Trace Visualization
  app.get(
    '/api/v1/sre/traces/:traceId/waterfall',
    { preHandler: [authenticate, requirePermission('audit:read')] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = req.user!;
      return TenantContextManager.withTenant(
        user.tenantId,
        user.organizationId || 'default',
        async () => {
          const { traceId } = req.params as { traceId: string };
          const waterfall = await service.getTraceWaterfall(traceId);
          return reply.send(waterfall);
        },
        { userId: user.userId, roles: user.roles }
      );
    }
  );

  // 2. Define New SLO (Operator Only)
  app.post(
    '/api/v1/sre/slos',
    { preHandler: [authenticate, requirePermission('system:admin')] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = req.user!;
      return TenantContextManager.withTenant(
        user.tenantId,
        user.organizationId || 'default',
        async () => {
          const parse = CreateSloBodySchema.safeParse(req.body);
          if (!parse.success) {
            throw new ValidationError('Invalid SLO parameters', { issues: parse.error.issues });
          }

          const slo = await service.createSlo(
            parse.data.name,
            parse.data.serviceName,
            parse.data.targetMetric,
            parse.data.targetThreshold,
            parse.data.windowDays
          );
          return reply.status(201).send(slo);
        },
        { userId: user.userId, roles: user.roles }
      );
    }
  );

  // 3. List SLOs
  app.get(
    '/api/v1/sre/slos',
    { preHandler: [authenticate, requirePermission('audit:read')] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = req.user!;
      return TenantContextManager.withTenant(
        user.tenantId,
        user.organizationId || 'default',
        async () => {
          const slos = await service.listSlos();
          return reply.send({ count: slos.length, slos });
        },
        { userId: user.userId, roles: user.roles }
      );
    }
  );

  // 4. Evaluate SLO and Compute Burn Rate (Operator Only)
  app.post(
    '/api/v1/sre/slos/:id/evaluate',
    { preHandler: [authenticate, requirePermission('system:admin')] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = req.user!;
      return TenantContextManager.withTenant(
        user.tenantId,
        user.organizationId || 'default',
        async () => {
          const { id } = req.params as { id: string };
          const parse = EvaluateSloBodySchema.safeParse(req.body);
          if (!parse.success) {
            throw new ValidationError('Invalid SLO evaluation payload', { issues: parse.error.issues });
          }

          const evaluation = await service.evaluateSlo(id, parse.data.actualMetricValue);
          return reply.status(200).send(evaluation);
        },
        { userId: user.userId, roles: user.roles }
      );
    }
  );

  // 5. List SRE Incident Alerts
  app.get(
    '/api/v1/sre/alerts',
    { preHandler: [authenticate, requirePermission('audit:read')] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = req.user!;
      return TenantContextManager.withTenant(
        user.tenantId,
        user.organizationId || 'default',
        async () => {
          const query = req.query as { status?: any; limit?: string };
          const limit = query.limit ? parseInt(query.limit, 10) : 50;
          const alerts = await service.listAlerts(query.status, limit);
          return reply.send({ count: alerts.length, alerts });
        },
        { userId: user.userId, roles: user.roles }
      );
    }
  );

  // 6. Acknowledge Alert (Operator Only)
  app.post(
    '/api/v1/sre/alerts/:id/acknowledge',
    { preHandler: [authenticate, requirePermission('system:admin')] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = req.user!;
      return TenantContextManager.withTenant(
        user.tenantId,
        user.organizationId || 'default',
        async () => {
          const { id } = req.params as { id: string };
          await service.acknowledgeAlert(id);
          return reply.send({ success: true, alertId: id, status: 'acknowledged' });
        },
        { userId: user.userId, roles: user.roles }
      );
    }
  );

  // 7. Resolve Alert (Operator Only)
  app.post(
    '/api/v1/sre/alerts/:id/resolve',
    { preHandler: [authenticate, requirePermission('system:admin')] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const user = req.user!;
      return TenantContextManager.withTenant(
        user.tenantId,
        user.organizationId || 'default',
        async () => {
          const { id } = req.params as { id: string };
          await service.resolveAlert(id);
          return reply.send({ success: true, alertId: id, status: 'resolved' });
        },
        { userId: user.userId, roles: user.roles }
      );
    }
  );
}
