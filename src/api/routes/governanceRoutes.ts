/**
 * Xylarc AI — Enterprise Governance REST API Routes
 * Endpoints for organization hierarchy, ABAC evaluation, SSO/OIDC config, and data retention policies (§10–§14, §24).
 */

import { FastifyInstance } from 'fastify';
import { GovernanceService } from '../../governance/service/governanceService.js';
import {
  CreateOrgUnitRequestSchema,
  UpsertSsoConfigRequestSchema,
  SsoExchangeRequestSchema,
  AbacEvaluationRequestSchema,
  UpsertRetentionPolicyRequestSchema,
  SsoProviderType,
} from '../../governance/types/governanceTypes.js';
import { authenticate } from '../middleware/authMiddleware.js';
import { requirePermission } from '../middleware/rbacMiddleware.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';

export async function governanceRoutes(fastify: FastifyInstance): Promise<void> {
  const service = new GovernanceService();

  // 1. Create Organization Unit
  fastify.post(
    '/api/v1/governance/org-units',
    { preHandler: [authenticate, requirePermission('tenant:write')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const body = CreateOrgUnitRequestSchema.parse(request.body);
        const unit = await service.createOrgUnit(body);
        return reply.status(201).send(unit);
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 2. List Org Units
  fastify.get(
    '/api/v1/governance/org-units',
    { preHandler: [authenticate, requirePermission('tenant:read')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const units = await service.listOrgUnits();
        return reply.status(200).send({ units, count: units.length });
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 3. Get Hierarchy Tree
  fastify.get(
    '/api/v1/governance/org-units/tree',
    { preHandler: [authenticate, requirePermission('tenant:read')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const tree = await service.getOrgHierarchyTree();
        return reply.status(200).send({ tree });
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 4. Upsert SSO Configuration
  fastify.post(
    '/api/v1/governance/sso/config',
    { preHandler: [authenticate, requirePermission('tenant:write')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const body = UpsertSsoConfigRequestSchema.parse(request.body);
        const config = await service.upsertSsoConfig(body);
        return reply.status(200).send(config);
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 5. Get SSO Configuration
  fastify.get(
    '/api/v1/governance/sso/config',
    { preHandler: [authenticate, requirePermission('tenant:read')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const { provider } = request.query as { provider?: SsoProviderType };
        const config = await service.getSsoConfig(provider || 'okta');
        return reply.status(200).send(config || { message: 'SSO provider not configured.' });
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 6. SSO Exchange Endpoint
  fastify.post(
    '/api/v1/governance/sso/exchange',
    async (request, reply) => {
      const { tenantId } = (request.query as { tenantId?: string }) || {};
      if (!tenantId) {
        return reply.status(400).send({ error: 'tenantId query parameter is required for SSO token exchange.' });
      }

      return TenantContextManager.withTenant(tenantId, 'default', async () => {
        const body = SsoExchangeRequestSchema.parse(request.body);
        const result = await service.exchangeSsoToken(body);
        return reply.status(200).send(result);
      });
    }
  );

  // 7. Dynamic ABAC Evaluation
  fastify.post(
    '/api/v1/governance/abac/evaluate',
    { preHandler: [authenticate, requirePermission('tenant:read')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const body = AbacEvaluationRequestSchema.parse(request.body);
        const result = await service.evaluateAbac(body);
        return reply.status(200).send(result);
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 8. Upsert Retention Policy
  fastify.post(
    '/api/v1/governance/retention/policies',
    { preHandler: [authenticate, requirePermission('tenant:write')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const body = UpsertRetentionPolicyRequestSchema.parse(request.body);
        const policy = await service.upsertRetentionPolicy(body);
        return reply.status(200).send(policy);
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 9. List Retention Policies
  fastify.get(
    '/api/v1/governance/retention/policies',
    { preHandler: [authenticate, requirePermission('tenant:read')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const policies = await service.listRetentionPolicies();
        return reply.status(200).send({ policies, count: policies.length });
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 10. Execute Retention Purge Simulation
  fastify.post(
    '/api/v1/governance/retention/purge-plan',
    { preHandler: [authenticate, requirePermission('tenant:write')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const audits = await service.executeRetentionPurgeSimulation();
        return reply.status(200).send({ audits, count: audits.length });
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 11. List Retention Purge Audits
  fastify.get(
    '/api/v1/governance/retention/audits',
    { preHandler: [authenticate, requirePermission('tenant:read')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const { limit } = request.query as { limit?: string };
        const parsedLimit = limit ? parseInt(limit, 10) : 50;
        const audits = await service.listPurgeAudits(parsedLimit);
        return reply.status(200).send({ audits, count: audits.length });
      }, { userId: user.userId, roles: user.roles });
    }
  );
}
