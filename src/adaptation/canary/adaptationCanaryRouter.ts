/**
 * Kriya Omnitask — Adaptation Canary Router (§6, §23 M12, WP-6.4)
 * Controls deterministic canary routing and telemetry isolation for adapted agent versions.
 * Ensures consistent routing per (tenantId, sessionId, agentSlug) session bucket.
 */

import { CryptoUtils } from '../../core/utils/crypto.js';
import { AdaptationRepository } from '../repositories/adaptationRepository.js';

export interface CanaryRouteDecision {
  routeToCanary: boolean;
  versionTag?: string;
  canaryWeightPct: number;
  proposalId?: string;
}

export class AdaptationCanaryRouter {
  private repo: AdaptationRepository;

  constructor(repo?: AdaptationRepository) {
    this.repo = repo || new AdaptationRepository();
  }

  /**
   * Deterministically decides whether an incoming request/session should route to
   * the active canary adaptation version or the baseline production version.
   */
  public async shouldRouteToCanary(
    tenantId: string,
    sessionId: string,
    agentSlug: string
  ): Promise<CanaryRouteDecision> {
    const proposals = await this.repo.listProposals(tenantId);
    const activeProposal = proposals.find(
      (p) =>
        p.approvalStatus === 'approved' &&
        p.deployedVersionTag &&
        (p.metadata?.agentSlug === agentSlug || p.title.toLowerCase().includes(agentSlug.toLowerCase()))
    );

    if (!activeProposal) {
      return { routeToCanary: false, canaryWeightPct: 0 };
    }

    const canary = await this.repo.getCanaryEvaluationByProposal(activeProposal.id);
    if (!canary) {
      return { routeToCanary: false, canaryWeightPct: 0 };
    }

    // Promoted: 100% production traffic
    if (canary.status === 'promoted' && canary.canaryWeightPct === 100) {
      return {
        routeToCanary: true,
        versionTag: canary.versionTag,
        canaryWeightPct: 100,
        proposalId: activeProposal.id,
      };
    }

    // Rolled back or 0% weight: 0% traffic
    if (canary.status === 'rolled_back' || canary.canaryWeightPct <= 0) {
      return {
        routeToCanary: false,
        canaryWeightPct: 0,
        proposalId: activeProposal.id,
      };
    }

    // Canary active: deterministic hashing of tenantId + sessionId + agentSlug
    const hashHex = CryptoUtils.hashSha256(`${tenantId}:${sessionId}:${agentSlug}`);
    const bucket = parseInt(hashHex.substring(0, 4), 16) % 100;

    const routeToCanary = bucket < canary.canaryWeightPct;
    return {
      routeToCanary,
      versionTag: routeToCanary ? canary.versionTag : undefined,
      canaryWeightPct: canary.canaryWeightPct,
      proposalId: activeProposal.id,
    };
  }
}
