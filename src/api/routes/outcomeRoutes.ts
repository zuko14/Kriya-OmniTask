/**
 * Kriya Omnitask — Outcome Instrumentation & Blueprint KPI REST API Routes
 * (docs/kriya WP-6.1, Blueprint §14, CLAUDE.md §35, §39; ADR-024)
 *
 * Exposes multi-tenant endpoints for Blueprint KPI overviews, Cost per Outcome reports
 * (designed for WP-7.5 UI screen), Client Value Reports, and cascade event logging.
 */

import { FastifyInstance } from 'fastify';
import { OutcomeInstrumentationService } from '../../outcomes/service/outcomeInstrumentationService.js';
import {
  OutcomeKpiQuerySchema,
  RecordCascadeEventSchema,
} from '../../outcomes/types/outcomeKpiTypes.js';
import { authenticate } from '../middleware/authMiddleware.js';
import { requirePermission } from '../middleware/rbacMiddleware.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';

export async function outcomeRoutes(fastify: FastifyInstance): Promise<void> {
  const service = new OutcomeInstrumentationService();

  /**
   * 1. GET /api/v1/outcomes/kpis
   * Returns the full Blueprint KPI Overview (all 6 core metrics, cascade mix, agent/workflow rollups).
   */
  fastify.get(
    '/api/v1/outcomes/kpis',
    { preHandler: [authenticate, requirePermission('tenant:read')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(
        user.tenantId,
        user.organizationId || 'default',
        async () => {
          const query = OutcomeKpiQuerySchema.parse(request.query || {});
          const overview = await service.getBlueprintKpiOverview(query);
          return reply.status(200).send(overview);
        },
        { userId: user.userId, roles: user.roles }
      );
    }
  );

  /**
   * 2. GET /api/v1/outcomes/cost-per-outcome
   * Dedicated endpoint for the WP-7.5 "Cost per Outcome" UI screen.
   */
  fastify.get(
    '/api/v1/outcomes/cost-per-outcome',
    { preHandler: [authenticate, requirePermission('tenant:read')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(
        user.tenantId,
        user.organizationId || 'default',
        async () => {
          const query = OutcomeKpiQuerySchema.parse(request.query || {});
          const report = await service.getCostPerOutcomeReport(query);
          return reply.status(200).send(report);
        },
        { userId: user.userId, roles: user.roles }
      );
    }
  );

  /**
   * 3. GET /api/v1/outcomes/client-value-report
   * Periodic Client Value Report (tasks completed, hours avoided, revenue influenced, net ROI).
   */
  fastify.get(
    '/api/v1/outcomes/client-value-report',
    { preHandler: [authenticate, requirePermission('tenant:read')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(
        user.tenantId,
        user.organizationId || 'default',
        async () => {
          const query = OutcomeKpiQuerySchema.parse(request.query || {});
          const overview = await service.getBlueprintKpiOverview(query);
          return reply.status(200).send(overview.clientValueReport);
        },
        { userId: user.userId, roles: user.roles }
      );
    }
  );

  /**
   * 4. POST /api/v1/outcomes/cascade-event
   * Telemetry ingestion for cost cascade (L0-L3) execution events.
   */
  fastify.post(
    '/api/v1/outcomes/cascade-event',
    { preHandler: [authenticate, requirePermission('tenant:write')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(
        user.tenantId,
        user.organizationId || 'default',
        async () => {
          const body = RecordCascadeEventSchema.parse(request.body);
          const event = await service.recordCascadeEvent(body);
          return reply.status(201).send(event);
        },
        { userId: user.userId, roles: user.roles }
      );
    }
  );
}
