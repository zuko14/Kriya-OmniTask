import { useState, useCallback } from 'react';
import { apiFetch, ApiError } from '../../lib/apiClient';
import { useAsync } from '../../lib/useAsync';
import { DataTable, Column } from '../../components/DataTable';
import { KpiCard } from '../../components/KpiCard';
import { AsyncState } from '../../components/AsyncState';
import styles from './PlatformFleet.module.css';

export interface NodeFleetRecord {
  nodeId: string;
  clusterRegion: string;
  status: 'healthy' | 'degraded' | 'draining' | 'offline';
  cpuUsagePct: number;
  memoryUsagePct: number;
  lastHeartbeat: string;
}

export interface FleetDiagnosticsSummary {
  totalNodes: number;
  onlineNodes: number;
  degradedNodes: number;
  offlineNodes: number;
  avgCpuUsagePct: number;
  avgMemoryUsagePct: number;
  clusterHealth: 'healthy' | 'degraded' | 'critical';
  nodes?: NodeFleetRecord[];
}

export function PlatformFleet() {
  const [refreshTrigger, setRefreshTrigger] = useState<number>(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Heartbeat Modal
  const [isSendingHeartbeat, setIsSendingHeartbeat] = useState<boolean>(false);
  const [nodeId, setNodeId] = useState<string>('');
  const [clusterRegion, setClusterRegion] = useState<string>('us-east-1');
  const [nodeStatus, setNodeStatus] = useState<'healthy' | 'degraded' | 'draining' | 'offline'>('healthy');
  const [cpuUsage, setCpuUsage] = useState<number>(25);
  const [memUsage, setMemUsage] = useState<number>(40);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const fetchFleet = useCallback(() => {
    return apiFetch<FleetDiagnosticsSummary>('/api/v1/admin/fleet/diagnostics');
  }, [refreshTrigger]);

  const fleetState = useAsync(fetchFleet, [fetchFleet]);

  const handleHeartbeat = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsSubmitting(true);
      setActionError(null);
      await apiFetch('/api/v1/admin/fleet/heartbeat', {
        method: 'POST',
        body: JSON.stringify({
          nodeId,
          clusterRegion,
          status: nodeStatus,
          cpuUsagePct: Number(cpuUsage),
          memoryUsagePct: Number(memUsage),
        }),
      });
      setActionSuccess(`Heartbeat recorded for node '${nodeId}'.`);
      setIsSendingHeartbeat(false);
      setNodeId('');
      setRefreshTrigger((prev) => prev + 1);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Failed to record heartbeat');
    } finally {
      setIsSubmitting(false);
    }
  };

  const diagnostics = fleetState.status === 'success' ? fleetState.data : null;
  const nodes = diagnostics?.nodes || [];

  const columns: Column<NodeFleetRecord>[] = [
    {
      key: 'nodeId',
      header: 'Node Identifier',
      render: (n) => <strong style={{ fontFamily: 'var(--font-mono)' }}>{n.nodeId}</strong>,
    },
    {
      key: 'clusterRegion',
      header: 'Cluster Region',
      render: (n) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px' }}>{n.clusterRegion}</span>,
    },
    {
      key: 'status',
      header: 'Node Status',
      width: '120px',
      render: (n) => {
        let badgeClass = styles.badgeHealthy;
        if (n.status === 'degraded' || n.status === 'draining') badgeClass = styles.badgeDegraded;
        if (n.status === 'offline') badgeClass = styles.badgeOffline;
        return <span className={`${styles.badge} ${badgeClass}`}>{n.status}</span>;
      },
    },
    {
      key: 'cpuUsagePct',
      header: 'CPU Usage',
      width: '120px',
      render: (n) => <span>{n.cpuUsagePct.toFixed(1)}%</span>,
    },
    {
      key: 'memoryUsagePct',
      header: 'Memory Usage',
      width: '120px',
      render: (n) => <span>{n.memoryUsagePct.toFixed(1)}%</span>,
    },
    {
      key: 'lastHeartbeat',
      header: 'Last Seen',
      width: '150px',
      render: (n) => <span style={{ fontSize: '11px', color: 'var(--color-ink-muted)' }}>{new Date(n.lastHeartbeat).toLocaleTimeString()}</span>,
    },
  ];

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.titleGroup}>
          <h1>Autonomous Compute Fleet & Node Health</h1>
          <p className={styles.subtitle}>Multi-region distributed compute nodes, heartbeat diagnostics, and capacity utilization.</p>
        </div>
        <div className={styles.headerActions}>
          <button className={styles.btnPrimary} onClick={() => setIsSendingHeartbeat(true)}>
            + Dispatch Node Heartbeat
          </button>
        </div>
      </header>

      {actionError && <div style={{ color: 'var(--color-critical)', background: 'rgba(216,87,75,0.1)', padding: 'var(--space-3)', borderRadius: 'var(--radius-sm)' }}>⚠️ {actionError}</div>}
      {actionSuccess && <div style={{ color: 'var(--color-verify)', background: 'rgba(63,166,107,0.1)', padding: 'var(--space-3)', borderRadius: 'var(--radius-sm)' }}>✓ {actionSuccess}</div>}

      {/* Fleet KPI Metrics Grid */}
      <div className={styles.kpiGrid}>
        <KpiCard
          title="Cluster Health"
          value={diagnostics?.clusterHealth?.toUpperCase() || 'HEALTHY'}
        >
          <div style={{ fontSize: '11px', color: 'var(--color-ink-muted)' }}>Global orchestrator status</div>
        </KpiCard>
        <KpiCard
          title="Total Compute Nodes"
          value={String(diagnostics?.totalNodes ?? 0)}
        >
          <div style={{ fontSize: '11px', color: 'var(--color-ink-muted)' }}>Provisioned infrastructure</div>
        </KpiCard>
        <KpiCard
          title="Online Nodes"
          value={String(diagnostics?.onlineNodes ?? 0)}
        >
          <div style={{ fontSize: '11px', color: 'var(--color-ink-muted)' }}>Ready for execution</div>
        </KpiCard>
        <KpiCard
          title="Avg CPU Utilization"
          value={`${diagnostics?.avgCpuUsagePct?.toFixed(1) ?? '0.0'}%`}
        >
          <div style={{ fontSize: '11px', color: 'var(--color-ink-muted)' }}>Fleet compute load</div>
        </KpiCard>
        <KpiCard
          title="Avg Memory Utilization"
          value={`${diagnostics?.avgMemoryUsagePct?.toFixed(1) ?? '0.0'}%`}
        >
          <div style={{ fontSize: '11px', color: 'var(--color-ink-muted)' }}>Fleet memory footprint</div>
        </KpiCard>
      </div>

      {/* Nodes Table */}
      <div className={styles.sectionCard}>
        <h2 className={styles.sectionTitle}>Compute Nodes Inventory ({nodes.length})</h2>
        {fleetState.status !== 'success' ? (
          <AsyncState status={fleetState.status === 'loading' ? 'loading' : 'error'} error={fleetState.error} />
        ) : (
          <DataTable
            columns={columns}
            data={nodes}
            keyExtractor={(n) => n.nodeId}
            emptyMessage="No compute nodes active or registered in the fleet."
            ariaLabel="Fleet compute nodes table"
          />
        )}
      </div>

      {/* Heartbeat Modal */}
      {isSendingHeartbeat && (
        <div className={styles.modalBackdrop} role="dialog" aria-modal="true" aria-labelledby="heartbeat-modal-title">
          <div className={styles.modal}>
            <h2 className={styles.modalTitle} id="heartbeat-modal-title">Dispatch Node Heartbeat</h2>
            <form onSubmit={handleHeartbeat} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              <div className={styles.formField}>
                <label className={styles.formLabel} htmlFor="heartbeat-nodeid-input">Node Identifier *</label>
                <input
                  id="heartbeat-nodeid-input"
                  type="text"
                  required
                  className={styles.input}
                  placeholder="e.g. node-us-east-worker-01"
                  value={nodeId}
                  onChange={(e) => setNodeId(e.target.value)}
                />
              </div>

              <div className={styles.formField}>
                <label className={styles.formLabel} htmlFor="heartbeat-region-select">Cluster Region</label>
                <select
                  id="heartbeat-region-select"
                  className={styles.select}
                  value={clusterRegion}
                  onChange={(e) => setClusterRegion(e.target.value)}
                >
                  <option value="us-east-1">us-east-1 (N. Virginia)</option>
                  <option value="us-west-2">us-west-2 (Oregon)</option>
                  <option value="eu-central-1">eu-central-1 (Frankfurt)</option>
                  <option value="ap-southeast-1">ap-southeast-1 (Singapore)</option>
                </select>
              </div>

              <div className={styles.formField}>
                <label className={styles.formLabel} htmlFor="heartbeat-status-select">Status</label>
                <select
                  id="heartbeat-status-select"
                  className={styles.select}
                  value={nodeStatus}
                  onChange={(e) => setNodeStatus(e.target.value as 'healthy' | 'degraded' | 'draining' | 'offline')}
                >
                  <option value="healthy">Healthy</option>
                  <option value="degraded">Degraded</option>
                  <option value="draining">Draining</option>
                  <option value="offline">Offline</option>
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)' }}>
                <div className={styles.formField}>
                  <label className={styles.formLabel} htmlFor="heartbeat-cpu-input">CPU Usage (%)</label>
                  <input
                    id="heartbeat-cpu-input"
                    type="number"
                    min={0}
                    max={100}
                    className={styles.input}
                    value={cpuUsage}
                    onChange={(e) => setCpuUsage(Number(e.target.value))}
                  />
                </div>
                <div className={styles.formField}>
                  <label className={styles.formLabel} htmlFor="heartbeat-mem-input">Memory Usage (%)</label>
                  <input
                    id="heartbeat-mem-input"
                    type="number"
                    min={0}
                    max={100}
                    className={styles.input}
                    value={memUsage}
                    onChange={(e) => setMemUsage(Number(e.target.value))}
                  />
                </div>
              </div>

              <div className={styles.modalActions}>
                <button type="button" className={styles.btnSecondary} onClick={() => setIsSendingHeartbeat(false)} disabled={isSubmitting}>
                  Cancel
                </button>
                <button type="submit" className={styles.btnPrimary} disabled={isSubmitting}>
                  {isSubmitting ? 'Recording...' : 'Send Heartbeat'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
