/**
 * Kriya AI — Agent Observability & Distributed Tracing REST Routes
 * Endpoints for Prometheus Exposition (/metrics), Distributed Waterfall Traces,
 * Multi-Window SLO Burn Rate Alerting, and W3C Span Queries (§WP-8.3, Milestone M8).
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  ListTracesQuerySchema,
  SpanStepTypeEnum,
  SpanStatusEnum,
} from '../../observability/types/observabilityTypes.js';
import { ObservabilityService } from '../../observability/service/observabilityService.js';
import { globalPrometheusRegistry, PrometheusRegistry } from '../../observability/metrics/prometheusRegistry.js';
import { SloEvaluationEngine } from '../../observability/slo/sloEvaluationEngine.js';
import { SreService } from '../../sre/service/sreService.js';
import { SreRepository } from '../../sre/repositories/sreRepository.js';
import { TraceRepository } from '../../observability/repositories/traceRepository.js';
import { authenticate } from '../middleware/authMiddleware.js';
import { requirePermission } from '../middleware/rbacMiddleware.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';
import { db } from '../../storage/db.js';
import { z } from 'zod';
import { ValidationError } from '../../core/errors/errors.js';

const EvaluateDriftBodySchema = z.object({
  modelFinalOutput: z.string().optional(),
  retrievedEvidence: z.array(z.string()).default([]),
});

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

const ListSpansQuerySchema = z.object({
  traceId: z.string().optional(),
  parentSpanId: z.string().optional(),
  agentId: z.string().optional(),
  stepType: SpanStepTypeEnum.optional(),
  status: SpanStatusEnum.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export async function observabilityRoutes(fastify: FastifyInstance): Promise<void> {
  const service = new ObservabilityService();
  const sreRepo = new SreRepository(db.getClient());
  const traceRepo = new TraceRepository(db.getClient());
  const sreService = new SreService(sreRepo, traceRepo);
  const sloEngine = new SloEvaluationEngine(db.getClient(), sreRepo);

  // 1. Prometheus Standard Scrape Endpoint (Public/Scraper format)
  fastify.get('/metrics', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply
      .header('Content-Type', PrometheusRegistry.CONTENT_TYPE)
      .send(globalPrometheusRegistry.metrics());
  });

  // 2. Authenticated Prometheus Metrics Endpoint
  fastify.get(
    '/api/v1/observability/metrics/prometheus',
    { preHandler: [authenticate, requirePermission('audit:read')] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      return reply
        .header('Content-Type', PrometheusRegistry.CONTENT_TYPE)
        .send(globalPrometheusRegistry.metrics());
    }
  );

  // 3. List Traces with Filters
  fastify.get(
    '/api/v1/observability/traces',
    { preHandler: [authenticate, requirePermission('audit:read')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const query = ListTracesQuerySchema.parse(request.query);
        const traces = await service.listTraces({
          agentId: query.agentId,
          status: query.status,
          driftOnly: query.driftOnly === 'true',
          limit: query.limit,
        });
        return reply.status(200).send({ traces, count: traces.length });
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 4. Get Trace Waterfall View
  fastify.get(
    '/api/v1/observability/traces/:id',
    { preHandler: [authenticate, requirePermission('audit:read')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const { id } = request.params as { id: string };
        const waterfall = await service.getTraceWaterfall(id);
        return reply.status(200).send(waterfall);
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 5. Get Telemetry & Metrics Overview (JSON)
  fastify.get(
    '/api/v1/observability/metrics',
    { preHandler: [authenticate, requirePermission('audit:read')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const overview = await service.getMetricsOverview();
        return reply.status(200).send(overview);
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 6. Re-evaluate Drift on Trace
  fastify.post(
    '/api/v1/observability/traces/:id/evaluate-drift',
    { preHandler: [authenticate, requirePermission('audit:read')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const { id } = request.params as { id: string };
        const body = EvaluateDriftBodySchema.parse(request.body || {});
        const finalized = await service.completeTrace(id, {
          modelFinalOutput: body.modelFinalOutput,
          retrievedEvidence: body.retrievedEvidence,
        });
        return reply.status(200).send(finalized);
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 7. Get Decision Trace Timeline for Run or Trace ID
  fastify.get(
    '/api/v1/observability/decision-traces/:id',
    { preHandler: [authenticate, requirePermission('audit:read')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const { id } = request.params as { id: string };
        const decisionTrace = await service.getDecisionTrace(id, user.tenantId);
        return reply.status(200).send(decisionTrace);
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 8. Define New SLO (System Admin)
  fastify.post(
    '/api/v1/observability/slos',
    { preHandler: [authenticate, requirePermission('system:admin')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const parse = CreateSloBodySchema.safeParse(request.body);
        if (!parse.success) {
          throw new ValidationError('Invalid SLO parameters', { issues: parse.error.issues });
        }
        const slo = await sreService.createSlo(
          parse.data.name,
          parse.data.serviceName,
          parse.data.targetMetric,
          parse.data.targetThreshold,
          parse.data.windowDays
        );
        return reply.status(201).send(slo);
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 9. List SLOs
  fastify.get(
    '/api/v1/observability/slos',
    { preHandler: [authenticate, requirePermission('audit:read')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const slos = await sreService.listSlos();
        return reply.status(200).send({ count: slos.length, slos });
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 10. Evaluate SLO with Multi-Window Burn Rate & Auto-Escalation
  fastify.post(
    '/api/v1/observability/slos/:id/evaluate',
    { preHandler: [authenticate, requirePermission('system:admin')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const { id } = request.params as { id: string };
        const parse = EvaluateSloBodySchema.safeParse(request.body);
        if (!parse.success) {
          throw new ValidationError('Invalid SLO evaluation payload', { issues: parse.error.issues });
        }

        const result = await sloEngine.evaluateSlo(user.tenantId, id, parse.data.actualMetricValue);
        return reply.status(200).send(result);
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 11. List SLO Incident Alerts
  fastify.get(
    '/api/v1/observability/alerts',
    { preHandler: [authenticate, requirePermission('audit:read')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const query = request.query as { status?: string };
        const incidents = await sloEngine.listIncidents(user.tenantId, query.status);
        const sreAlerts = await sreService.listAlerts(query.status as any);
        return reply.status(200).send({
          count: incidents.length,
          incidents,
          sreAlerts,
        });
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 12. Acknowledge Alert Incident
  fastify.post(
    '/api/v1/observability/alerts/:id/acknowledge',
    { preHandler: [authenticate, requirePermission('system:admin')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const { id } = request.params as { id: string };
        await sloEngine.acknowledgeIncident(user.tenantId, id);
        try {
          await sreService.acknowledgeAlert(id);
        } catch {}
        return reply.status(200).send({ success: true, alertId: id, status: 'acknowledged' });
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 13. Resolve Alert Incident
  fastify.post(
    '/api/v1/observability/alerts/:id/resolve',
    { preHandler: [authenticate, requirePermission('system:admin')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const { id } = request.params as { id: string };
        await sloEngine.resolveIncident(user.tenantId, id);
        try {
          await sreService.resolveAlert(id);
        } catch {}
        return reply.status(200).send({ success: true, alertId: id, status: 'resolved' });
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 14. Search Distributed Spans with Filters
  fastify.get(
    '/api/v1/observability/spans',
    { preHandler: [authenticate, requirePermission('audit:read')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const query = ListSpansQuerySchema.parse(request.query);
        const spans = await service.searchSpans({
          tenantId: user.tenantId,
          traceId: query.traceId,
          parentSpanId: query.parentSpanId,
          agentId: query.agentId,
          stepType: query.stepType,
          status: query.status,
          limit: query.limit,
        });
        return reply.status(200).send({ spans, count: spans.length });
      }, { userId: user.userId, roles: user.roles });
    }
  );
}
