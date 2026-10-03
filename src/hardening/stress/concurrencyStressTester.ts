/**
 * Kriya AI — Multi-Tenant Concurrency Stress & Load Testing Harness
 * Simulates high-concurrency multi-tenant workloads to benchmark throughput, latency percentiles, and cross-contamination invariants.
 */

import { CryptoUtils } from '../../core/utils/crypto.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';
import { StressRunRecord } from '../types/hardeningTypes.js';

export class ConcurrencyStressTester {
  /**
   * Executes a high-concurrency multi-tenant benchmark suite.
   */
  public static async runStressTest(params: {
    runName?: string;
    concurrency?: number;
    requestsPerWorker?: number;
    tenantCount?: number;
  }): Promise<StressRunRecord> {
    const runName = params.runName || 'Standard Multi-Tenant Stress Benchmark';
    const concurrency = params.concurrency || 20;
    const requestsPerWorker = params.requestsPerWorker || 10;
    const tenantCount = params.tenantCount || 5;

    const tenants = Array.from({ length: tenantCount }, (_, i) => `tenant_stress_${i + 1}`);
    const latencies: number[] = [];
    let successful = 0;
    let failed = 0;
    let crossTenantLeakageDetected = false;

    const startTime = Date.now();

    // Create worker pool
    const workers = Array.from({ length: concurrency }, async (_, workerIdx) => {
      const assignedTenant = tenants[workerIdx % tenants.length];

      for (let reqIdx = 0; reqIdx < requestsPerWorker; reqIdx++) {
        const reqStart = Date.now();
        try {
          // Execute inside assigned tenant context
          await TenantContextManager.withTenant(assignedTenant, 'default', async () => {
            // Verify context isolation invariant
            const activeTenant = TenantContextManager.getTenantId();
            if (activeTenant !== assignedTenant) {
              crossTenantLeakageDetected = true;
            }

            // Simulate simulated microservice processing time
            await new Promise((resolve) => setTimeout(resolve, 2 + Math.floor(Math.random() * 8)));
          }, { userId: `usr_stress_${workerIdx}`, roles: ['agent_operator'] });

          successful++;
        } catch {
          failed++;
        } finally {
          const reqDuration = Date.now() - reqStart;
          latencies.push(reqDuration);
        }
      }
    });

    await Promise.all(workers);
    const totalDurationSec = Math.max(0.001, (Date.now() - startTime) / 1000);
    const totalRequests = successful + failed;
    const throughputRps = Math.round((totalRequests / totalDurationSec) * 10) / 10;

    // Calculate latency percentiles
    latencies.sort((a, b) => a - b);
    const p50 = latencies[Math.floor(latencies.length * 0.5)] || 0;
    const p95 = latencies[Math.floor(latencies.length * 0.95)] || p50;
    const p99 = latencies[Math.floor(latencies.length * 0.99)] || p95;

    const recordId = `stress_${CryptoUtils.generateId()}`;

    return {
      id: recordId,
      runName,
      concurrencyLevel: concurrency,
      totalRequests,
      successfulRequests: successful,
      failedRequests: failed,
      throughputRps,
      p50LatencyMs: p50,
      p95LatencyMs: p95,
      p99LatencyMs: p99,
      crossTenantLeakageDetected,
      createdAt: new Date().toISOString(),
    };
  }
}
