/**
 * Kriya Omnitask — Secured External Retrieval REST API Routes (§10.3, §10.4)
 * Endpoints for executing secured retrieval pipelines, managing agent search grants,
 * inspecting domain reputation, and verifying action evidence justification.
 */

import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { SecuredRetrievalPipeline } from '../../retrieval/external/services/securedRetrievalPipeline.js';
import { ExternalRetrievalRepository } from '../../retrieval/external/repositories/externalRetrievalRepository.js';
import { ExternalFactGovernance } from '../../retrieval/external/governance/externalFactGovernance.js';
import {
  TypedInformationNeedSchema,
  TrustTierSchema,
} from '../../retrieval/external/types/externalRetrievalTypes.js';
import { authenticate } from '../middleware/authMiddleware.js';
import { requirePermission } from '../middleware/rbacMiddleware.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';
import { CryptoUtils } from '../../core/utils/crypto.js';

const SaveSearchGrantSchema = z.object({
  enabled: z.boolean(),
  allowedDomains: z.array(z.string()).default([]),
  maxDailyQueries: z.number().int().positive().default(100),
});

const ValidateActionEvidenceSchema = z.object({
  actionRiskTier: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  evidenceList: z.array(
    z.object({
      factText: z.string(),
      trustTier: TrustTierSchema,
      source: z.string(),
      retrievedAt: z.string().optional(),
    })
  ),
});

const EvaluateConflictSchema = z.object({
  fieldName: z.string(),
  externalFact: z.object({
    value: z.unknown(),
    sourceUrl: z.string(),
    trustTier: TrustTierSchema,
    citation: z.string(),
  }),
  systemOfRecordFact: z.object({
    value: z.unknown(),
    sourceName: z.string(),
    trustTier: z.literal('TIER_A'),
  }),
  agentSlug: z.string(),
  taskId: z.string().optional(),
});

export const externalRetrievalRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const repo = new ExternalRetrievalRepository();
  const pipeline = new SecuredRetrievalPipeline(repo);
  const governance = new ExternalFactGovernance();

  // 1. Execute Secured External Retrieval Pipeline (§10.3)
  fastify.post(
    '/api/v1/retrieval/external/execute',
    { preHandler: [authenticate, requirePermission('agent:read')] },
    async (request, reply) => {
      const user = request.user!;
      const tenantId = user.tenantId;
      const correlationId = (request.headers['x-correlation-id'] as string) || CryptoUtils.generateCorrelationId();
      const body = TypedInformationNeedSchema.parse(request.body);

      return TenantContextManager.withTenant(tenantId, user.organizationId || 'default', async () => {
        const result = await pipeline.executePipeline(tenantId, correlationId, body);
        return reply.status(result.success ? 200 : 403).send(result);
      }, { correlationId });
    }
  );

  // 2. List Search Grants for Tenant Agents (§10.4)
  fastify.get(
    '/api/v1/retrieval/external/grants',
    { preHandler: [authenticate, requirePermission('agent:read')] },
    async (request, reply) => {
      const user = request.user!;
      const tenantId = user.tenantId;

      return TenantContextManager.withTenant(tenantId, user.organizationId || 'default', async () => {
        const grants = await repo.listSearchGrants(tenantId);
        return reply.status(200).send({ grants, count: grants.length });
      });
    }
  );

  // 3. Configure Agent Search Grant (§10.4)
  fastify.put(
    '/api/v1/retrieval/external/grants/:agentSlug',
    { preHandler: [authenticate, requirePermission('agent:write')] },
    async (request, reply) => {
      const user = request.user!;
      const tenantId = user.tenantId;
      const { agentSlug } = request.params as { agentSlug: string };
      const body = SaveSearchGrantSchema.parse(request.body);

      return TenantContextManager.withTenant(tenantId, user.organizationId || 'default', async () => {
        const existing = await repo.getSearchGrant(tenantId, agentSlug);
        const grant = await repo.saveSearchGrant({
          id: existing?.id || `grant_${CryptoUtils.generateId()}`,
          tenantId,
          agentSlug,
          enabled: body.enabled,
          allowedDomains: body.allowedDomains,
          maxDailyQueries: body.maxDailyQueries,
          createdAt: existing?.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });

        return reply.status(200).send(grant);
      });
    }
  );

  // 4. Domain Reputation & Denylist Ledger (§10.4)
  fastify.get(
    '/api/v1/retrieval/external/domains/reputation',
    { preHandler: [authenticate, requirePermission('system:admin')] },
    async (request, reply) => {
      const denylisted = await repo.listDenylistedDomains();
      return reply.status(200).send({ denylistedDomains: denylisted, count: denylisted.length });
    }
  );

  // 5. Action Justification Validation (§10.2)
  fastify.post(
    '/api/v1/retrieval/external/validate-action',
    { preHandler: [authenticate, requirePermission('agent:read')] },
    async (request, reply) => {
      const body = ValidateActionEvidenceSchema.parse(request.body);
      const result = ExternalFactGovernance.validateActionJustification(
        body.actionRiskTier,
        body.evidenceList
      );
      return reply.status(200).send(result);
    }
  );

  // 6. System of Record Conflict Evaluation (§10.2)
  fastify.post(
    '/api/v1/retrieval/external/evaluate-conflict',
    { preHandler: [authenticate, requirePermission('agent:read')] },
    async (request, reply) => {
      const user = request.user!;
      const tenantId = user.tenantId;
      const correlationId = (request.headers['x-correlation-id'] as string) || CryptoUtils.generateCorrelationId();
      const body = EvaluateConflictSchema.parse(request.body);

      return TenantContextManager.withTenant(tenantId, user.organizationId || 'default', async () => {
        const result = await governance.evaluateConflictWithSystemOfRecord(tenantId, {
          fieldName: body.fieldName,
          externalFact: body.externalFact,
          systemOfRecordFact: body.systemOfRecordFact,
          agentSlug: body.agentSlug,
          correlationId,
          taskId: body.taskId,
        });

        return reply.status(200).send(result);
      }, { correlationId });
    }
  );
};
