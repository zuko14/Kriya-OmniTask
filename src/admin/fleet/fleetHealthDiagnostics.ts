/**
 * Xylarc AI — Fleet Health & Node Diagnostics
 * Aggregates cluster liveness, worker concurrency, and distributed node telemetry.
 */

import {
  NodeFleetRecord,
  FleetDiagnosticsSummary,
  NodeStatus,
} from '../types/adminTypes.js';

export class FleetHealthDiagnostics {
  private static readonly STALE_HEARTBEAT_THRESHOLD_MS = 60 * 1000; // 60s

  /**
   * Evaluates freshness and produces diagnostic summary across all cluster nodes.
   */
  public static evaluateDiagnostics(nodes: NodeFleetRecord[], now = new Date()): FleetDiagnosticsSummary {
    const totalNodes = nodes.length;
    let onlineNodes = 0;
    let degradedNodes = 0;
    let offlineNodes = 0;
    let totalCpu = 0;
    let totalMemory = 0;
    let totalActiveThreads = 0;
    let totalActiveExecutions = 0;

    const evaluatedNodes: NodeFleetRecord[] = nodes.map((node) => {
      const lastHbTime = new Date(node.lastHeartbeatAt).getTime();
      const isStale = now.getTime() - lastHbTime > this.STALE_HEARTBEAT_THRESHOLD_MS;

      let effectiveStatus: NodeStatus = node.status;
      if (isStale) {
        effectiveStatus = 'offline';
      }

      if (effectiveStatus === 'healthy') {
        onlineNodes++;
      } else if (effectiveStatus === 'degraded' || effectiveStatus === 'draining') {
        degradedNodes++;
      } else {
        offlineNodes++;
      }

      totalCpu += node.cpuUsagePct;
      totalMemory += node.memoryUsagePct;
      totalActiveThreads += node.activeWorkerThreads;
      totalActiveExecutions += node.activeAgentExecutions;

      return {
        ...node,
        status: effectiveStatus,
      };
    });

    const avgCpuUsagePct = totalNodes > 0 ? Number((totalCpu / totalNodes).toFixed(1)) : 0;
    const avgMemoryUsagePct = totalNodes > 0 ? Number((totalMemory / totalNodes).toFixed(1)) : 0;

    let clusterHealth: 'healthy' | 'degraded' | 'critical' = 'healthy';
    if (totalNodes === 0 || offlineNodes > onlineNodes) {
      clusterHealth = 'critical';
    } else if (degradedNodes > 0 || avgCpuUsagePct > 85.0 || avgMemoryUsagePct > 85.0) {
      clusterHealth = 'degraded';
    }

    return {
      totalNodes,
      onlineNodes,
      degradedNodes,
      offlineNodes,
      avgCpuUsagePct,
      avgMemoryUsagePct,
      totalActiveThreads,
      totalActiveExecutions,
      clusterHealth,
      nodes: evaluatedNodes,
    };
  }
}
