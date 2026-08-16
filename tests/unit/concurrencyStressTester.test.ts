import { describe, it, expect } from 'vitest';
import { ConcurrencyStressTester } from '../../src/hardening/stress/concurrencyStressTester.js';

describe('ConcurrencyStressTester Unit Tests', () => {
  it('should execute concurrent multi-tenant workload and compute throughput, latencies, and zero leakage', async () => {
    const result = await ConcurrencyStressTester.runStressTest({
      runName: 'Unit Concurrency Stress Test',
      concurrency: 8,
      requestsPerWorker: 5,
      tenantCount: 3,
    });

    expect(result.id).toBeDefined();
    expect(result.totalRequests).toBe(40);
    expect(result.successfulRequests).toBe(40);
    expect(result.failedRequests).toBe(0);
    expect(result.throughputRps).toBeGreaterThan(0);
    expect(result.p50LatencyMs).toBeGreaterThanOrEqual(0);
    expect(result.p95LatencyMs).toBeGreaterThanOrEqual(result.p50LatencyMs);
    expect(result.crossTenantLeakageDetected).toBe(false);
  });
});
