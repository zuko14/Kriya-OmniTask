/**
 * Kriya AI — Dynamic Feature Flag Engine
 * Deterministic multi-tenant and role-targeted feature gating with consistent hash percentage rollouts.
 */

import { FeatureFlag, FeatureFlagContext } from '../types/deploymentTypes.js';

export class FeatureFlagEngine {
  /**
   * Evaluates if a feature flag is enabled for a given caller context.
   */
  public static isEnabled(flag: FeatureFlag, context: FeatureFlagContext = {}): boolean {
    // 1. Global Kill-Switch Check
    if (!flag.isEnabled) {
      return false;
    }

    // 2. Specific Tenant Targeting
    if (context.tenantId && flag.allowedTenants.length > 0) {
      if (flag.allowedTenants.includes(context.tenantId)) {
        return true;
      }
    }

    // 3. Role-Based Targeting
    if (context.roles && context.roles.length > 0 && flag.allowedRoles.length > 0) {
      const hasMatchingRole = context.roles.some((r) => flag.allowedRoles.includes(r));
      if (hasMatchingRole) {
        return true;
      }
    }

    // 4. Percentage Rollout Evaluation
    if (flag.rolloutPct >= 100) {
      return true;
    }

    if (flag.rolloutPct <= 0) {
      // If no explicit tenant or role matched and rollout is 0%, disabled
      return false;
    }

    // Deterministic hash partitioning based on userId or tenantId
    const entityKey = context.userId || context.tenantId;
    if (!entityKey) {
      return false;
    }

    const bucket = this.computeHashBucket(`${flag.flagKey}:${entityKey}`);
    return bucket < flag.rolloutPct;
  }

  /**
   * Computes a deterministic integer in [0, 99] using standard Fowler-Noll-Vo (FNV-1a) hash.
   */
  public static computeHashBucket(key: string): number {
    let hash = 0x811c9dc5;
    for (let i = 0; i < key.length; i++) {
      hash ^= key.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return Math.abs(hash) % 100;
  }
}
