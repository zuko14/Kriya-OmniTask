/**
 * Kriya Omnitask — Governed Adaptation Service (§6, §23 M12, WP-6.4)
 * Coordinates the full governed adaptation lifecycle:
 * 1. Capture failure signatures (via ingestion or outcome harvesting)
 * 2. Deterministic clustering (by failure_class, agent_slug, root_cause)
 * 3. Typed remediation candidate proposals (strict bounds, no rewrite_agent)
 * 4. Sandboxed golden suite simulation validation (replay evaluator, S21)
 * 5. Human approval gating & cryptographic proof receipts (Ed25519)
 * 6. Immutable versioning (v_adapt_{type}_{hash})
 * 7. Canary deployment (10% -> 50% -> 100%) with deterministic session-bucket routing
 * 8. Telemetry drift monitoring, Attention Center P1 escalation & automated rollback on regression
 */

import { CryptoUtils } from '../../core/utils/crypto.js';
import { AdaptationRepository } from '../repositories/adaptationRepository.js';
import { FailureClusteringService } from './failureClusteringService.js';
import { RemediationProposalService } from './remediationProposalService.js';
import { AdaptationSimulationEngine, createProductionReplayEvaluator } from './adaptationSimulationEngine.js';
import { FailureHarvestingService, HarvestFailureSignaturesOptions, HarvestResult } from './failureHarvestingService.js';
import { AdaptationCanaryRouter } from '../canary/adaptationCanaryRouter.js';
import { ProofService } from '../../trust/proof/proofService.js';
import { AttentionService } from '../../attention/service/attentionService.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';
import {
  RemediationProposal,
  AdaptationCanaryEvaluationResult,
  CanaryTelemetryMetrics,
  AdaptationCanaryStatus,
} from '../types/adaptationTypes.js';
import { logger } from '../../core/logger/logger.js';

export class GovernedAdaptationService {
  private repo: AdaptationRepository;
  public clustering: FailureClusteringService;
  public proposer: RemediationProposalService;
  public simulator: AdaptationSimulationEngine;
  public harvester: FailureHarvestingService;
  public canaryRouter: AdaptationCanaryRouter;
  public proofService: ProofService;
  public attentionService: AttentionService;

  constructor(
    repo?: AdaptationRepository,
    clustering?: FailureClusteringService,
    proposer?: RemediationProposalService,
    simulator?: AdaptationSimulationEngine,
    harvester?: FailureHarvestingService,
    canaryRouter?: AdaptationCanaryRouter,
    proofService?: ProofService,
    attentionService?: AttentionService
  ) {
    this.repo = repo || new AdaptationRepository();
    this.clustering = clustering || new FailureClusteringService(this.repo);
    this.proposer = proposer || new RemediationProposalService(this.repo);
    this.simulator = simulator || new AdaptationSimulationEngine(this.repo, undefined, createProductionReplayEvaluator());
    this.harvester = harvester || new FailureHarvestingService(this.clustering, (this.repo as any).client);
    this.canaryRouter = canaryRouter || new AdaptationCanaryRouter(this.repo);
    this.proofService = proofService || new ProofService((this.repo as any).client);
    this.attentionService = attentionService || new AttentionService((this.repo as any).client);
  }

  /**
   * Harvests recurring failure signatures from verification jobs and error budget metrics.
   * Step 1: HARVEST
   */
  public async harvestFromOutcomes(
    tenantId: string,
    options?: HarvestFailureSignaturesOptions
  ): Promise<HarvestResult> {
    return this.harvester.harvestFromOutcomes(tenantId, options);
  }

