/**
 * Kriya AI — Human Attention Priority & SLA Calculator
 * Deterministic rules computing escalation priority scores and SLA countdowns (§14, §16 of CLAUDE.md).
 */

import {
  AttentionPriority,
  AttentionReasonCategory,
} from '../types/attentionTypes.js';

export class PriorityCalculator {
  /**
   * Derives priority tier from reason category and financial impact.
   */
  public static calculatePriority(params: {
    reasonCategory: AttentionReasonCategory;
    financialValueUsd?: number;
    explicitPriority?: AttentionPriority;
  }): AttentionPriority {
    if (params.explicitPriority) return params.explicitPriority;

    const { reasonCategory, financialValueUsd } = params;

    if (reasonCategory === 'security_anomaly') {
      return 'P0_CRITICAL';
    }

    if (financialValueUsd !== undefined && financialValueUsd >= 10000) {
      return 'P0_CRITICAL';
    }

    if (
      reasonCategory === 'policy_violation' ||
      reasonCategory === 'sensitive_complaint' ||
      reasonCategory === 'agent_disagreement' ||
      reasonCategory === 'slo_burn' ||
      (financialValueUsd !== undefined && financialValueUsd >= 1000)
    ) {
      return 'P1_HIGH';
    }

    if (
      reasonCategory === 'low_confidence' ||
      reasonCategory === 'workflow_suspended'
    ) {
      return 'P2_MEDIUM';
    }

    return 'P3_LOW';
  }

  /**
   * Computes ISO timestamp for SLA expiration based on priority tier.
   */
  public static calculateSlaExpiry(priority: AttentionPriority): string {
    const now = new Date();
    let durationMinutes: number;

    switch (priority) {
      case 'P0_CRITICAL':
        durationMinutes = 15; // 15 minutes
        break;
      case 'P1_HIGH':
        durationMinutes = 60; // 1 hour
        break;
      case 'P2_MEDIUM':
        durationMinutes = 240; // 4 hours
        break;
      case 'P3_LOW':
        durationMinutes = 1440; // 24 hours
        break;
    }

    return new Date(now.getTime() + durationMinutes * 60 * 1000).toISOString();
  }
}
