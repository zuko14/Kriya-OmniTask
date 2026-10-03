/**
 * Kriya AI — India DPDP Operations REST API Routes
 * Endpoints for Consent Ledger (§6, §7), Data Principal Rights Requests (SAR §11–§14),
 * Automated Retention Purge (§8(7)), and DPBI Breach Governance (§8(6)).
 */

import { FastifyInstance } from 'fastify';
import {
  GrantConsentInputSchema,
  WithdrawConsentInputSchema,
  SubmitRightsRequestInputSchema,
  ExecuteRightsRequestInputSchema,
  ExecuteRetentionJobInputSchema,
  ReportBreachIncidentInputSchema,
} from '../../dpdp/types/dpdpTypes.js';
import { DpdpService } from '../../dpdp/service/dpdpService.js';
import { authenticate } from '../middleware/authMiddleware.js';
import { requirePermission } from '../middleware/rbacMiddleware.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';

export async function dpdpRoutes(fastify: FastifyInstance): Promise<void> {
  const service = new DpdpService();

  // ==========================================
  // 1. Consent Ledger (§6, §7 DPDP Act 2023)
  // ==========================================

  // Grant purpose-bound consent
  fastify.post(
    '/api/v1/dpdp/consent/grant',
    { preHandler: [authenticate, requirePermission('tenant:write')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(
        user.tenantId,
        user.organizationId || 'default',
        async () => {
          const body = GrantConsentInputSchema.parse(request.body);
          const result = await service.grantConsent(body);
          return reply.status(201).send(result);
        },
        { userId: user.userId, roles: user.roles }
      );
    }
  );

  // Withdraw consent
  fastify.post(
    '/api/v1/dpdp/consent/withdraw',
    { preHandler: [authenticate, requirePermission('tenant:write')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(
        user.tenantId,
        user.organizationId || 'default',
        async () => {
          const body = WithdrawConsentInputSchema.parse(request.body);
          const result = await service.withdrawConsent(body);
          return reply.status(200).send(result);
        },
        { userId: user.userId, roles: user.roles }
      );
    }
  );

  // Get active consent
  fastify.get(
    '/api/v1/dpdp/consent/active',
    { preHandler: [authenticate, requirePermission('tenant:read')] },
    async (request, reply) => {
      const user = request.user!;
      const query = request.query as { customerId?: string; purpose?: string };
      if (!query.customerId || !query.purpose) {
        return reply.status(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'customerId and purpose query parameters are required',
          },
        });
      }

      return TenantContextManager.withTenant(
        user.tenantId,
        user.organizationId || 'default',
        async () => {
          const consent = await service.getActiveConsent(query.customerId!, query.purpose!);
          return reply.status(200).send({ consent });
        },
        { userId: user.userId, roles: user.roles }
      );
    }
  );

  // Get consent history for customer
  fastify.get(
    '/api/v1/dpdp/consent/history/:customerId',
    { preHandler: [authenticate, requirePermission('tenant:read')] },
    async (request, reply) => {
      const user = request.user!;
      const params = request.params as { customerId: string };

      return TenantContextManager.withTenant(
        user.tenantId,
        user.organizationId || 'default',
        async () => {
          const history = await service.listConsentHistory(params.customerId);
          return reply.status(200).send({ history, count: history.length });
        },
        { userId: user.userId, roles: user.roles }
      );
    }
  );

  // ==========================================
  // 2. Data Principal Rights Requests (SAR §11 - §14)
  // ==========================================

  // Submit rights request
  fastify.post(
    '/api/v1/dpdp/rights/submit',
    { preHandler: [authenticate, requirePermission('tenant:write')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(
        user.tenantId,
        user.organizationId || 'default',
        async () => {
          const body = SubmitRightsRequestInputSchema.parse(request.body);
          const record = await service.submitRightsRequest(body);
          return reply.status(201).send(record);
        },
        { userId: user.userId, roles: user.roles }
      );
    }
  );

  // List rights requests
  fastify.get(
    '/api/v1/dpdp/rights/list',
    { preHandler: [authenticate, requirePermission('tenant:read')] },
    async (request, reply) => {
      const user = request.user!;
      const query = request.query as any;

      return TenantContextManager.withTenant(
        user.tenantId,
        user.organizationId || 'default',
        async () => {
          const requests = await service.listRightsRequests({
            customerId: query?.customerId,
            status: query?.status,
            requestType: query?.requestType,
          });
          return reply.status(200).send({ requests, count: requests.length });
        },
        { userId: user.userId, roles: user.roles }
      );
    }
  );

  // Get single rights request
  fastify.get(
    '/api/v1/dpdp/rights/:id',
    { preHandler: [authenticate, requirePermission('tenant:read')] },
    async (request, reply) => {
      const user = request.user!;
      const params = request.params as { id: string };

      return TenantContextManager.withTenant(
        user.tenantId,
        user.organizationId || 'default',
        async () => {
          const reqRecord = await service.getRightsRequest(params.id);
          return reply.status(200).send(reqRecord);
        },
        { userId: user.userId, roles: user.roles }
      );
    }
  );

  // Execute rights request
  fastify.post(
    '/api/v1/dpdp/rights/execute',
    { preHandler: [authenticate, requirePermission('tenant:write')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(
        user.tenantId,
        user.organizationId || 'default',
        async () => {
          const body = ExecuteRightsRequestInputSchema.parse(request.body);
          const result = await service.executeRightsRequest(body);
          return reply.status(200).send(result);
        },
        { userId: user.userId, roles: user.roles }
      );
    }
  );

  // ==========================================
  // 3. Automated Retention Purges (§8(7))
  // ==========================================

  // Execute retention purge
  fastify.post(
    '/api/v1/dpdp/retention/purge',
    { preHandler: [authenticate, requirePermission('tenant:write')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(
        user.tenantId,
        user.organizationId || 'default',
        async () => {
          const body = ExecuteRetentionJobInputSchema.parse(request.body);
          const result = await service.runRetentionPurge(body);
          return reply.status(200).send(result);
        },
        { userId: user.userId, roles: user.roles }
      );
    }
  );

  // List retention jobs
  fastify.get(
    '/api/v1/dpdp/retention/jobs',
    { preHandler: [authenticate, requirePermission('tenant:read')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(
        user.tenantId,
        user.organizationId || 'default',
        async () => {
          const jobs = await service.listRetentionJobs();
          return reply.status(200).send({ jobs, count: jobs.length });
        },
        { userId: user.userId, roles: user.roles }
      );
    }
  );

  // ==========================================
  // 4. Breach Incident Governance (§8(6))
  // ==========================================

  // Report breach incident
  fastify.post(
    '/api/v1/dpdp/breach/report',
    { preHandler: [authenticate, requirePermission('tenant:write')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(
        user.tenantId,
        user.organizationId || 'default',
        async () => {
          const body = ReportBreachIncidentInputSchema.parse(request.body);
          const result = await service.reportBreachIncident(body);
          return reply.status(201).send(result);
        },
        { userId: user.userId, roles: user.roles }
      );
    }
  );

  // List breach incidents
  fastify.get(
    '/api/v1/dpdp/breach/list',
    { preHandler: [authenticate, requirePermission('tenant:read')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(
        user.tenantId,
        user.organizationId || 'default',
        async () => {
          const incidents = await service.listBreachIncidents();
          return reply.status(200).send({ incidents, count: incidents.length });
        },
        { userId: user.userId, roles: user.roles }
      );
    }
  );

  // Get single breach incident
  fastify.get(
    '/api/v1/dpdp/breach/:id',
    { preHandler: [authenticate, requirePermission('tenant:read')] },
    async (request, reply) => {
      const user = request.user!;
      const params = request.params as { id: string };

      return TenantContextManager.withTenant(
        user.tenantId,
        user.organizationId || 'default',
        async () => {
          const incident = await service.getBreachIncident(params.id);
          return reply.status(200).send(incident);
        },
        { userId: user.userId, roles: user.roles }
      );
    }
  );

  // Generate DPBI notification package
  fastify.get(
    '/api/v1/dpdp/breach/:id/dpbi-package',
    { preHandler: [authenticate, requirePermission('tenant:read')] },
    async (request, reply) => {
      const user = request.user!;
      const params = request.params as { id: string };

      return TenantContextManager.withTenant(
        user.tenantId,
        user.organizationId || 'default',
        async () => {
          const pkg = await service.generateDpbiNotificationPackage(params.id);
          return reply.status(200).send(pkg);
        },
        { userId: user.userId, roles: user.roles }
      );
    }
  );

  // Mark affected principals notified
  fastify.post(
    '/api/v1/dpdp/breach/:id/mark-principals-notified',
    { preHandler: [authenticate, requirePermission('tenant:write')] },
    async (request, reply) => {
      const user = request.user!;
      const params = request.params as { id: string };

      return TenantContextManager.withTenant(
        user.tenantId,
        user.organizationId || 'default',
        async () => {
          const incident = await service.markPrincipalsNotified(params.id);
          return reply.status(200).send(incident);
        },
        { userId: user.userId, roles: user.roles }
      );
    }
  );
}