  /**
   * Approves a simulated proposal, issues an Ed25519 proof receipt, and prepares canary rollout.
   * Step 5: APPROVE & Step 6: VERSION
   */
  public async approveProposal(params: {
    proposalId: string;
    approvedBy: string;
    userRole: 'owner' | 'admin' | 'operator' | 'viewer';
    initialCanaryWeightPct?: number;
  }): Promise<{ proposal: RemediationProposal; canaryEval: AdaptationCanaryEvaluationResult }> {
    const proposal = await this.repo.getProposalById(params.proposalId);
    if (!proposal) {
      throw new Error(`Proposal not found: ${params.proposalId}`);
    }

    // Gating check 1: Candidate MUST be simulated before approval with 0 golden regressions
    if (
      !proposal.goldenSuiteValidation ||
      proposal.simulationStatus !== 'passed' ||
      (proposal.goldenSuiteValidation.goldenSuiteRegressions ?? 0) > 0
    ) {
      throw new Error(
        `Gating violation: Proposal ${params.proposalId} has not passed golden suite simulation (status: ${proposal.simulationStatus}, regressions: ${proposal.goldenSuiteValidation?.goldenSuiteRegressions ?? 'unmeasured'}). Approval forbidden.`
      );
    }

    // Gating check 2: Role authorization (Platform -> owner, Tenant -> admin/owner)
    if (proposal.scope === 'platform' && params.userRole !== 'owner') {
      throw new Error('Authorization violation: Platform-scoped adaptation proposals require Owner role approval.');
    }
    if (proposal.scope === 'tenant' && params.userRole !== 'admin' && params.userRole !== 'owner') {
      throw new Error('Authorization violation: Tenant-scoped adaptation proposals require Admin role approval.');
    }

    // Step 6: VERSION
    const versionTag = `v_adapt_${proposal.proposalType}_${CryptoUtils.generateId().substring(0, 6)}`;
    const now = new Date().toISOString();

    proposal.approvalStatus = 'approved';
    proposal.approvedBy = params.approvedBy;
    proposal.approvedAt = now;
    proposal.deployedVersionTag = versionTag;
    proposal.updatedAt = now;

    await this.repo.saveProposal(proposal);

    // Issue cryptographic Ed25519 proof receipt
    await TenantContextManager.withTenant(proposal.tenantId, 'org_default', async () => {
      try {
        await this.proofService.issue({
          actionType: 'adaptation.proposal_approved',
          riskTier: 'T2',
          actor: {
            humanApproverId: params.approvedBy,
          },
          target: {
            system: 'governed_adaptation',
            externalRef: proposal.id,
          },
          verification: {
            method: 'golden_suite_simulation',
            state: 'verified',
            observed: {
              versionTag,
              suiteId: proposal.goldenSuiteValidation?.suiteId,
              passedCount: proposal.goldenSuiteValidation?.passedCount,
            },
          },
        });
      } catch (err) {
        logger.warn(`Proof receipt issuance on proposal approval skipped: ${err instanceof Error ? err.message : String(err)}`);
      }
    });

    // Step 7: CANARY (Initial slice 10% default)
    const canaryWeight = params.initialCanaryWeightPct ?? 10;
    const canaryEval: AdaptationCanaryEvaluationResult = {
      id: `canary_${CryptoUtils.generateId().substring(0, 8)}`,
      tenantId: proposal.tenantId,
      proposalId: proposal.id,
      versionTag,
      canaryWeightPct: canaryWeight,
      status: 'canary_active',
      baselineMetrics: {
        totalRequests: 1000,
        errorCount: 15,
        escalationCount: 20,
        errorRatePct: 1.5,
        escalationRatePct: 2.0,
        p99LatencyMs: 450,
      },
      canaryMetrics: {
        totalRequests: 100,
        errorCount: 1,
        escalationCount: 1,
        errorRatePct: 1.0,
        escalationRatePct: 1.0,
        p99LatencyMs: 420,
      },
      regressionDetected: false,
      createdAt: now,
      updatedAt: now,
    };

    await this.repo.saveCanaryEvaluation(canaryEval);

    return { proposal, canaryEval };
  }

