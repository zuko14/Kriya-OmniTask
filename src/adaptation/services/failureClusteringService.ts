/**
 * Kriya Omnitask — Failure Signature Clustering Service (§6, §23 M12)
 * Ingests failure signatures from failures, escalations, and deterministic analytics.
 * Clusters recurring signatures by (failure_class, agent_slug, root_cause) and identifies candidates.
 */

import { CryptoUtils } from '../../core/utils/crypto.js';
import { AdaptationRepository } from '../repositories/adaptationRepository.js';
import {
  FailureSignature,
  FailureCluster,
  FailureClass,
} from '../types/adaptationTypes.js';

export class FailureClusteringService {
  private repo: AdaptationRepository;
  private readonly candidateThreshold: number;

  constructor(repo?: AdaptationRepository, candidateThreshold: number = 3) {
    this.repo = repo || new AdaptationRepository();
    this.candidateThreshold = candidateThreshold;
  }

  /**
   * Ingests a new failure signature into the corpus.
   * Step 1: CAPTURE
   */
  public async ingestFailureSignature(params: {
    tenantId: string;
    failureClass: FailureClass;
    businessType: string;
    agentId: string;
    agentSlug: string;
    stage: string;
    rootCause: string;
    frequency?: number;
    costUsd?: number;
    customerImpact?: 'low' | 'medium' | 'high' | 'critical';
    modelTier?: 'T1' | 'T2' | 'T3' | 'T4';
    metadata?: Record<string, unknown>;
  }): Promise<FailureSignature> {
    const signatureId = `sig_${params.failureClass}_${params.agentSlug}_${this.hashString(params.rootCause)}`;
    const now = new Date().toISOString();

    const signature: FailureSignature = {
      id: signatureId,
      tenantId: params.tenantId,
      failureClass: params.failureClass,
      businessType: params.businessType,
      agentId: params.agentId,
      agentSlug: params.agentSlug,
      stage: params.stage,
      rootCause: params.rootCause,
      frequency: params.frequency ?? 1,
      costUsd: params.costUsd ?? 0.0,
      customerImpact: params.customerImpact ?? 'low',
      modelTier: params.modelTier ?? 'T2',
      metadata: params.metadata || {},
      createdAt: now,
      updatedAt: now,
    };

    await this.repo.saveFailureSignature(signature);
    return signature;
  }

  /**
   * Clusters recurring failure signatures deterministically.
   * Step 2: CLUSTER
   */
  public async getClusters(tenantId?: string): Promise<FailureCluster[]> {
    const signatures = tenantId
      ? await this.repo.getFailureSignatures(tenantId)
      : await this.repo.getAllFailureSignatures();

    const clusterMap = new Map<string, {
      clusterId: string;
      failureClass: FailureClass;
      agentSlug: string;
      rootCause: string;
      signatureIds: string[];
      totalOccurrences: number;
      totalCostUsd: number;
      tiers: Array<'T1' | 'T2' | 'T3' | 'T4'>;
    }>();

    for (const sig of signatures) {
      const clusterKey = `${sig.failureClass}::${sig.agentSlug}::${sig.rootCause}`;
      const existing = clusterMap.get(clusterKey);

      if (!existing) {
        clusterMap.set(clusterKey, {
          clusterId: `cluster_${this.hashString(clusterKey)}`,
          failureClass: sig.failureClass,
          agentSlug: sig.agentSlug,
          rootCause: sig.rootCause,
          signatureIds: [sig.id],
          totalOccurrences: sig.frequency,
          totalCostUsd: sig.costUsd,
          tiers: [sig.modelTier],
        });
      } else {
        existing.signatureIds.push(sig.id);
        existing.totalOccurrences += sig.frequency;
        existing.totalCostUsd += sig.costUsd;
        existing.tiers.push(sig.modelTier);
      }
    }

    const clusters: FailureCluster[] = [];
    for (const item of clusterMap.values()) {
      // Pick dominant model tier
      const dominantModelTier = item.tiers[0] || 'T2';
      const candidateReady = item.totalOccurrences >= this.candidateThreshold;

      clusters.push({
        clusterId: item.clusterId,
        failureClass: item.failureClass,
        agentSlug: item.agentSlug,
        rootCause: item.rootCause,
        signatureIds: item.signatureIds,
        totalOccurrences: item.totalOccurrences,
        totalCostUsd: Number(item.totalCostUsd.toFixed(4)),
        dominantModelTier,
        candidateReady,
      });
    }

    // Sort by candidate readiness first, then total occurrences descending
    return clusters.sort((a, b) => {
      if (a.candidateReady !== b.candidateReady) {
        return a.candidateReady ? -1 : 1;
      }
      return b.totalOccurrences - a.totalOccurrences;
    });
  }

  private hashString(str: string): string {
    return CryptoUtils.hashSha256(str).substring(0, 12);
  }
}
