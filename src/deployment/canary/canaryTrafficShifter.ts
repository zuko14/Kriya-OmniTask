/**
 * Kriya AI — Canary Traffic Shifter & Automated Rollback Guardian
 * Controls gradual canary traffic weighting and evaluates real-time telemetry to trigger safe automatic rollbacks.
 */

export interface CanaryHealthMetrics {
  errorRatePct: number;
  p99LatencyMs: number;
  maxAllowedErrorRatePct?: number; // default 1.0%
  maxAllowedP99LatencyMs?: number; // default 1500ms
}

export interface CanaryEvaluationResult {
  action: 'advance' | 'hold' | 'rollback';
  recommendedWeightPct: number;
  reason: string;
}

export class CanaryTrafficShifter {
  /**
   * Evaluates live canary health and determines if rollout should advance, hold, or rollback immediately.
   */
  public static evaluateCanaryHealth(
    currentWeightPct: number,
    metrics: CanaryHealthMetrics
  ): CanaryEvaluationResult {
    const maxErrorRate = metrics.maxAllowedErrorRatePct ?? 1.0;
    const maxP99Latency = metrics.maxAllowedP99LatencyMs ?? 1500;

    // 1. Check for Critical Degradation -> Rollback
    if (metrics.errorRatePct > maxErrorRate) {
      return {
        action: 'rollback',
        recommendedWeightPct: 0,
        reason: `Canary error rate (${metrics.errorRatePct}%) exceeded threshold (${maxErrorRate}%). Triggering automated emergency rollback.`,
      };
    }

    if (metrics.p99LatencyMs > maxP99Latency) {
      return {
        action: 'rollback',
        recommendedWeightPct: 0,
        reason: `Canary P99 latency (${metrics.p99LatencyMs}ms) exceeded threshold (${maxP99Latency}ms). Triggering automated emergency rollback.`,
      };
    }

    // 2. Determine Next Promotion Step
    if (currentWeightPct >= 100) {
      return {
        action: 'hold',
        recommendedWeightPct: 100,
        reason: 'Canary is at 100% traffic weight and fully healthy.',
      };
    }

    let nextWeight = 100;
    if (currentWeightPct < 10) nextWeight = 10;
    else if (currentWeightPct < 25) nextWeight = 25;
    else if (currentWeightPct < 50) nextWeight = 50;
    else nextWeight = 100;

    return {
      action: 'advance',
      recommendedWeightPct: nextWeight,
      reason: `Canary is healthy (Error rate: ${metrics.errorRatePct}%, P99: ${metrics.p99LatencyMs}ms). Advancing traffic weight to ${nextWeight}%.`,
    };
  }
}
