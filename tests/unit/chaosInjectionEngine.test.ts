import { describe, it, expect } from 'vitest';
import { ChaosInjectionEngine } from '../../src/hardening/chaos/chaosInjectionEngine.js';

describe('ChaosInjectionEngine Unit Tests', () => {
  it('should run chaos latency and network error experiments with resilience and self-healing', async () => {
    // 1. Latency fault experiment
    const latencyExp = await ChaosInjectionEngine.runExperiment({
      experimentName: 'Transient Latency Jitter',
      faultType: 'latency',
      faultProbability: 0.5,
      iterations: 6,
    });

    expect(latencyExp.id).toBeDefined();
    expect(latencyExp.status).toBe('passed');
    expect(latencyExp.recoveryTimeMs).toBeGreaterThan(0);

    // 2. Rate limit fault experiment
    const rateLimitExp = await ChaosInjectionEngine.runExperiment({
      experimentName: 'HTTP 429 Model Rate Limit Spikes',
      faultType: 'rate_limit',
      faultProbability: 0.5,
      iterations: 6,
    });

    expect(rateLimitExp.status).toBe('passed');
  });
});
