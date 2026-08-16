/**
 * Xylarc AI — Overage Evaluator Engine
 * Computes delta overages against included plan allowances and applies contractual overage rates.
 */

import { BillingPlan, UsageSummary, OverageEvaluationResult, OverageItem } from '../types/billingTypes.js';

export class OverageEvaluator {
  /**
   * Calculates overages by comparing metered usage against the active billing plan allowances.
   */
  public static calculateOverages(usage: UsageSummary, plan: BillingPlan): OverageEvaluationResult {
    const items: OverageItem[] = [];
    let totalOverageAmountCents = 0;

    // 1. Token Overage
    if (usage.totalTokens > plan.includedTokens) {
      const overageQty = usage.totalTokens - plan.includedTokens;
      const amountCents = Math.round((overageQty / 1000) * plan.tokenOverageRateCentsPerK);
      if (amountCents > 0) {
        items.push({
          metricType: 'tokens',
          usedQuantity: usage.totalTokens,
          includedQuantity: plan.includedTokens,
          overageQuantity: overageQty,
          rateCentsPerUnit: plan.tokenOverageRateCentsPerK,
          overageAmountCents: amountCents,
        });
        totalOverageAmountCents += amountCents;
      }
    }

    // 2. Voice Minute Overage
    if (usage.totalVoiceMinutes > plan.includedVoiceMinutes) {
      const overageQty = usage.totalVoiceMinutes - plan.includedVoiceMinutes;
      const amountCents = Math.round(overageQty * plan.voiceMinuteOverageRateCents);
      if (amountCents > 0) {
        items.push({
          metricType: 'voice_minutes',
          usedQuantity: usage.totalVoiceMinutes,
          includedQuantity: plan.includedVoiceMinutes,
          overageQuantity: overageQty,
          rateCentsPerUnit: plan.voiceMinuteOverageRateCents,
          overageAmountCents: amountCents,
        });
        totalOverageAmountCents += amountCents;
      }
    }

    // 3. Workflow Execution Overage
    if (usage.totalWorkflowExecutions > plan.includedWorkflowExecutions) {
      const overageQty = usage.totalWorkflowExecutions - plan.includedWorkflowExecutions;
      const amountCents = Math.round(overageQty * plan.workflowOverageRateCents);
      if (amountCents > 0) {
        items.push({
          metricType: 'workflow_executions',
          usedQuantity: usage.totalWorkflowExecutions,
          includedQuantity: plan.includedWorkflowExecutions,
          overageQuantity: overageQty,
          rateCentsPerUnit: plan.workflowOverageRateCents,
          overageAmountCents: amountCents,
        });
        totalOverageAmountCents += amountCents;
      }
    }

    return {
      hasOverage: items.length > 0,
      totalOverageAmountCents,
      items,
    };
  }
}
