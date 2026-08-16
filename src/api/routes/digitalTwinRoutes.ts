/**
 * Xylarc AI — Business Digital Twin & KPI REST Routes
 * Endpoints for Org Context Graph, KPI Evaluations & Bottleneck Diagnostics (§13, §14, §15 of CLAUDE.md).
 */

import { FastifyInstance } from 'fastify';
import {
  CreateEntityRequestSchema,
  CreateRelationshipRequestSchema,
  CreateKpiRequestSchema,
} from '../../digitaltwin/types/digitalTwinTypes.js';
import { DigitalTwinService } from '../../digitaltwin/service/digitalTwinService.js';
import { authenticate } from '../middleware/authMiddleware.js';
import { requirePermission } from '../middleware/rbacMiddleware.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';
import { z } from 'zod';

const RunDiagnosticsSchema = z.object({
  funnel: z
    .object({
      totalLeads: z.number().int().nonnegative(),
      qualifiedLeads: z.number().int().nonnegative(),
      bookedAppointments: z.number().int().nonnegative(),
      closedWonCustomers: z.number().int().nonnegative(),
      averageContractValueUsd: z.number().positive().optional(),
    })
    .optional(),
  support: z
    .object({
      totalTickets: z.number().int().nonnegative(),
      escalatedToHumanCount: z.number().int().nonnegative(),
      slaBreachCount: z.number().int().nonnegative(),
      averageFirstResponseSeconds: z.number().nonnegative(),
      highChurnRiskCount: z.number().int().nonnegative(),
    })
    .optional(),
});

export async function digitalTwinRoutes(fastify: FastifyInstance): Promise<void> {
  const service = new DigitalTwinService();

  // 1. Create Entity
  fastify.post(
    '/api/v1/digital-twin/entities',
    { preHandler: [authenticate, requirePermission('org:write')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const body = CreateEntityRequestSchema.parse(request.body);
        const result = await service.createEntity(body);
        return reply.status(201).send(result);
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 2. Create Relationship Edge
  fastify.post(
    '/api/v1/digital-twin/relationships',
    { preHandler: [authenticate, requirePermission('org:write')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const body = CreateRelationshipRequestSchema.parse(request.body);
        const result = await service.createRelationship(body);
        return reply.status(201).send(result);
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 3. Get Organizational Graph View
  fastify.get(
    '/api/v1/digital-twin/graph',
    { preHandler: [authenticate, requirePermission('org:read')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const graph = await service.getOrganizationGraph();
        return reply.status(200).send(graph);
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 4. Record/Update KPI
  fastify.post(
    '/api/v1/digital-twin/kpis',
    { preHandler: [authenticate, requirePermission('org:write')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const body = CreateKpiRequestSchema.parse(request.body);
        const result = await service.recordKpi(body);
        return reply.status(201).send(result);
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 5. List Evaluated KPIs
  fastify.get(
    '/api/v1/digital-twin/kpis',
    { preHandler: [authenticate, requirePermission('org:read')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const result = await service.listEvaluatedKpis();
        return reply.status(200).send(result);
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 6. Run Operational Diagnostics (Bottlenecks & Leaks)
  fastify.post(
    '/api/v1/digital-twin/diagnose',
    { preHandler: [authenticate, requirePermission('org:read')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const body = RunDiagnosticsSchema.parse(request.body);
        const bottlenecks = await service.runDiagnostics(body);
        return reply.status(200).send({ bottlenecks, count: bottlenecks.length });
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 7. List Detected Bottlenecks
  fastify.get(
    '/api/v1/digital-twin/bottlenecks',
    { preHandler: [authenticate, requirePermission('org:read')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const bottlenecks = await service.listBottlenecks();
        return reply.status(200).send({ bottlenecks, count: bottlenecks.length });
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 8. Bootstrap Standard Organization Structure
  fastify.post(
    '/api/v1/digital-twin/bootstrap',
    { preHandler: [authenticate, requirePermission('org:write')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const result = await service.bootstrapStandardTwin();
        return reply.status(200).send(result);
      }, { userId: user.userId, roles: user.roles });
    }
  );
}
