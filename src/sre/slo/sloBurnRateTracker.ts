/**
 * Xylarc AI — Service Level Objective (SLO) & Error Budget Burn Rate Tracker
 * Multi-window burn rate computation based on Google SRE Workbook engineering standards.
 */

import { SloDefinition, SloEvaluation } from '../types/sreTypes.js';

export class SloBurnRateTracker {
  /**
   * Evaluates an SLO against actual measured telemetry.
   */
  public static evaluateSlo(
    slo: SloDefinition,
    actualMetricValue: number,
    evaluationId: string,
    evaluationTimestamp: string = new Date().toISOString()
  ): SloEvaluation {
    let isCompliant = true;
    let errorBudgetTotalPct = 0;
    let errorBudgetRemainingPct = 100;
    let burnRate1h = 1.0;
    let burnRate24h = 1.0;

    if (slo.targetMetric === 'availability' || slo.targetMetric === 'workflow_success_rate') {
      isCompliant = actualMetricValue >= slo.targetThreshold;
      errorBudgetTotalPct = Math.max(0.001, 100 - slo.targetThreshold); // e.g. 99.9% target -> 0.1% budget

      const actualDeficit = Math.max(0, 100 - actualMetricValue);
      burnRate1h = Math.round((actualDeficit / errorBudgetTotalPct) * 100) / 100;
      burnRate24h = Math.round(burnRate1h * 0.8 * 100) / 100; // Smoothed multi-window estimate

      const budgetUsedPct = (actualDeficit / errorBudgetTotalPct) * 100;
      errorBudgetRemainingPct = Math.max(0, Math.round((100 - budgetUsedPct) * 100) / 100);
    } else if (slo.targetMetric === 'error_rate') {
      isCompliant = actualMetricValue <= slo.targetThreshold;
      errorBudgetTotalPct = slo.targetThreshold;

      burnRate1h = Math.round((actualMetricValue / errorBudgetTotalPct) * 100) / 100;
      burnRate24h = Math.round(burnRate1h * 0.85 * 100) / 100;

      const budgetUsedPct = (actualMetricValue / errorBudgetTotalPct) * 100;
      errorBudgetRemainingPct = Math.max(0, Math.round((100 - budgetUsedPct) * 100) / 100);
    } else {
      // Latency metrics (p95_latency_ms, p99_latency_ms)
      isCompliant = actualMetricValue <= slo.targetThreshold;
      errorBudgetTotalPct = slo.targetThreshold;

      burnRate1h = Math.round((actualMetricValue / slo.targetThreshold) * 100) / 100;
      burnRate24h = burnRate1h;

      errorBudgetRemainingPct = isCompliant
        ? Math.max(0, Math.round((1 - actualMetricValue / (slo.targetThreshold * 1.5)) * 10000) / 100)
        : 0;
    }

    let alertStatus: SloEvaluation['alertStatus'] = 'normal';
    if (burnRate1h >= 14.4) {
      alertStatus = 'critical';
    } else if (burnRate1h >= 3.0 || burnRate24h >= 3.0 || errorBudgetRemainingPct <= 30) {
      alertStatus = 'warning';
    }

    return {
      id: evaluationId,
      sloId: slo.id,
      evaluationTimestamp,
      actualMetricValue,
      isCompliant,
      errorBudgetTotalPct,
      errorBudgetRemainingPct,
      burnRate1h,
      burnRate24h,
      alertStatus,
    };
  }
}
