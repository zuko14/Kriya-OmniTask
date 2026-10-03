/**
 * Kriya Omnitask — Remediation Proposal Service (§6, §23 M12)
 * Generates typed remediation proposals from recurring failure clusters.
 * Enforces hard constraints:
 * - "Rewrite the agent" is NOT a valid proposal type.
 * - "Convert model judgment to a Skill" is a first-class proposal type (§9.3).
 * - Auto-adaptable bounds strictly limited to retry timing, fallback ordering, and certified-model routing.
 */

import { CryptoUtils } from '../../core/utils/crypto.js';
import { AdaptationRepository } from '../repositories/adaptationRepository.js';
import {
  RemediationProposal,
  RemediationProposalType,
  FailureCluster,
  ProposalScope,
} from '../types/adaptationTypes.js';

export class RemediationProposalService {
  private repo: AdaptationRepository;

  constructor(repo?: AdaptationRepository) {
    this.repo = repo || new AdaptationRepository();
  }

  /**
   * Generates a typed remediation proposal candidate from a failure cluster.
   * Step 3: PROPOSE
   */
  public async generateProposal(params: {
    tenantId: string;
    scope: ProposalScope;
    cluster: FailureCluster;
    proposalType: RemediationProposalType;
    title: string;
    description: string;
    proposedChanges: Record<string, unknown>;
  }): Promise<RemediationProposal> {
    // Hard constraint 1: Disallow untyped 'rewrite_agent'
    if ((params.proposalType as string) === 'rewrite_agent' || (params.proposalType as string) === 'rewrite_prompt') {
      throw new Error('Prohibition: "Rewrite the agent" or prompt overhauls are not allowed proposal types (§6).');
    }

    // Determine if human approval is mandatory
    const isAutoAdaptable = this.isWithinAutoAdaptableBounds(params.proposalType, params.proposedChanges);
    const requiresHumanApproval = !isAutoAdaptable;

    const now = new Date().toISOString();
    const proposal: RemediationProposal = {
      id: `prop_${CryptoUtils.generateId().substring(0, 8)}`,
      tenantId: params.tenantId,
      scope: params.scope,
      proposalType: params.proposalType,
      title: params.title,
      description: params.description,
      targetFailureClass: params.cluster.failureClass,
      clusterSignatureId: params.cluster.clusterId,
      requiresHumanApproval,
      proposedChanges: params.proposedChanges,
      simulationStatus: 'pending',
      approvalStatus: 'pending',
      metadata: {
        agentSlug: params.cluster.agentSlug,
        totalOccurrences: params.cluster.totalOccurrences,
        dominantModelTier: params.cluster.dominantModelTier,
        isAutoAdaptable,
      },
      createdAt: now,
      updatedAt: now,
    };

    await this.repo.saveProposal(proposal);
    return proposal;
  }

  /**
   * Generates a "Convert model judgment to a Skill" proposal (§6, §9.3).
   * Replaces expensive non-deterministic model calls with a deterministic, zero-token Skill.
   */
  public async proposeConvertJudgmentToSkill(params: {
    tenantId: string;
    scope: ProposalScope;
    cluster: FailureCluster;
    skillSlug: string;
    skillName: string;
    inputSchema: Record<string, unknown>;
    outputSchema: Record<string, unknown>;
    validationCodeSnippet?: string;
  }): Promise<RemediationProposal> {
    return this.generateProposal({
      tenantId: params.tenantId,
      scope: params.scope,
      cluster: params.cluster,
      proposalType: 'new_skill',
      title: `Convert model judgment to Skill: ${params.skillName} (${params.skillSlug})`,
      description: `Replaces recurring ${params.cluster.failureClass} in ${params.cluster.agentSlug} with deterministic zero-token Skill '${params.skillSlug}'.`,
      proposedChanges: {
        skillSlug: params.skillSlug,
        skillName: params.skillName,
        inputSchema: params.inputSchema,
        outputSchema: params.outputSchema,
        validationCodeSnippet: params.validationCodeSnippet,
        deterministicZeroToken: true,
      },
    });
  }

  /**
   * Auto-adaptable bounds check (§6, §23 M12):
   * Strictly limited to:
   * 1. retry_timing (delays/backoff)
   * 2. fallback_ordering (among already-approved tools/models)
   * 3. certified_model_routing (routing among already-certified models)
   */
  public isWithinAutoAdaptableBounds(
    proposalType: RemediationProposalType,
    changes: Record<string, unknown>
  ): boolean {
    if (proposalType === 'retry_timing') {
      const maxRetry = changes.maxRetries as number | undefined;
      const backoffMs = changes.backoffMultiplierMs as number | undefined;
      return (maxRetry === undefined || maxRetry <= 3) && (backoffMs === undefined || backoffMs <= 5000);
    }

    if (proposalType === 'routing_rule') {
      const isFallbackReorder = changes.action === 'reorder_fallback' && Boolean(changes.useOnlyApprovedModels);
      const isCertifiedRouting = changes.action === 'certified_model_routing' && Boolean(changes.targetModelCertified);
      return isFallbackReorder || isCertifiedRouting;
    }

    // All other proposal types (new_skill, knowledge_gap, policy_tightening, extraction_correction) ALWAYS require human approval!
    return false;
  }
}
