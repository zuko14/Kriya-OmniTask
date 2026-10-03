/**
 * Kriya AI — Model Certification & Alignment REST Routes
 * Authenticated endpoints for model certifications, alignment checks, and task routing.
 */

import { FastifyPluginAsync } from 'fastify';
import { ModelCertificationRepository } from '../../model/certification/modelCertificationRepository.js';
import { AlignmentCheckHarness } from '../../model/certification/alignmentCheckHarness.js';
import { CertifiedModelRouter } from '../../model/certification/certifiedModelRouter.js';
import { CapabilityTier } from '../../model/certification/certificationTypes.js';
import { authenticate } from '../middleware/authMiddleware.js';
import { requirePermission } from '../middleware/rbacMiddleware.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';

export const modelCertificationRoutes: FastifyPluginAsync = async (fastify) => {
  const certRepo = new ModelCertificationRepository();
  const harness = new AlignmentCheckHarness(certRepo);
  const router = new CertifiedModelRouter(certRepo);

  // 1. List all certifications or filter by tier/lang/status
  fastify.get('/api/v1/models/certifications', {
    preHandler: [authenticate, requirePermission('agent:read')],
  }, async (request, reply) => {
    const user = request.user!;
    return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
      const query = request.query as { status?: any; tier?: CapabilityTier; language?: string };
      const certs = await certRepo.listAllCertifications(query);
      return reply.send({ success: true, count: certs.length, certifications: certs });
    }, { userId: user.userId, roles: user.roles });
  });

  // 2. Get certification matrix for a specific model
  fastify.get('/api/v1/models/:modelId/matrix', {
    preHandler: [authenticate, requirePermission('agent:read')],
  }, async (request, reply) => {
    const user = request.user!;
    return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
      const { modelId } = request.params as { modelId: string };
      const matrix = await certRepo.getCertificationMatrix(modelId);
      return reply.send({ success: true, modelId, matrix });
    }, { userId: user.userId, roles: user.roles });
  });

  // 3. Run 7-stage alignment check (§9.7)
  fastify.post('/api/v1/models/alignment-check', {
    preHandler: [authenticate, requirePermission('agent:deploy')],
  }, async (request, reply) => {
    const user = request.user!;
    return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
      const body = request.body as {
        modelId: string;
        modelVersion: string;
        provider: string;
        upstreamProvider?: string;
        tiers?: CapabilityTier[];
        languages?: string[];
      };
      const reportCard = await harness.runAlignmentCheck({
        ...body,
        tenantId: user.tenantId,
      });
      return reply.send({ success: true, reportCard });
    }, { userId: user.userId, roles: user.roles });
  });

  // 4. Invalidate certifications on model version or upstream router change (§9.2, §9.9, §23)
  fastify.post('/api/v1/models/:modelId/invalidate', {
    preHandler: [authenticate, requirePermission('agent:deploy')],
  }, async (request, reply) => {
    const user = request.user!;
    return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
      const { modelId } = request.params as { modelId: string };
      const body = request.body as { newVersion: string; newUpstreamProvider?: string };
      const invalidatedCount = await certRepo.invalidateOnVersionOrUpstreamChange(
        modelId,
        body.newVersion,
        body.newUpstreamProvider
      );
      return reply.send({ success: true, modelId, invalidatedCount });
    }, { userId: user.userId, roles: user.roles });
  });

  // 5. Route task through certified model router with degradation policy (§9.4)
  fastify.post('/api/v1/models/route-task', {
    preHandler: [authenticate, requirePermission('agent:read')],
  }, async (request, reply) => {
    const user = request.user!;
    return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
      const body = request.body as {
        requiredTier: CapabilityTier;
        language: string;
        taskId: string;
        taskDescription: string;
        forceProviderOutage?: boolean;
      };
      const routeRes = await router.routeTask({
        ...body,
        tenantId: user.tenantId,
      });
      return reply.send({ success: routeRes.success, routing: routeRes });
    }, { userId: user.userId, roles: user.roles });
  });
};
