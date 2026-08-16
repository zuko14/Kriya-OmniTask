/**
 * Xylarc AI — Organization KPI & Metric Evaluation Engine
 * Evaluates performance metrics, target thresholds, unit economics & health status (§14 of CLAUDE.md).
 */

import {
  OrganizationKpiRecord,
  KpiStatus,
} from '../types/digitalTwinTypes.js';

export interface KpiEvaluationResult {
  kpiId: string;
  kpiKey: string;
  targetValue: number;
  actualValue: number;
  status: KpiStatus;
  deviationPercent: number;
  unit: string;
  summary: string;
}

export class KpiEngine {
  /**
   * Deterministically evaluates health status based on KPI key directionality and target vs actual values.
   */
  public static evaluateStatus(
    kpiKey: string,
    targetValue: number,
    actualValue: number
  ): { status: KpiStatus; deviationPercent: number } {
    if (targetValue === 0) {
      return { status: actualValue === 0 ? 'on_track' : 'exceeded', deviationPercent: 0 };
    }

    const lowerIsBetterKeys = [
      'avg_response_time_seconds',
      'churn_risk_average',
      'customer_acquisition_cost',
      'sla_breach_count',
      'escalation_rate',
    ];

    const isLowerBetter = lowerIsBetterKeys.some((k) => kpiKey.toLowerCase().includes(k));

    if (isLowerBetter) {
      const deviation = ((actualValue - targetValue) / targetValue) * 100;
      if (actualValue <= targetValue) {
        return { status: 'on_track', deviationPercent: Math.round(deviation * 10) / 10 };
      } else if (actualValue <= targetValue * 1.25) {
        return { status: 'at_risk', deviationPercent: Math.round(deviation * 10) / 10 };
      } else {
        return { status: 'critical', deviationPercent: Math.round(deviation * 10) / 10 };
      }
    } else {
      // Higher is better (conversion, retention, MRR, resolution rate)
      const deviation = ((actualValue - targetValue) / targetValue) * 100;
      if (actualValue >= targetValue * 1.1) {
        return { status: 'exceeded', deviationPercent: Math.round(deviation * 10) / 10 };
      } else if (actualValue >= targetValue) {
        return { status: 'on_track', deviationPercent: Math.round(deviation * 10) / 10 };
      } else if (actualValue >= targetValue * 0.8) {
        return { status: 'at_risk', deviationPercent: Math.round(deviation * 10) / 10 };
      } else {
        return { status: 'critical', deviationPercent: Math.round(deviation * 10) / 10 };
      }
    }
  }

  /**
   * Evaluates an individual KPI record and returns structured diagnosis.
   */
  public static evaluate(kpi: OrganizationKpiRecord): KpiEvaluationResult {
    const { status, deviationPercent } = this.evaluateStatus(
      kpi.kpi_key,
      kpi.target_value,
      kpi.actual_value
    );

    let summary = `${kpi.kpi_name}: Actual ${kpi.actual_value} ${kpi.unit} vs Target ${kpi.target_value} ${kpi.unit} (${deviationPercent > 0 ? '+' : ''}${deviationPercent}%).`;
    if (status === 'critical') {
      summary += ' Immediate operational remediation required.';
    } else if (status === 'at_risk') {
      summary += ' Performance nearing SLA breach threshold.';
    } else if (status === 'on_track') {
      summary += ' Operational target met.';
    } else if (status === 'exceeded') {
      summary += ' Target exceeded successfully.';
    }

    return {
      kpiId: kpi.id,
      kpiKey: kpi.kpi_key,
      targetValue: kpi.target_value,
      actualValue: kpi.actual_value,
      status,
      deviationPercent,
      unit: kpi.unit,
      summary,
    };
  }
}