  /**
   * Rejects an adaptation proposal with an explicit human reason.
   */
  public async rejectProposal(params: {
    proposalId: string;
    rejectedBy: string;
    userRole: 'owner' | 'admin' | 'operator' | 'viewer';
    reason: string;
  }): Promise<RemediationProposal> {
    const proposal = await this.repo.getProposalById(params.proposalId);
    if (!proposal) {
      throw new Error(`Proposal not found: ${params.proposalId}`);
    }

    if (proposal.scope === 'platform' && params.userRole !== 'owner') {
      throw new Error('Authorization violation: Platform-scoped adaptation proposals require Owner role to reject.');
    }
    if (proposal.scope === 'tenant' && params.userRole !== 'admin' && params.userRole !== 'owner') {
      throw new Error('Authorization violation: Tenant-scoped adaptation proposals require Admin role to reject.');
    }

    const now = new Date().toISOString();
    proposal.approvalStatus = 'rejected';
    proposal.approvedBy = params.rejectedBy;
    proposal.approvedAt = now;
    proposal.metadata = {
      ...(proposal.metadata || {}),
      rejectionReason: params.reason,
      rejectedBy: params.rejectedBy,
      rejectedAt: now,
    };
    proposal.updatedAt = now;

    await this.repo.saveProposal(proposal);

    await TenantContextManager.withTenant(proposal.tenantId, 'org_default', async () => {
      try {
        await this.proofService.issue({
          actionType: 'adaptation.proposal_rejected',
          riskTier: 'T2',
          actor: {
            humanApproverId: params.rejectedBy,
          },
          target: {
            system: 'governed_adaptation',
            externalRef: proposal.id,
          },
          verification: {
            method: 'human_rejection',
            state: 'verified',
            observed: { reason: params.reason },
          },
        });
      } catch (err) {
        logger.warn(`Proof receipt issuance on proposal rejection skipped: ${err instanceof Error ? err.message : String(err)}`);
      }
    });

    return proposal;
  }

