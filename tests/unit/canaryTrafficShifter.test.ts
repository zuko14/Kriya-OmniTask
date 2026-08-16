import { describe, it, expect } from 'vitest';
import { CanaryTrafficShifter } from '../../src/deployment/canary/canaryTrafficShifter.js';

describe('CanaryTrafficShifter Unit Tests', () => {
  it('should recommend advancing canary traffic weight under healthy metrics', () => {
    const evalResult = CanaryTrafficShifter.evaluateCanaryHealth(10, {
      errorRatePct: 0.1, // 0.1% error rate
      p99LatencyMs: 450,
      maxAllowedErrorRatePct: 1.0,
      maxAllowedP99LatencyMs: 1500,
    });

    expect(evalResult.action).toBe('advance');
    expect(evalResult.recommendedWeightPct).toBe(25);
  });

  it('should trigger immediate emergency rollback when canary error rate spikes', () => {
    const evalResult = CanaryTrafficShifter.evaluateCanaryHealth(25, {
      errorRatePct: 3.5, // 3.5% error rate (exceeds 1.0%)
      p99LatencyMs: 600,
      maxAllowedErrorRatePct: 1.0,
    });

    expect(evalResult.action).toBe('rollback');
    expect(evalResult.recommendedWeightPct).toBe(0);
    expect(evalResult.reason).toContain('exceeded threshold');
  });
});
