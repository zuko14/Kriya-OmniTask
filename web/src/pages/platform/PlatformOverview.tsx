import { apiFetch } from '../../lib/apiClient';
import { useAsync } from '../../lib/useAsync';
import { KpiCard } from '../../components/KpiCard';
import { AsyncState } from '../../components/AsyncState';
import styles from './PlatformOverview.module.css';

interface Tenant {
  id: string;
  name: string;
  slug: string;
  status: string;
  plan_tier: string;
}

interface FleetDiagnostics {
  totalNodes: number;
  onlineNodes: number;
  degradedNodes: number;
  offlineNodes: number;
  clusterHealth: 'healthy' | 'degraded' | 'critical';
}

interface MaintenanceState {
  isMaintenanceActive: boolean;
  maintenanceMessage?: string;
}

function fetchTenants() {
  return apiFetch<{ tenants: Tenant[]; count: number }>('/api/v1/admin/tenants');
}

function fetchFleetDiagnostics() {
  return apiFetch<FleetDiagnostics>('/api/v1/admin/fleet/diagnostics');
}

function fetchMaintenanceState() {
  return apiFetch<MaintenanceState>('/api/v1/admin/maintenance');
}

export function PlatformOverview() {
  const tenants = useAsync(fetchTenants, []);
  const fleet = useAsync(fetchFleetDiagnostics, []);
  const maintenance = useAsync(fetchMaintenanceState, []);

  return (
    <div>
      <h1 style={{ marginBottom: 'var(--space-5)' }}>Platform Overview</h1>

      {maintenance.status === 'success' && maintenance.data.isMaintenanceActive && (
        <div className={styles.banner}>Maintenance mode active{maintenance.data.maintenanceMessage ? `: ${maintenance.data.maintenanceMessage}` : ''}</div>
      )}

      <div className={styles.grid}>
        <KpiCard title="Tenants" value={tenants.status === 'success' ? String(tenants.data.count) : undefined}>
          {tenants.status !== 'success' && (
            <AsyncState status={tenants.status === 'loading' ? 'loading' : 'error'} error={tenants.error} />
          )}
          {tenants.status === 'success' && tenants.data.tenants.length === 0 && (
            <AsyncState status="empty" emptyMessage="No tenants provisioned yet." />
          )}
          {tenants.status === 'success' && tenants.data.tenants.length > 0 && (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Status</th>
                  <th>Plan</th>
                </tr>
              </thead>
              <tbody>
                {tenants.data.tenants.slice(0, 8).map((t) => (
                  <tr key={t.id}>
                    <td>{t.name}</td>
                    <td>{t.status}</td>
                    <td>{t.plan_tier}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </KpiCard>

        <KpiCard title="Fleet Health" value={fleet.status === 'success' ? fleet.data.clusterHealth : undefined}>
          {fleet.status !== 'success' && <AsyncState status={fleet.status === 'loading' ? 'loading' : 'error'} error={fleet.error} />}
          {fleet.status === 'success' && (
            <div>
              {fleet.data.onlineNodes}/{fleet.data.totalNodes} nodes online
              {fleet.data.degradedNodes > 0 && ` · ${fleet.data.degradedNodes} degraded`}
              {fleet.data.offlineNodes > 0 && ` · ${fleet.data.offlineNodes} offline`}
            </div>
          )}
        </KpiCard>
      </div>
    </div>
  );
}