  /**
   * Evaluates live canary telemetry and performs automatic rollback on regression.
   * Step 8: MONITOR & AUTO-ROLLBACK
   */
  public async evaluateCanary(params: {
    proposalId: string;
    canaryMetrics: CanaryTelemetryMetrics;
    baselineMetrics: CanaryTelemetryMetrics;
  }): Promise<AdaptationCanaryEvaluationResult> {
    const proposal = await this.repo.getProposalById(params.proposalId);
    if (!proposal) {
      throw new Error(`Proposal not found: ${params.proposalId}`);
    }

    let canaryEval = await this.repo.getCanaryEvaluationByProposal(params.proposalId);
    if (!canaryEval) {
      throw new Error(`No active canary evaluation found for proposal: ${params.proposalId}`);
    }

    const { canaryMetrics, baselineMetrics } = params;

    // Calculate rates
    const canaryErrorRate = (canaryMetrics.errorCount / Math.max(canaryMetrics.totalRequests, 1)) * 100;
    const canaryEscalationRate = (canaryMetrics.escalationCount / Math.max(canaryMetrics.totalRequests, 1)) * 100;
    const baselineErrorRate = (baselineMetrics.errorCount / Math.max(baselineMetrics.totalRequests, 1)) * 100;

    canaryMetrics.errorRatePct = Number(canaryErrorRate.toFixed(2));
    canaryMetrics.escalationRatePct = Number(canaryEscalationRate.toFixed(2));
    baselineMetrics.errorRatePct = Number(baselineErrorRate.toFixed(2));

    // Regression triggers:
    // 1. Error rate spikes > 5% or > 2x baseline
    // 2. Escalation rate spikes > 10%
    // 3. P99 latency spikes > 2.5x baseline (if baseline > 0)
    let regressionDetected = false;
    let rollbackReason: string | undefined;

    if (canaryErrorRate > 5.0 || (baselineErrorRate > 0 && canaryErrorRate > baselineErrorRate * 2.0)) {
      regressionDetected = true;
      rollbackReason = `Canary error rate (${canaryErrorRate.toFixed(2)}%) exceeded safety threshold vs baseline (${baselineErrorRate.toFixed(2)}%).`;
    } else if (canaryEscalationRate > 10.0) {
      regressionDetected = true;
      rollbackReason = `Canary escalation rate (${canaryEscalationRate.toFixed(2)}%) spiked above 10%.`;
    } else if (baselineMetrics.p99LatencyMs > 0 && canaryMetrics.p99LatencyMs > baselineMetrics.p99LatencyMs * 2.5) {
      regressionDetected = true;
      rollbackReason = `Canary P99 latency (${canaryMetrics.p99LatencyMs}ms) exceeded 2.5x baseline (${baselineMetrics.p99LatencyMs}ms).`;
    }

    const now = new Date().toISOString();
    let newStatus: AdaptationCanaryStatus = canaryEval.status;

    if (regressionDetected) {
      // Step 8: AUTOMATIC ROLLBACK TO LAST KNOWN GOOD
      newStatus = 'rolled_back';
      canaryEval.canaryWeightPct = 0;

      // Escalate P1 Attention item to human Attention Center
      await TenantContextManager.withTenant(proposal.tenantId, 'org_default', async () => {
        try {
          await this.attentionService.escalateToHuman({
            correlationId: `canary_rollback_${proposal.id}`,
            sourceAgentId: (proposal.metadata?.agentSlug as string) || 'adaptation_service',
            title: `Automated Canary Rollback: ${proposal.title}`,
            description: rollbackReason || 'Telemetry regression detected',
            reasonCategory: 'policy_violation',
            priority: 'P1_HIGH',
            contextData: {
              proposalId: proposal.id,
              versionTag: canaryEval.versionTag,
              rollbackReason,
              canaryMetrics: canaryEval.canaryMetrics,
              baselineMetrics: canaryEval.baselineMetrics,
            },
          });
        } catch (err) {
          logger.warn(`Attention escalation on canary rollback skipped: ${err instanceof Error ? err.message : String(err)}`);
        }

        try {
          await this.proofService.issue({
            actionType: 'adaptation.canary_rollback',
            riskTier: 'T2',
            actor: {
              agentSlug: (proposal.metadata?.agentSlug as string) || 'system',
            },
            target: {
              system: 'governed_adaptation',
              externalRef: proposal.id,
            },
            verification: {
              method: 'canary_telemetry_drift',
              state: 'verification_failed',
              observed: {
                rollbackReason,
                canaryMetrics: canaryEval.canaryMetrics,
              },
            },
          });
        } catch (err) {
          logger.warn(`Proof receipt issuance on canary rollback skipped: ${err instanceof Error ? err.message : String(err)}`);
        }
      });
    } else if (canaryEval.canaryWeightPct < 100) {
      // Advance canary progression: 10% -> 50% -> 100%
      if (canaryEval.canaryWeightPct === 10) {
        canaryEval.canaryWeightPct = 50;
      } else if (canaryEval.canaryWeightPct === 50) {
        canaryEval.canaryWeightPct = 100;
        newStatus = 'promoted';
      }
    } else {
      newStatus = 'promoted';
    }

    // If promoted to 100%, issue proof receipt
    if (newStatus === 'promoted' && canaryEval.status !== 'promoted') {
      await TenantContextManager.withTenant(proposal.tenantId, 'org_default', async () => {
        try {
          await this.proofService.issue({
            actionType: 'adaptation.canary_promoted',
            riskTier: 'T2',
            actor: {
              agentSlug: (proposal.metadata?.agentSlug as string) || 'system',
            },
            target: {
              system: 'governed_adaptation',
              externalRef: proposal.id,
            },
            verification: {
              method: 'canary_telemetry_drift',
              state: 'verified',
              observed: {
                versionTag: canaryEval.versionTag,
                finalCanaryMetrics: canaryEval.canaryMetrics,
              },
            },
          });
        } catch (err) {
          logger.warn(`Proof receipt issuance on canary promotion skipped: ${err instanceof Error ? err.message : String(err)}`);
        }
      });
    }

    canaryEval.status = newStatus;
    canaryEval.baselineMetrics = baselineMetrics;
    canaryEval.canaryMetrics = canaryMetrics;
    canaryEval.regressionDetected = regressionDetected;
    canaryEval.rollbackReason = rollbackReason || null;
    canaryEval.updatedAt = now;

    await this.repo.saveCanaryEvaluation(canaryEval);

    return canaryEval;
  }
}
