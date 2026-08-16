import { describe, it, expect } from 'vitest';
import { ConnectionPoolManager } from '../../src/infrastructure/pool/connectionPoolManager.js';

describe('ConnectionPoolManager Unit Tests', () => {
  it('should track active, idle connections and correctly reflect pool status', () => {
    const pool = new ConnectionPoolManager(10);

    // Initial State
    let stats = pool.getStats();
    expect(stats.totalConnections).toBe(10);
    expect(stats.activeConnections).toBe(0);
    expect(stats.idleConnections).toBe(10);
    expect(stats.utilizationPct).toBe(0);
    expect(stats.status).toBe('healthy');

    // Acquire 8 connections (80% utilization -> warning)
    for (let i = 0; i < 8; i++) {
      pool.recordConnectionAcquired();
    }
    stats = pool.getStats();
    expect(stats.activeConnections).toBe(8);
    expect(stats.idleConnections).toBe(2);
    expect(stats.utilizationPct).toBe(80);
    expect(stats.status).toBe('warning');

    // Acquire 2 more connections (100% utilization -> exhausted)
    pool.recordConnectionAcquired();
    pool.recordConnectionAcquired();
    stats = pool.getStats();
    expect(stats.activeConnections).toBe(10);
    expect(stats.idleConnections).toBe(0);
    expect(stats.utilizationPct).toBe(100);
    expect(stats.status).toBe('exhausted');

    // Release 5 connections -> healthy
    for (let i = 0; i < 5; i++) {
      pool.recordConnectionReleased();
    }
    stats = pool.getStats();
    expect(stats.activeConnections).toBe(5);
    expect(stats.status).toBe('healthy');
  });
});
