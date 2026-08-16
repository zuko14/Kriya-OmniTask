/**
 * Xylarc AI — Tool Circuit Breaker Unit Tests
 * Verifies fault tolerance, fast-failing during outage, and automatic recovery (§18 of CLAUDE.md).
 */

import { describe, it, expect } from 'vitest';
import { ToolCircuitBreaker } from '../../src/tools/circuit/circuitBreaker.js';
import { PolicyViolationError } from '../../src/core/errors/errors.js';

describe('Tool Circuit Breaker Unit Tests', () => {
  const tenantId = 'tenant_cb_test';
  const toolSlug = 'flaky_payment_api';

  it('should start in CLOSED state and permit executions', () => {
    const cb = new ToolCircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 100 });
    expect(cb.getState(tenantId, toolSlug)).toBe('CLOSED');
    expect(() => cb.assertCanExecute(tenantId, toolSlug)).not.toThrow();
  });

  it('should trip to OPEN state after reaching failure threshold and block subsequent calls', () => {
    const cb = new ToolCircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 500 });

    cb.recordFailure(tenantId, toolSlug);
    cb.recordFailure(tenantId, toolSlug);
    expect(cb.getState(tenantId, toolSlug)).toBe('CLOSED');

    // 3rd failure trips breaker
    cb.recordFailure(tenantId, toolSlug);
    expect(cb.getState(tenantId, toolSlug)).toBe('OPEN');

    // Assert fast-fail without invoking downstream
    expect(() => cb.assertCanExecute(tenantId, toolSlug)).toThrow(PolicyViolationError);
  });

  it('should transition to HALF_OPEN after timeout and recover to CLOSED upon success', async () => {
    const cb = new ToolCircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 50 });

    cb.recordFailure(tenantId, toolSlug);
    cb.recordFailure(tenantId, toolSlug);
    expect(cb.getState(tenantId, toolSlug)).toBe('OPEN');

    // Wait for reset timeout
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(cb.getState(tenantId, toolSlug)).toBe('HALF_OPEN');

    // Canary execution permitted
    expect(() => cb.assertCanExecute(tenantId, toolSlug)).not.toThrow();

    // Success resets breaker to CLOSED
    cb.recordSuccess(tenantId, toolSlug);
    expect(cb.getState(tenantId, toolSlug)).toBe('CLOSED');
  });
});
