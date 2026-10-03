import { describe, it, expect } from 'vitest';
import { FleetHealthDiagnostics } from '../../src/admin/fleet/fleetHealthDiagnostics.js';
import { NodeFleetRecord } from '../../src/admin/types/adminTypes.js';

describe('FleetHealthDiagnostics Unit Tests', () => {
  const now = new Date('2026-03-01T12:00:00.000Z');

  const nodes: NodeFleetRecord[] = [
    {
      id: 'node_1',
      nodeId: 'worker_node_us_east_1',
      clusterRegion: 'us-east-1',
      status: 'healthy',
      cpuUsagePct: 45.0,
      memoryUsagePct: 55.0,
      activeWorkerThreads: 16,
      activeAgentExecutions: 8,
      lastHeartbeatAt: '2026-03-01T11:59:50.000Z', // Fresh (10s ago)
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 'node_2',
      nodeId: 'worker_node_eu_west_1',
      clusterRegion: 'eu-west-1',
      status: 'healthy',
      cpuUsagePct: 90.0,
      memoryUsagePct: 88.0,
      activeWorkerThreads: 32,
      activeAgentExecutions: 24,
      lastHeartbeatAt: '2026-03-01T11:57:00.000Z', // Stale (3 minutes ago) -> should become offline
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
  ];

  it('should evaluate diagnostics, identify stale heartbeats, and calculate cluster metrics', () => {
    const summary = FleetHealthDiagnostics.evaluateDiagnostics(nodes, now);

    expect(summary.totalNodes).toBe(2);
    expect(summary.healthyNodes).toBe(1);
    expect(summary.offlineNodes).toBe(1); // Node 2 marked offline due to stale heartbeat (>60s)
    expect(summary.totalActiveThreads).toBe(48);
    expect(summary.totalActiveExecutions).toBe(32);
    expect(summary.avgCpuUsagePct).toBe(67.5);
    expect(summary.avgMemoryUsagePct).toBe(71.5);
  });
});
