import { describe, it, expect } from 'vitest';
import { BulkheadCircuitBreaker } from '../../src/reliability/circuit/bulkheadCircuitBreaker.js';

describe('BulkheadCircuitBreaker Unit Tests', () => {
  it('should enforce concurrency bulkhead limits', () => {
    const cb = new BulkheadCircuitBreaker('openai_api', {
      maxConcurrency: 2,
      failureThresholdPercentage: 50,
      recoveryTimeMs: 5000,
      consecutiveFailuresLimit: 3,
    });

    const slot1 = cb.canExecute();
    expect(slot1.allowed).toBe(true);

    const slot2 = cb.canExecute();
    expect(slot2.allowed).toBe(true);

    const slot3 = cb.canExecute();
    expect(slot3.allowed).toBe(false);
    expect(slot3.reason).toContain('Bulkhead concurrency limit');

    // Release one slot
    cb.recordResult(true);
    const slotAfterRelease = cb.canExecute();
    expect(slotAfterRelease.allowed).toBe(true);
  });

  it('should trip circuit to circuit_broken after consecutive failures and calculate jittered backoff', () => {
    const cb = new BulkheadCircuitBreaker('stripe_api', {
      maxConcurrency: 5,
      failureThresholdPercentage: 50,
      recoveryTimeMs: 5000,
      consecutiveFailuresLimit: 3,
    });

    expect(cb.getState()).toBe('healthy');

    // 1st failure
    cb.canExecute();
    cb.recordResult(false);
    expect(cb.getState()).toBe('healthy');

    // 2nd failure -> degraded
    cb.canExecute();
    cb.recordResult(false);
    expect(cb.getState()).toBe('degraded');

    // 3rd failure -> circuit_broken
    cb.canExecute();
    cb.recordResult(false);
    expect(cb.getState()).toBe('circuit_broken');

    const blocked = cb.canExecute();
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toContain('Circuit breaker is OPEN');

    // Jittered backoff verification
    const delay1 = BulkheadCircuitBreaker.calculateBackoffWithJitter(1, 200, 5000);
    expect(delay1).toBeGreaterThanOrEqual(100);
    expect(delay1).toBeLessThanOrEqual(200);

    const delay3 = BulkheadCircuitBreaker.calculateBackoffWithJitter(3, 200, 5000);
    expect(delay3).toBeGreaterThanOrEqual(400);
    expect(delay3).toBeLessThanOrEqual(800);
  });
});
