/**
 * Kriya AI — Brain Supply & Model Registry REST Routes
 * Authenticated endpoints for managing tenant model brains, alignment checks, and credentials.
 */

import { FastifyPluginAsync } from 'fastify';
import { BrainSupplyRepository } from '../../model/brain/repositories/brainSupplyRepository.js';
import { SuitabilityAdvisoryEngine } from '../../model/brain/services/suitabilityAdvisoryEngine.js';
import { BrainCredentialService } from '../../model/brain/services/brainCredentialService.js';
import { AlignmentStreamService } from '../../model/brain/services/alignmentStreamService.js';
import { SpendBudgetAnomalyEngine } from '../../model/brain/services/spendBudgetAnomalyEngine.js';
import { WorkforceCoverageEngine } from '../../model/brain/services/workforceCoverageEngine.js';
import { RecertificationScheduler } from '../../model/brain/services/recertificationScheduler.js';
import { TenantBrainRecord } from '../../model/brain/types/brainSupplyTypes.js';
import { CapabilityTier } from '../../model/certification/certificationTypes.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';
import { authenticate } from '../middleware/authMiddleware.js';
import { requirePermission } from '../middleware/rbacMiddleware.js';
import { logger } from '../../core/logger/logger.js';

export const brainRoutes: FastifyPluginAsync = async (fastify) => {
  const brainRepo = new BrainSupplyRepository();
  const suitabilityEngine = new SuitabilityAdvisoryEngine(brainRepo);
  const credentialService = new BrainCredentialService(undefined, brainRepo);
  const alignmentService = new AlignmentStreamService(brainRepo);
  const budgetEngine = new SpendBudgetAnomalyEngine(brainRepo);
  const coverageEngine = new WorkforceCoverageEngine(brainRepo);
  const recertScheduler = new RecertificationScheduler(brainRepo, undefined, alignmentService);

  // 1. Get Brain Supply Overview (Config, Active Brains, Spend Status, Coverage) (§18.6.1)
  fastify.get('/api/v1/brain/overview', {
    preHandler: [authenticate, requirePermission('agent:read')],
  }, async (request, reply) => {
    const user = request.user!;
    return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
      const tenantId = user.tenantId;
      const config = await brainRepo.getTenantBrainConfig(tenantId);
      const activeBrains = await brainRepo.listTenantBrains(tenantId);
      const spendStatus = await budgetEngine.evaluateSpendStatus(tenantId);
      const coverage = await coverageEngine.evaluateCoverage(tenantId);

      return reply.send({
        success: true,
        config,
        activeBrains,
        spendStatus,
        coverage,
      });
    }, { userId: user.userId, roles: user.roles });
  });

  // 2. Update Tenant Brain Budget / Configuration (§9.8)
  fastify.post('/api/v1/brain/config', {
    preHandler: [authenticate, requirePermission('agent:write')],
  }, async (request, reply) => {
    const user = request.user!;
    return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
      const tenantId = user.tenantId;
      const body = request.body as {
        monthlyBudgetUsd?: number;
        dailyBudgetUsd?: number;
        spendAnomalyThresholdMultiplier?: number;
      };

      const currentConfig = await brainRepo.getTenantBrainConfig(tenantId);
      const updated = await brainRepo.saveTenantBrainConfig({
        ...currentConfig,
        monthlyBudgetUsd: body.monthlyBudgetUsd ?? currentConfig.monthlyBudgetUsd,
        dailyBudgetUsd: body.dailyBudgetUsd ?? currentConfig.dailyBudgetUsd,
        spendAnomalyThresholdMultiplier:
          body.spendAnomalyThresholdMultiplier ?? currentConfig.spendAnomalyThresholdMultiplier,
      });

      return reply.send({ success: true, config: updated });
    }, { userId: user.userId, roles: user.roles });
  });

  // 3. List Model Catalogue with Suitability Advisories (§9.6, §18.6.2 Step 2)
  fastify.get('/api/v1/brain/catalogue', {
    preHandler: [authenticate, requirePermission('agent:read')],
  }, async (request, reply) => {
    const user = request.user!;
    return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
      const query = request.query as { provider?: string };
      const catalogue = await suitabilityEngine.getAvailableCatalogue(query.provider);
      return reply.send({ success: true, count: catalogue.length, catalogue });
    }, { userId: user.userId, roles: user.roles });
  });

  // 4. Validate Provider Key on Blur via Handshake without saving (§9.8, §18.6.2 Step 1)
  fastify.post('/api/v1/brain/validate-key', {
    preHandler: [authenticate, requirePermission('agent:write')],
  }, async (request, reply) => {
    const user = request.user!;
    return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
      const body = request.body as { provider: string; apiKey: string };
      const result = await credentialService.validateKey(body.provider, body.apiKey);
      return reply.send({ success: result.valid, validation: result });
    }, { userId: user.userId, roles: user.roles });
  });

  // 5. Pre-Check Cost Estimate (§18.6.2 Step 3)
  fastify.post('/api/v1/brain/estimate-check', {
    preHandler: [authenticate, requirePermission('agent:read')],
  }, async (request, reply) => {
    const user = request.user!;
    return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
      const body = request.body as { modelId: string; provider?: string; tiers?: CapabilityTier[]; languages?: string[] };
      const tiersCount = body.tiers?.length || 4;
      const languagesCount = body.languages?.length || 3;
      // Live OpenRouter price; when unknown the estimate says so instead of guessing (docs/kriya S23).
      const estimate = await alignmentService.estimateCheckCostLive(body.modelId, body.provider || 'openrouter', tiersCount, languagesCount);
      return reply.send({ success: true, estimate });
    }, { userId: user.userId, roles: user.roles });
  });

  // 6. Start Live Staged Alignment Check (§9.7, §18.6.3)
  fastify.post('/api/v1/brain/alignment-check', {
    preHandler: [authenticate, requirePermission('agent:write')],
  }, async (request, reply) => {
    const user = request.user!;
    return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
      const tenantId = user.tenantId;
      const body = request.body as {
        provider: string;
        modelId: string;
        modelVersion?: string;
        apiKey?: string;
        tiers?: CapabilityTier[];
        languages?: string[];
      };

      // If API key supplied in BYO mode, validate and store securely in vault
      let serviceSlug: string | undefined;
      let keyLastFour: string | undefined;

      if (body.apiKey) {
        const stored = await credentialService.storeValidatedKey(tenantId, body.provider, body.apiKey);
        serviceSlug = stored.serviceSlug;
        keyLastFour = stored.keyLastFour;
      }

      const run = await alignmentService.startAlignmentCheck(
        tenantId,
        body.modelId,
        body.modelVersion || '20241022',
        body.provider,
        body.tiers || ['T1', 'T2', 'T3', 'T4'],
        body.languages || ['en', 'hi', 'te'],
        body.apiKey
      );

      return reply.send({
        success: true,
        runId: run.id,
        keyLastFour,
        serviceSlug,
        run,
      });
    }, { userId: user.userId, roles: user.roles });
  });

  // 7. Get Alignment Check Status & Report Card (§18.6.4)
  fastify.get('/api/v1/brain/alignment-check/:runId', {
    preHandler: [authenticate, requirePermission('agent:read')],
  }, async (request, reply) => {
    const user = request.user!;
    return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
      const { runId } = request.params as { runId: string };
      const run = await brainRepo.getAlignmentRun(runId);
      if (!run) {
        return reply.status(404).send({ success: false, error: 'Alignment run not found' });
      }
      return reply.send({ success: true, run });
    }, { userId: user.userId, roles: user.roles });
  });

  // 8. Stream Real-Time Alignment Check Progress over SSE (§18.6.3, §19)
  fastify.get('/api/v1/brain/alignment-check/:runId/stream', {
    preHandler: [authenticate, requirePermission('agent:read')],
  }, async (request, reply) => {
    const user = request.user!;
    return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
      const { runId } = request.params as { runId: string };

      reply.raw.setHeader('Content-Type', 'text/event-stream');
      reply.raw.setHeader('Cache-Control', 'no-cache');
      reply.raw.setHeader('Connection', 'keep-alive');
      reply.raw.setHeader('Access-Control-Allow-Origin', '*');

      const unsubscribe = alignmentService.subscribeToStream(runId, (event) => {
        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      });

      request.raw.on('close', () => {
        unsubscribe();
      });
    }, { userId: user.userId, roles: user.roles });
  });

  // 9. Cancel Alignment Check Run Immediately (§18.6.3)
  fastify.post('/api/v1/brain/alignment-check/:runId/cancel', {
    preHandler: [authenticate, requirePermission('agent:write')],
  }, async (request, reply) => {
    const user = request.user!;
    return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
      const { runId } = request.params as { runId: string };
      const cancelled = await alignmentService.cancelCheck(runId);
      return reply.send({ success: cancelled, runId });
    }, { userId: user.userId, roles: user.roles });
  });

  // 10. Propose & Approve Brain Assignment (§18.6.2 Step 6)
  fastify.post('/api/v1/brain/assign', {
    preHandler: [authenticate, requirePermission('agent:write')],
  }, async (request, reply) => {
    const user = request.user!;
    return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
      const tenantId = user.tenantId;
      const body = request.body as {
        modelId: string;
        modelVersion: string;
        provider: string;
        keyLastFour: string;
        credentialVaultServiceSlug?: string;
        certifiedTiers: CapabilityTier[];
        certifiedLanguages: string[];
        approvedProposal?: boolean;
      };

      const config = await brainRepo.getTenantBrainConfig(tenantId);
      budgetEngine.validateActivationBudget(config);

      const brainId = `brain_${body.modelId}_${Date.now()}`;
      const proposal = alignmentService.proposeAssignment(brainId, body.modelId, body.certifiedTiers);

      const brainRecord: TenantBrainRecord = {
        id: brainId,
        tenantId,
        provider: body.provider,
        modelId: body.modelId,
        modelVersion: body.modelVersion,
        credentialVaultServiceSlug: body.credentialVaultServiceSlug,
        keyLastFour: body.keyLastFour || '91c4',
        status: 'certified',
        healthStatus: 'healthy',
        certifiedTiers: body.certifiedTiers,
        certifiedLanguages: body.certifiedLanguages,
        assignedAgents: proposal.eligibleAgents,
        currentMonthSpendUsd: 0.0,
        expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
        lastCertifiedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await brainRepo.saveTenantBrain(brainRecord);

      return reply.send({
        success: true,
        brain: brainRecord,
        assignmentProposal: proposal,
      });
    }, { userId: user.userId, roles: user.roles });
  });

  // 11. Zero-Downtime Key Rotation (§9.8)
  fastify.post('/api/v1/brain/rotate-key', {
    preHandler: [authenticate, requirePermission('agent:write')],
  }, async (request, reply) => {
    const user = request.user!;
    return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
      const tenantId = user.tenantId;
      const body = request.body as { brainId: string; newApiKey: string };
      const rotated = await credentialService.rotateKey(tenantId, body.brainId, body.newApiKey);
      return reply.send({ success: true, brain: rotated });
    }, { userId: user.userId, roles: user.roles });
  });

  // 12. Revoke Brain Credential with Graceful Degradation (§9.8)
  fastify.delete('/api/v1/brain/:brainId', {
    preHandler: [authenticate, requirePermission('agent:write')],
  }, async (request, reply) => {
    const user = request.user!;
    return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
      const tenantId = user.tenantId;
      const { brainId } = request.params as { brainId: string };
      const revoked = await credentialService.revokeBrain(tenantId, brainId);
      return reply.send({ success: true, brain: revoked });
    }, { userId: user.userId, roles: user.roles });
  });

  // 13. Trigger Brain Re-Certification (§9.9)
  fastify.post('/api/v1/brain/:brainId/recertify', {
    preHandler: [authenticate, requirePermission('agent:write')],
  }, async (request, reply) => {
    const user = request.user!;
    return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
      const tenantId = user.tenantId;
      const { brainId } = request.params as { brainId: string };
      const body = request.body as { reason?: any };
      const result = await recertScheduler.triggerRecertification(
        tenantId,
        brainId,
        body.reason || 'manual_schedule'
      );
      return reply.send({ success: true, result });
    }, { userId: user.userId, roles: user.roles });
  });
};
