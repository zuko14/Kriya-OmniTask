/**
 * Kriya AI — Canary Routing & Telemetry Evaluation Engine
 * Deterministic hash-bucket traffic allocation with session affinity and automated degradation detection.
 */

import { createHash } from 'node:crypto';
import { CanaryHealthMetrics } from './canaryTrafficShifter.js';

export interface CanaryRouteDecision {
  target: 'canary' | 'stable';
  bucket: number;
  weightPct: number;
  tenantId: string;
}

export interface TelemetryEvaluationResult {
  action: 'advance' | 'hold' | 'rollback';
  recommendedWeightPct: number;
  verdict: 'healthy' | 'warning' | 'critical';
  reason: string;
}

export class CanaryRoutingEngine {
  /**
   * Deterministically computes a 0-99 bucket for a given tenant identifier.
   * Guarantees session affinity and uniform distribution across the keyspace.
   */
  public static computeTenantBucket(tenantId: string): number {
    if (!tenantId) return 0;
    const hash = createHash('sha256').update(`canary_salt_v1:${tenantId}`).digest('hex');
    const first8Chars = hash.substring(0, 8);
    const intVal = parseInt(first8Chars, 16);
    return intVal % 100;
  }

  /**
   * Decides whether an incoming request from a tenant should be routed to canary or stable.
   */
  public static routeTenant(tenantId: string, canaryWeightPct: number): CanaryRouteDecision {
    const clampedWeight = Math.max(0, Math.min(100, canaryWeightPct));
    if (clampedWeight === 0) {
      return { target: 'stable', bucket: 0, weightPct: 0, tenantId };
    }
    if (clampedWeight === 100) {
      return { target: 'canary', bucket: 99, weightPct: 100, tenantId };
    }

    const bucket = this.computeTenantBucket(tenantId);
    const target = bucket < clampedWeight ? 'canary' : 'stable';

    return {
      target,
      bucket,
      weightPct: clampedWeight,
      tenantId,
    };
  }

  /**
   * Evaluates incoming live telemetry against deployment SLO thresholds.
   * Phased progression: 5% -> 10% -> 25% -> 50% -> 100%.
   * Any breach of error rate or P99 latency triggers an automated 'rollback'.
   */
  public static evaluateTelemetry(
    currentWeightPct: number,
    metrics: CanaryHealthMetrics,
    customThresholds?: { maxErrorRatePct?: number; maxP99LatencyMs?: number }
  ): TelemetryEvaluationResult {
    const maxErrorRate = customThresholds?.maxErrorRatePct ?? metrics.maxAllowedErrorRatePct ?? 1.0;
    const maxP99Latency = customThresholds?.maxP99LatencyMs ?? metrics.maxAllowedP99LatencyMs ?? 1500;

    // 1. Critical degradation tripwires -> immediate automated rollback
    if (metrics.errorRatePct > maxErrorRate) {
      return {
        action: 'rollback',
        recommendedWeightPct: 0,
        verdict: 'critical',
        reason: `Canary error rate (${metrics.errorRatePct}%) breached threshold (${maxErrorRate}%). Automated emergency rollback required.`,
      };
    }

    if (metrics.p99LatencyMs > maxP99Latency) {
      return {
        action: 'rollback',
        recommendedWeightPct: 0,
        verdict: 'critical',
        reason: `Canary P99 latency (${metrics.p99LatencyMs}ms) breached threshold (${maxP99Latency}ms). Automated emergency rollback required.`,
      };
    }

    // 2. Warning boundary: within 80% of tripwire threshold -> hold
    const warningErrorRate = maxErrorRate * 0.8;
    const warningP99 = maxP99Latency * 0.8;
    if (metrics.errorRatePct >= warningErrorRate || metrics.p99LatencyMs >= warningP99) {
      return {
        action: 'hold',
        recommendedWeightPct: currentWeightPct,
        verdict: 'warning',
        reason: `Canary operating near threshold limits (Error: ${metrics.errorRatePct}%, P99: ${metrics.p99LatencyMs}ms). Holding traffic at ${currentWeightPct}%.`,
      };
    }

    // 3. Fully promoted check
    if (currentWeightPct >= 100) {
      return {
        action: 'hold',
        recommendedWeightPct: 100,
        verdict: 'healthy',
        reason: 'Canary is at 100% production traffic weight and fully healthy.',
      };
    }

    // 4. Multi-step progression ladder
    let nextWeight = 100;
    if (currentWeightPct < 5) nextWeight = 5;
    else if (currentWeightPct < 10) nextWeight = 10;
    else if (currentWeightPct < 25) nextWeight = 25;
    else if (currentWeightPct < 50) nextWeight = 50;
    else nextWeight = 100;

    return {
      action: 'advance',
      recommendedWeightPct: nextWeight,
      verdict: 'healthy',
      reason: `Canary is healthy (Error rate: ${metrics.errorRatePct}%, P99: ${metrics.p99LatencyMs}ms). Advancing traffic weight to ${nextWeight}%.`,
    };
  }
}
