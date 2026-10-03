/**
 * Kriya AI — Database Connection Pool Monitor & Throttler
 * Real-time connection pool diagnostics, saturation tracking, and acquisition throttling.
 */

import { ConnectionPoolStats } from '../types/infrastructureTypes.js';

export class ConnectionPoolManager {
  private activeCount: number = 0;
  private waitingCount: number = 0;
  private maxConnections: number;

  constructor(maxConnections = 25) {
    this.maxConnections = Math.max(1, maxConnections);
  }

  public recordConnectionAcquired(): void {
    this.activeCount = Math.min(this.maxConnections, this.activeCount + 1);
  }

  public recordConnectionReleased(): void {
    this.activeCount = Math.max(0, this.activeCount - 1);
  }

  public recordWaitingRequest(delta: number): void {
    this.waitingCount = Math.max(0, this.waitingCount + delta);
  }

  public getStats(): ConnectionPoolStats {
    const idleCount = Math.max(0, this.maxConnections - this.activeCount);
    const utilizationPct = Math.round((this.activeCount / this.maxConnections) * 1000) / 10;

    let status: ConnectionPoolStats['status'] = 'healthy';
    if (utilizationPct >= 95) {
      status = 'exhausted';
    } else if (utilizationPct >= 80) {
      status = 'warning';
    }

    return {
      totalConnections: this.maxConnections,
      activeConnections: this.activeCount,
      idleConnections: idleCount,
      maxConnections: this.maxConnections,
      waitingRequests: this.waitingCount,
      utilizationPct,
      status,
      timestamp: new Date().toISOString(),
    };
  }
}
