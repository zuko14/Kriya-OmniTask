/**
 * Kriya AI — Bulkhead & Adaptive Circuit Breaker
 * Concurrency limiting, failure rate monitoring, fast-failing open circuits, and jittered exponential backoff.
 */

import { DependencyHealthState } from '../types/reliabilityTypes.js';

export interface BulkheadConfig {
  maxConcurrency: number;
  failureThresholdPercentage: number;
  recoveryTimeMs: number;
  consecutiveFailuresLimit: number;
}

export class BulkheadCircuitBreaker {
  private activeConcurrency = 0;
  private consecutiveFailures = 0;
  private state: DependencyHealthState = 'healthy';
  private lastFailureTime = 0;

  constructor(
    public readonly dependencyName: string,
    private readonly config: BulkheadConfig = {
      maxConcurrency: 10,
      failureThresholdPercentage: 50,
      recoveryTimeMs: 15000,
      consecutiveFailuresLimit: 5,
    }
  ) {}

  /**
   * Computes an exponential backoff with full jitter to avoid thundering herd problem.
   */
  public static calculateBackoffWithJitter(
    attempt: number,
    baseMs: number = 200,
    maxMs: number = 10000
  ): number {
    const rawDelay = Math.min(maxMs, baseMs * Math.pow(2, Math.max(0, attempt - 1)));
    // Full jitter between 50% and 100% of rawDelay
    const jitterFactor = 0.5 + Math.random() * 0.5;
    return Math.floor(rawDelay * jitterFactor);
  }

  /**
   * Tries to acquire an execution slot under bulkhead limits.
   */
  public canExecute(): { allowed: boolean; reason?: string } {
    const now = Date.now();

    // If circuit is broken, check if recovery period elapsed
    if (this.state === 'circuit_broken') {
      if (now - this.lastFailureTime > this.config.recoveryTimeMs) {
        this.state = 'degraded'; // Half-open probe
      } else {
        return {
          allowed: false,
          reason: `Circuit breaker is OPEN for dependency '${this.dependencyName}'. Fast-failing request.`,
        };
      }
    }

    // Check bulkhead concurrency limit
    if (this.activeConcurrency >= this.config.maxConcurrency) {
      return {
        allowed: false,
        reason: `Bulkhead concurrency limit (${this.config.maxConcurrency}) reached for dependency '${this.dependencyName}'.`,
      };
    }

    this.activeConcurrency++;
    return { allowed: true };
  }

  /**
   * Records execution outcome and adjusts circuit breaker state.
   */
  public recordResult(isSuccess: boolean, _latencyMs?: number): void {
    if (this.activeConcurrency > 0) {
      this.activeConcurrency--;
    }

    if (isSuccess) {
      this.consecutiveFailures = 0;
      this.state = 'healthy';
    } else {
      this.consecutiveFailures++;
      this.lastFailureTime = Date.now();

      if (this.consecutiveFailures >= this.config.consecutiveFailuresLimit) {
        this.state = 'circuit_broken';
      } else if (this.consecutiveFailures >= 2) {
        this.state = 'degraded';
      }
    }
  }

  public getState(): DependencyHealthState {
    return this.state;
  }

  public getActiveConcurrency(): number {
    return this.activeConcurrency;
  }

  public getConsecutiveFailures(): number {
    return this.consecutiveFailures;
  }
}
