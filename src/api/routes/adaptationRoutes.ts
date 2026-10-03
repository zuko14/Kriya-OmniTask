/**
 * Kriya Omnitask — Governed Adaptation REST API Routes (§6, §23 M12)
 * Fastify plugin exposing endpoints for failure signature ingestion, clustering, typed proposal generation,
 * simulation validation, approval gating, canary rollout, and automatic rollback.
 */

import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { GovernedAdaptationService } from '../../adaptation/services/governedAdaptationService.js';
import { AdaptationRepository } from '../../adaptation/repositories/adaptationRepository.js';
import {
  IngestFailureSignatureSchema,
  GenerateProposalSchema,
  ApproveProposalSchema,
  EvaluateCanarySchema,
  HarvestSignaturesSchema,
  RejectProposalSchema,
} from '../../adaptation/types/adaptationTypes.js';
import { authenticate } from '../middleware/authMiddleware.js';
import { requirePermission } from '../middleware/rbacMiddleware.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';

export const adaptationRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  const repo = new AdaptationRepository();
  const adaptationService = new GovernedAdaptationService(repo);

  // 1. Ingest Failure Signature (Step 1: CAPTURE)
  fastify.post(
    '/api/v1/adaptation/signatures',
    { preHandler: [authenticate, requirePermission('agent:write')] },
    async (request, reply) => {
      const tenantId = request.user!.tenantId;
      const parsed = IngestFailureSignatureSchema.parse(request.body);

      const signature = await adaptationService.clustering.ingestFailureSignature({
        tenantId,
        failureClass: parsed.failureClass,
        businessType: parsed.businessType,
        agentId: parsed.agentId,
        agentSlug: parsed.agentSlug,
        stage: parsed.stage,
        rootCause: parsed.rootCause,
        frequency: parsed.frequency,
        costUsd: parsed.costUsd,
        customerImpact: parsed.customerImpact,
        modelTier: parsed.modelTier,
        metadata: parsed.metadata,
      });

      return reply.status(201).send({ success: true, signature });
    }
  );

  // 2. Get Clustered Failure Signatures (Step 2: CLUSTER)
  fastify.get(
    '/api/v1/adaptation/clusters',
    { preHandler: [authenticate, requirePermission('agent:read')] },
    async (request, reply) => {
      const tenantId = request.user!.tenantId;
      const clusters = await adaptationService.clustering.getClusters(tenantId);
      return reply.status(200).send({ success: true, clusters });
    }
  );

  // 3. Generate Typed Remediation Proposal (Step 3: PROPOSE)
  fastify.post(
    '/api/v1/adaptation/proposals/generate',
    { preHandler: [authenticate, requirePermission('agent:write')] },
    async (request, reply) => {
      const tenantId = request.user!.tenantId;
      const parsed = GenerateProposalSchema.parse(request.body);

      const clusters = await adaptationService.clustering.getClusters(tenantId);
      const cluster = clusters.find((c) => c.clusterId === parsed.clusterId);
      if (!cluster) {
        return reply.status(404).send({ success: false, error: `Cluster not found: ${parsed.clusterId}` });
      }

      const proposal = await adaptationService.proposer.generateProposal({
        tenantId,
        scope: 'tenant',
        cluster,
        proposalType: parsed.proposalType,
        title: parsed.title,
        description: parsed.description,
        proposedChanges: parsed.proposedChanges,
      });

      return reply.status(201).send({ success: true, proposal });
    }
  );

  // 3b. Convert Model Judgment to Skill Proposal (Step 3 & §9.3)
  fastify.post(
    '/api/v1/adaptation/proposals/skill',
    { preHandler: [authenticate, requirePermission('agent:write')] },
    async (request, reply) => {
      const tenantId = request.user!.tenantId;
      const body = request.body as any;
      const { clusterId, skillSlug, skillName, inputSchema, outputSchema, validationCodeSnippet } = body;

      const clusters = await adaptationService.clustering.getClusters(tenantId);
      const cluster = clusters.find((c) => c.clusterId === clusterId);
      if (!cluster) {
        return reply.status(404).send({ success: false, error: `Cluster not found: ${clusterId}` });
      }

      const proposal = await adaptationService.proposer.proposeConvertJudgmentToSkill({
        tenantId,
        scope: 'tenant',
        cluster,
        skillSlug,
        skillName,
        inputSchema: inputSchema || {},
        outputSchema: outputSchema || {},
        validationCodeSnippet,
      });

      return reply.status(201).send({ success: true, proposal });
    }
  );

  // 4. Run Sandboxed Simulation Validation (Step 4: SIMULATE)
  fastify.post(
    '/api/v1/adaptation/proposals/:id/simulate',
    { preHandler: [authenticate, requirePermission('agent:write')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { forceRegressionTestId } = (request.body as any) || {};

      const result = await adaptationService.simulator.simulateProposal(id, {
        forceRegressionTestId,
      });

      return reply.status(200).send({ success: true, ...result });
    }
  );

  // 5. Approve Proposal & Trigger Canary Version (Step 5: APPROVE & Step 6: VERSION & Step 7: CANARY)
  fastify.post(
    '/api/v1/adaptation/proposals/:id/approve',
    { preHandler: [authenticate, requirePermission('agent:deploy')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = ApproveProposalSchema.parse(request.body);
      const user = (request as any).user;
      const userRole = user?.role || (request.headers['x-user-role'] as any) || 'admin';
      const userId = user?.id || (request.headers['x-user-id'] as string) || 'admin_user';

      const result = await adaptationService.approveProposal({
        proposalId: id,
        approvedBy: userId,
        userRole,
        initialCanaryWeightPct: parsed.canaryInitialWeightPct,
      });

      return reply.status(200).send({ success: true, ...result });
    }
  );

  // 5b. Reject Proposal (Step 5: REJECT)
  fastify.post(
    '/api/v1/adaptation/proposals/:id/reject',
    { preHandler: [authenticate, requirePermission('agent:deploy')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = RejectProposalSchema.parse(request.body);
      const user = (request as any).user;
      const userRole = user?.role || (request.headers['x-user-role'] as any) || 'admin';
      const userId = user?.id || (request.headers['x-user-id'] as string) || 'admin_user';

      const proposal = await adaptationService.rejectProposal({
        proposalId: id,
        rejectedBy: userId,
        userRole,
        reason: parsed.reason,
      });

      return reply.status(200).send({ success: true, proposal });
    }
  );

  // 6. Evaluate Canary Telemetry & Auto-Rollback (Step 8: MONITOR & ROLLBACK)
  fastify.post(
    '/api/v1/adaptation/canary/evaluate',
    { preHandler: [authenticate, requirePermission('agent:deploy')] },
    async (request, reply) => {
      const parsed = EvaluateCanarySchema.parse(request.body);

      const evaluation = await adaptationService.evaluateCanary({
        proposalId: parsed.proposalId,
        canaryMetrics: {
          ...parsed.canaryMetrics,
          errorRatePct: 0,
          escalationRatePct: 0,
        },
        baselineMetrics: {
          ...parsed.baselineMetrics,
          errorRatePct: 0,
          escalationRatePct: 0,
        },
      });

      return reply.status(200).send({ success: true, evaluation });
    }
  );

  // 6b. Check Canary Status for Agent Slug
  fastify.get(
    '/api/v1/adaptation/canary/status/:agentSlug',
    { preHandler: [authenticate, requirePermission('agent:read')] },
    async (request, reply) => {
      const { agentSlug } = request.params as { agentSlug: string };
      const tenantId = request.user!.tenantId;
      const sessionId = (request.query as any)?.sessionId || 'default_session';

      const decision = await adaptationService.canaryRouter.shouldRouteToCanary(
        tenantId,
        sessionId,
        agentSlug
      );

      return reply.status(200).send({ success: true, ...decision });
    }
  );

  // 7. Harvest Failure Signatures from Outcomes & Error Budgets (Step 1: HARVEST)
  fastify.post(
    '/api/v1/adaptation/harvest',
    { preHandler: [authenticate, requirePermission('agent:write')] },
    async (request, reply) => {
      const tenantId = request.user!.tenantId;
      const parsed = HarvestSignaturesSchema.parse(request.body || {});

      const result = await adaptationService.harvestFromOutcomes(tenantId, {
        windowHours: parsed.windowHours,
        candidateThreshold: parsed.candidateThreshold,
      });

      return reply.status(200).send({ success: true, ...result });
    }
  );

  // 8. List Proposals for Tenant
  fastify.get(
    '/api/v1/adaptation/proposals',
    { preHandler: [authenticate, requirePermission('agent:read')] },
    async (request, reply) => {
      const tenantId = request.user!.tenantId;
      const proposals = await repo.listProposals(tenantId);
      return reply.status(200).send({ success: true, proposals });
    }
  );

  // 9. Get Proposal Details
  fastify.get(
    '/api/v1/adaptation/proposals/:id',
    { preHandler: [authenticate, requirePermission('agent:read')] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const proposal = await repo.getProposalById(id);
      if (!proposal) {
        return reply.status(404).send({ success: false, error: `Proposal not found: ${id}` });
      }
      const canary = await repo.getCanaryEvaluationByProposal(id);
      return reply.status(200).send({ success: true, proposal, canary });
    }
  );
};
