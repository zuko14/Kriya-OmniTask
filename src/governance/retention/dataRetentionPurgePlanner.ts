/**
 * Xylarc AI — Data Retention Purge Planner
 * Plans and evaluates automated compliance purging across classified resources.
 */

import {
  DataRetentionPolicy,
  GovernancePurgeAudit,
} from '../types/governanceTypes.js';
import { CryptoUtils } from '../../core/utils/crypto.js';

export interface PurgePlanItem {
  policyId: string;
  targetResourceType: string;
  dataClassification: string;
  retentionDays: number;
  cutoffTimestamp: string;
  purgeAction: string;
}

export class DataRetentionPurgePlanner {
  /**
   * Derives cutoff timestamp for a retention policy.
   */
  public static calculateCutoff(retentionDays: number, referenceDate = new Date()): string {
    const cutoffMs = referenceDate.getTime() - retentionDays * 24 * 60 * 60 * 1000;
    return new Date(cutoffMs).toISOString();
  }

  /**
   * Generates a purge execution plan across active retention policies.
   */
  public static formulatePurgePlan(policies: DataRetentionPolicy[]): PurgePlanItem[] {
    const activePolicies = policies.filter((p) => p.isActive);
    const now = new Date();

    return activePolicies.map((policy) => ({
      policyId: policy.id,
      targetResourceType: policy.targetResourceType,
      dataClassification: policy.dataClassification,
      retentionDays: policy.retentionDays,
      cutoffTimestamp: this.calculateCutoff(policy.retentionDays, now),
      purgeAction: policy.purgeAction,
    }));
  }

  /**
   * Creates an audit entry for a simulated or completed retention purge run.
   */
  public static createPurgeAudit(
    tenantId: string,
    policy: DataRetentionPolicy,
    recordsEvaluated: number,
    recordsPurged: number,
    status: 'completed' | 'failed' = 'completed'
  ): GovernancePurgeAudit {
    return {
      id: `pga_${CryptoUtils.generateId()}`,
      tenantId,
      policyId: policy.id,
      targetResourceType: policy.targetResourceType,
      recordsEvaluated,
      recordsPurged,
      status,
      executedAt: new Date().toISOString(),
    };
  }
}
