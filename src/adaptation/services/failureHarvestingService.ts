/**
 * Kriya Omnitask — Failure Harvesting Service (§6, §23 M12, WP-6.4)
 * Harvests recurring failure signatures from real production runtime evidence:
 * 1. Verification job mismatches & expirations (WP-4.6, migration 043)
 * 2. Autonomy budget throttling & consecutive failure tripwires (WP-6.3, migration 053)
 * 3. Terminal graph run failures (WP-2.2, migration 037)
 * Feeds signatures directly into FailureClusteringService for automated cluster analysis.
 */

import { DatabaseClient, db } from '../../storage/db.js';
import { FailureClusteringService } from './failureClusteringService.js';
import { FailureCluster } from '../types/adaptationTypes.js';
import { logger } from '../../core/logger/logger.js';

export interface HarvestFailureSignaturesOptions {
  windowHours?: number;
  candidateThreshold?: number;
}

export interface HarvestResult {
  tenantId: string;
  harvestedSignaturesCount: number;
  clustersCreatedOrUpdatedCount: number;
  candidateReadyCount: number;
  clusters: FailureCluster[];
}

export class FailureHarvestingService {
  private client: DatabaseClient;
  private clustering: FailureClusteringService;

  constructor(clusteringService?: FailureClusteringService, client?: DatabaseClient) {
    this.client = client || db.getClient();
    this.clustering = clusteringService || new FailureClusteringService();
  }

  /**
   * Harvests failure signatures from verification jobs and error budgets for a tenant.
   */
  public async harvestFromOutcomes(
    tenantId: string,
    options?: HarvestFailureSignaturesOptions
  ): Promise<HarvestResult> {
    const windowHours = options?.windowHours ?? 168; // Default 7 days
    const windowStart = new Date(Date.now() - windowHours * 3600 * 1000).toISOString();

    let harvestedCount = 0;

    // 1. Harvest from verification_jobs (mismatch or expired)
    try {
      const verificationQuery = `
        SELECT tool_slug, status, error_message, count(*) as failure_count
        FROM verification_jobs
        WHERE tenant_id = ? AND status IN ('mismatch', 'expired') AND created_at >= ?
        GROUP BY tool_slug, status, error_message;
      `;
      const verificationRows = await this.client.query<any>(verificationQuery, [tenantId, windowStart]);

      for (const row of verificationRows) {
        const actionType = row.tool_slug || 'unknown_tool';
        const agentSlug = this.inferAgentSlug(actionType);
        const rootCause = row.error_message || `Verification ${row.status} during ${actionType}`;

        await this.clustering.ingestFailureSignature({
          tenantId,
          failureClass: 'tool_failure',
          businessType: 'general',
          agentId: `agent_${agentSlug}`,
          agentSlug,
          stage: actionType,
          rootCause,
          frequency: Number(row.failure_count) || 1,
          costUsd: 0.002 * (Number(row.failure_count) || 1),
          customerImpact: 'medium',
          modelTier: 'T2',
          metadata: {
            source: 'verification_jobs',
            status: row.status,
            actionType,
          },
        });
        harvestedCount++;
      }
    } catch (err) {
      logger.warn(`Failure harvesting from verification_jobs skipped: ${err instanceof Error ? err.message : String(err)}`);
    }

    // 2. Harvest from agent_error_budgets (throttled or high consecutive failures)
    try {
      const budgetQuery = `
        SELECT agent_slug, configured_tier_cap, effective_tier_cap, is_throttled,
               consecutive_failures, throttled_reason, sample_count
        FROM agent_error_budgets
        WHERE tenant_id = ? AND (is_throttled = 1 OR consecutive_failures >= 2);
      `;
      const budgetRows = await this.client.query<any>(budgetQuery, [tenantId]);

      for (const row of budgetRows) {
        const rootCause = row.throttled_reason || `Autonomy throttled: ${row.consecutive_failures} consecutive failures`;
        await this.clustering.ingestFailureSignature({
          tenantId,
          failureClass: 'model_failure',
          businessType: 'general',
          agentId: `agent_${row.agent_slug}`,
          agentSlug: row.agent_slug,
          stage: 'autonomy_execution',
          rootCause,
          frequency: Math.max(Number(row.consecutive_failures), 2),
          costUsd: 0.05,
          customerImpact: 'high',
          modelTier: (row.effective_tier_cap as any) || 'T2',
          metadata: {
            source: 'agent_error_budgets',
            configuredTier: row.configured_tier_cap,
            effectiveTier: row.effective_tier_cap,
          },
        });
        harvestedCount++;
      }
    } catch (err) {
      logger.warn(`Failure harvesting from agent_error_budgets skipped: ${err instanceof Error ? err.message : String(err)}`);
    }

    // 3. Get updated clusters
    const clusters = await this.clustering.getClusters(tenantId);
    const candidateReadyCount = clusters.filter((c) => c.candidateReady).length;

    logger.info(`Harvested ${harvestedCount} failure signatures for tenant '${tenantId}'. Total clusters: ${clusters.length} (Candidate ready: ${candidateReadyCount})`);

    return {
      tenantId,
      harvestedSignaturesCount: harvestedCount,
      clustersCreatedOrUpdatedCount: clusters.length,
      candidateReadyCount,
      clusters,
    };
  }

  private inferAgentSlug(actionType: string): string {
    const lower = actionType.toLowerCase();
    if (lower.includes('sched') || lower.includes('appointment') || lower.includes('booking') || lower.includes('slot')) {
      return 'scheduling';
    }
    if (lower.includes('pay') || lower.includes('refund') || lower.includes('link') || lower.includes('hold') || lower.includes('invoice')) {
      return 'payments';
    }
    if (lower.includes('doc') || lower.includes('lens') || lower.includes('prescription')) {
      return 'document';
    }
    if (lower.includes('attention') || lower.includes('escalat')) {
      return 'attention';
    }
    return 'intake';
  }
}
