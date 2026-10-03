/**
 * Kriya AI — Tool Gateway Circuit Breaker
 * Protects downstream services and prevents cascade failures (§18 of CLAUDE.md).
 */

import { CircuitBreakerState } from '../types/toolTypes.js';
import { PolicyViolationError } from '../../core/errors/errors.js';
import { logger } from '../../core/logger/logger.js';

interface CircuitStateRecord {
  state: CircuitBreakerState;
  failureCount: number;
  lastFailureTime: number;
  lastStateChange: number;
}

export interface CircuitBreakerOptions {
  failureThreshold?: number;
  resetTimeoutMs?: number;
}

export class ToolCircuitBreaker {
  private states = new Map<string, CircuitStateRecord>();
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;

  constructor(options?: CircuitBreakerOptions) {
    this.failureThreshold = options?.failureThreshold ?? 5;
    this.resetTimeoutMs = options?.resetTimeoutMs ?? 30000;
  }

  private getKey(tenantId: string, toolSlug: string): string {
    return `${tenantId}:${toolSlug}`;
  }

  /**
   * Checks if an execution is permitted under current circuit state.
   */
  public assertCanExecute(tenantId: string, toolSlug: string): void {
    const key = this.getKey(tenantId, toolSlug);
    const record = this.states.get(key);

    if (!record) return; // Default CLOSED

    const now = Date.now();

    if (record.state === 'OPEN') {
      if (now - record.lastFailureTime > this.resetTimeoutMs) {
        // Transition to HALF_OPEN to test canary
        record.state = 'HALF_OPEN';
        record.lastStateChange = now;
        logger.info(`Circuit breaker for tool '${toolSlug}' entered HALF_OPEN state.`, { tenantId, toolSlug });
        return;
      }

      throw new PolicyViolationError(
        `Circuit breaker is OPEN for tool '${toolSlug}'. Downstream service is currently unavailable.`,
        { toolSlug, state: 'OPEN', retryAfterMs: this.resetTimeoutMs - (now - record.lastFailureTime) }
      );
    }
  }

  /**
   * Records a successful execution.
   */
  public recordSuccess(tenantId: string, toolSlug: string): void {
    const key = this.getKey(tenantId, toolSlug);
    const record = this.states.get(key);

    if (record) {
      if (record.state === 'HALF_OPEN' || record.failureCount > 0) {
        logger.info(`Circuit breaker for tool '${toolSlug}' reset to CLOSED.`, { tenantId, toolSlug });
      }
      record.state = 'CLOSED';
      record.failureCount = 0;
      record.lastStateChange = Date.now();
    }
  }

  /**
   * Records an execution failure and trips to OPEN if threshold exceeded.
   */
  public recordFailure(tenantId: string, toolSlug: string): void {
    const key = this.getKey(tenantId, toolSlug);
    const now = Date.now();
    let record = this.states.get(key);

    if (!record) {
      record = {
        state: 'CLOSED',
        failureCount: 0,
        lastFailureTime: now,
        lastStateChange: now,
      };
      this.states.set(key, record);
    }

    record.failureCount += 1;
    record.lastFailureTime = now;

    if (record.state === 'HALF_OPEN' || record.failureCount >= this.failureThreshold) {
      record.state = 'OPEN';
      record.lastStateChange = now;
      logger.warn(
        `Circuit breaker tripped to OPEN for tool '${toolSlug}' after ${record.failureCount} consecutive failures.`,
        { tenantId, toolSlug, failureCount: record.failureCount }
      );
    }
  }

  /**
   * Inspects current state for monitoring.
   */
  public getState(tenantId: string, toolSlug: string): CircuitBreakerState {
    const key = this.getKey(tenantId, toolSlug);
    const record = this.states.get(key);
    if (!record) return 'CLOSED';

    if (record.state === 'OPEN' && Date.now() - record.lastFailureTime > this.resetTimeoutMs) {
      return 'HALF_OPEN';
    }

    return record.state;
  }

  public reset(tenantId: string, toolSlug: string): void {
    const key = this.getKey(tenantId, toolSlug);
    this.states.delete(key);
  }
}
