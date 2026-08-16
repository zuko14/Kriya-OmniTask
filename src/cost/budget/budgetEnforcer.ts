/**
 * Xylarc AI — Tenant Budget Enforcer & Circuit Breaker
 * Real-time budget monitoring, threshold warning generation, and hard ceiling circuit breaking.
 */

import {
  TenantBudgetPolicy,
  BudgetEvaluationResult,
  SpendBreakdown,
  CostCategory,
  CostProvider,
} from '../types/costTypes.js';

export class BudgetEnforcer {
  /**
   * Evaluates if a new task or query is permitted under the active tenant budget policy.
   */
  public static evaluateBudget(
    policy: TenantBudgetPolicy | null,
    estimatedCostUsd = 0.0
  ): BudgetEvaluationResult {
    if (!policy) {
      // Default: No explicit policy set, execution permitted
      return {
        allowed: true,
        actionTaken: 'proceed',
        monthlyUtilizationPct: 0,
        dailyUtilizationPct: 0,
      };
    }

    if (policy.isCircuitBroken) {
      return {
        allowed: false,
        actionTaken: 'circuit_break',
        reason: 'Tenant budget circuit breaker is active. Hard cap was previously tripped.',
        monthlyUtilizationPct: Number(((policy.currentMonthSpendUsd / policy.monthlyBudgetUsd) * 100).toFixed(1)),
        dailyUtilizationPct: Number(((policy.currentDaySpendUsd / policy.dailyBudgetUsd) * 100).toFixed(1)),
      };
    }

    const projectedMonthSpend = policy.currentMonthSpendUsd + estimatedCostUsd;
    const projectedDaySpend = policy.currentDaySpendUsd + estimatedCostUsd;

    const monthlyPct = Number(((projectedMonthSpend / policy.monthlyBudgetUsd) * 100).toFixed(1));
    const dailyPct = Number(((projectedDaySpend / policy.dailyBudgetUsd) * 100).toFixed(1));

    const isExceeded = projectedMonthSpend >= policy.monthlyBudgetUsd || projectedDaySpend >= policy.dailyBudgetUsd;

    if (isExceeded) {
      if (policy.hardCapAction === 'circuit_break_reject') {
        return {
          allowed: false,
          actionTaken: 'circuit_break',
          reason: `Budget cap reached (Monthly: ${monthlyPct}%, Daily: ${dailyPct}%). Hard ceiling enforced.`,
          monthlyUtilizationPct: monthlyPct,
          dailyUtilizationPct: dailyPct,
        };
      }

      if (policy.hardCapAction === 'degrade_to_cheapest_model') {
        return {
          allowed: true,
          actionTaken: 'degraded_mode',
          reason: `Budget cap reached (Monthly: ${monthlyPct}%, Daily: ${dailyPct}%). Degrading execution to cheapest local model.`,
          monthlyUtilizationPct: monthlyPct,
          dailyUtilizationPct: dailyPct,
        };
      }

      return {
        allowed: true,
        actionTaken: 'warning',
        reason: `Budget cap exceeded (Monthly: ${monthlyPct}%, Daily: ${dailyPct}%). Notify-only action active.`,
        monthlyUtilizationPct: monthlyPct,
        dailyUtilizationPct: dailyPct,
      };
    }

    const isWarning = monthlyPct >= policy.warningThresholdPct || dailyPct >= policy.warningThresholdPct;

    if (isWarning) {
      return {
        allowed: true,
        actionTaken: 'warning',
        reason: `Budget warning threshold reached (Monthly: ${monthlyPct}%, Daily: ${dailyPct}%).`,
        monthlyUtilizationPct: monthlyPct,
        dailyUtilizationPct: dailyPct,
      };
    }

    return {
      allowed: true,
      actionTaken: 'proceed',
      monthlyUtilizationPct: monthlyPct,
      dailyUtilizationPct: dailyPct,
    };
  }

  /**
   * Builds high-level spend breakdown and policy utilization health metrics.
   */
  public static buildSpendBreakdown(
    totalSpendUsd: number,
    byCategory: Record<CostCategory, number>,
    byProvider: Record<CostProvider, number>,
    byAgent: Record<string, number>,
    activePolicy: TenantBudgetPolicy | null
  ): SpendBreakdown {
    const monthlyPct =
      activePolicy && activePolicy.monthlyBudgetUsd > 0
        ? Number(((activePolicy.currentMonthSpendUsd / activePolicy.monthlyBudgetUsd) * 100).toFixed(1))
        : 0;

    const dailyPct =
      activePolicy && activePolicy.dailyBudgetUsd > 0
        ? Number(((activePolicy.currentDaySpendUsd / activePolicy.dailyBudgetUsd) * 100).toFixed(1))
        : 0;

    let status: 'normal' | 'warning' | 'circuit_broken' = 'normal';
    if (activePolicy?.isCircuitBroken || monthlyPct >= 100 || dailyPct >= 100) {
      status = 'circuit_broken';
    } else if (activePolicy && (monthlyPct >= activePolicy.warningThresholdPct || dailyPct >= activePolicy.warningThresholdPct)) {
      status = 'warning';
    }

    return {
      totalSpendUsd: Number(totalSpendUsd.toFixed(4)),
      byCategory,
      byProvider,
      byAgent,
      activePolicy,
      utilization: {
        monthlyPct,
        dailyPct,
        status,
      },
    };
  }
}
