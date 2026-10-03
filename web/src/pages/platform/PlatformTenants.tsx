import { useState, useCallback } from 'react';
import { apiFetch, ApiError } from '../../lib/apiClient';
import { useAsync } from '../../lib/useAsync';
import { AsyncState } from '../../components/AsyncState';
import {
  Panel,
  SignalBadge,
  StateDot,
  SignalState,
  ConfirmDialog,
} from '../../components/primitives';
import { ProvisionTenantModal } from './ProvisionTenantModal';
import { ElevationModal } from './ElevationModal';
import { Icon } from '../../components/brand/Icon';

export interface OrganizationRosterItem {
  id: string;
  name: string;
  slug: string;
  status: 'active' | 'suspended' | 'degraded' | 'disabled';
  planTier: string;
  channelPlan: 'whatsapp_only' | 'voice_only' | 'combined';
  brainSupplyMode: 'byo' | 'managed';
  agentCount: number;
  executions24h: number;
  errorRatePct: number;
  spendInr: number;
  quotaBudgetInr: number;
  spendRatioPct: number;
  attentionCount: number;
  activeElevation?: {
    operatorId: string;
    operatorName?: string;
    reason: string;
    expiresAt: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export function PlatformTenants() {
  const [refreshTrigger, setRefreshTrigger] = useState<number>(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Modals
  const [isProvisionOpen, setIsProvisionOpen] = useState(false);
  const [elevateTenant, setElevateTenant] = useState<{ id: string; name: string } | null>(null);
  const [suspendTarget, setSuspendTarget] = useState<OrganizationRosterItem | null>(null);

  // Filter & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  const fetchRoster = useCallback(() => {
    return apiFetch<{ organizations: OrganizationRosterItem[]; count: number }>(
      '/api/v1/admin/organizations/roster'
    );
  }, []);

  const rosterState = useAsync(fetchRoster, [refreshTrigger]);

  const handleToggleSuspend = async () => {
    if (!suspendTarget) return;
    try {
      setActionError(null);
      const nextStatus = suspendTarget.status === 'suspended' ? 'active' : 'suspended';
      await apiFetch(`/api/v1/admin/tenants/${suspendTarget.id}/status`, {
        method: 'PUT',
        body: JSON.stringify({
          status: nextStatus,
          reason: `Operator toggled lifecycle status to ${nextStatus}`,
        }),
      });
      setActionSuccess(`Tenant '${suspendTarget.name}' status updated to '${nextStatus}'.`);
      setSuspendTarget(null);
      setRefreshTrigger((p) => p + 1);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Failed to update tenant status.');
    }
  };

  const handleElevatedSession = (data: { token: string; tenant: any }) => {
    setActionSuccess(`Successfully elevated into tenant '${data.tenant?.name}'. Elevation banner is active.`);
    if (data.token) {
      sessionStorage.setItem('kriya_elevated_token', data.token);
    }
    setRefreshTrigger((p) => p + 1);
  };

  const organizations = rosterState.data?.organizations || [];

  const filteredOrgs = organizations.filter((org) => {
    const matchesSearch =
      org.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      org.slug.toLowerCase().includes(searchQuery.toLowerCase()) ||
      org.id.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus =
      statusFilter === 'ALL' ||
      (statusFilter === 'DEGRADED' && org.status === 'degraded') ||
      (statusFilter === 'SUSPENDED' && org.status === 'suspended') ||
      (statusFilter === 'LIVE' && org.status === 'active');
    return matchesSearch && matchesStatus;
  });

  const degradedCount = organizations.filter((o) => o.status === 'degraded').length;
  const suspendedCount = organizations.filter((o) => o.status === 'suspended').length;
  const liveCount = organizations.filter((o) => o.status === 'active').length;

  return (
    <div style={{ maxWidth: 'var(--main-max)', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      {/* Screen Header */}
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: 'var(--border-width) solid var(--border)', paddingBottom: 'var(--space-4)' }}>
        <div>
          <div className="eyebrow">Owner Console · Platform Tenant Management (§2, §17.1)</div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-3xl)', fontWeight: 700, margin: 'var(--space-1) 0' }}>
            Organizations Roster
          </h1>
          <p style={{ color: 'var(--text2)', fontSize: 'var(--text-sm)', margin: 0 }}>
            Platform roster sorted worst-first. Every tenant workspace is provisioned and governed exclusively by platform operators.
          </p>
        </div>

        <button
          onClick={() => setIsProvisionOpen(true)}
          data-testid="provision-tenant-btn"
          aria-label="Provision New Tenant Organization"
          style={{
            background: 'var(--surface2)',
            border: 'var(--border-width) solid var(--border2)',
            color: 'var(--text)',
            padding: 'var(--space-2) var(--space-4)',
            borderRadius: 'var(--radius-md)',
            fontSize: 'var(--text-sm)',
            fontWeight: 600,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
          }}
        >
          <span>+</span>
          <span>Provision Tenant</span>
        </button>
      </header>

      {actionSuccess && (
        <div
          style={{
            background: 'var(--green-bg)',
            border: 'var(--border-width) solid var(--green)',
            color: 'var(--green)',
            padding: 'var(--space-2) var(--space-4)',
            borderRadius: 'var(--radius-sm)',
            fontSize: 'var(--text-sm)',
            display: 'flex',
            justifyContent: 'space-between',
          }}
        >
          <span>{actionSuccess}</span>
          <button onClick={() => setActionSuccess(null)} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }} aria-label="Dismiss">
            <Icon name="close" />
          </button>
        </div>
      )}

      {actionError && (
        <div
          style={{
            background: 'var(--red-bg)',
            border: 'var(--border-width) solid var(--red)',
            color: 'var(--red)',
            padding: 'var(--space-2) var(--space-4)',
            borderRadius: 'var(--radius-sm)',
            fontSize: 'var(--text-sm)',
            display: 'flex',
            justifyContent: 'space-between',
          }}
        >
          <span>{actionError}</span>
          <button onClick={() => setActionError(null)} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }} aria-label="Dismiss">
            <Icon name="close" />
          </button>
        </div>
      )}

      {/* Metric Strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--space-4)' }}>
        <div style={{ background: 'var(--surface)', border: 'var(--border-width) solid var(--border)', padding: 'var(--space-4)', borderRadius: 'var(--radius-md)' }}>
          <div className="eyebrow">Total Organizations</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-3xl)', fontWeight: 700, color: 'var(--text)', margin: 'var(--space-1) 0' }}>
            {organizations.length}
          </div>
          <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text3)' }}>Owner-provisioned</div>
        </div>

        <div style={{ background: 'var(--surface)', border: 'var(--border-width) solid var(--border)', padding: 'var(--space-4)', borderRadius: 'var(--radius-md)' }}>
          <div className="eyebrow">Degraded / Attention</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-3xl)', fontWeight: 700, color: degradedCount > 0 ? 'var(--amber)' : 'var(--green)', margin: 'var(--space-1) 0' }}>
            {degradedCount}
          </div>
          <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text3)' }}>Top of queue (worst first)</div>
        </div>

        <div style={{ background: 'var(--surface)', border: 'var(--border-width) solid var(--border)', padding: 'var(--space-4)', borderRadius: 'var(--radius-md)' }}>
          <div className="eyebrow">Suspended Tenants</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-3xl)', fontWeight: 700, color: suspendedCount > 0 ? 'var(--text3)' : 'var(--text)', margin: 'var(--space-1) 0' }}>
            {suspendedCount}
          </div>
          <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text3)' }}>Execution halted · Data retained</div>
        </div>

        <div style={{ background: 'var(--surface)', border: 'var(--border-width) solid var(--border)', padding: 'var(--space-4)', borderRadius: 'var(--radius-md)' }}>
          <div className="eyebrow">Healthy Live Tenants</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-3xl)', fontWeight: 700, color: 'var(--green)', margin: 'var(--space-1) 0' }}>
            {liveCount}
          </div>
          <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text3)' }}>Normal workforce autonomy</div>
        </div>
      </div>

      {/* Roster Table Panel */}
      <Panel title="Platform Roster" eyebrow="Live Tenant Fleet">
        {/* Controls */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)', gap: 'var(--space-3)' }}>
          <input
            type="search"
            aria-label="Filter organizations"
          placeholder="Filter organizations by name, slug, or ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              flex: 1,
              maxWidth: '400px',
              background: 'var(--surface3)',
              border: 'var(--border-width) solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              padding: 'var(--space-2) var(--space-3)',
              color: 'var(--text)',
              fontSize: 'var(--text-sm)',
            }}
          />

          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            {(['ALL', 'DEGRADED', 'LIVE', 'SUSPENDED'] as const).map((filter) => (
              <button
                key={filter}
                onClick={() => setStatusFilter(filter)}
                style={{
                  background: statusFilter === filter ? 'var(--surface2)' : 'var(--surface3)',
                  border: `var(--border-width) solid ${statusFilter === filter ? 'var(--border2)' : 'var(--border)'}`,
                  color: statusFilter === filter ? 'var(--text)' : 'var(--text3)',
                  padding: 'var(--space-1) var(--space-3)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 'var(--text-xs)',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {filter}
              </button>
            ))}
          </div>
        </div>

        {rosterState.status === 'loading' && <AsyncState status="loading" />}
        {rosterState.status === 'error' && <AsyncState status="error" error={rosterState.error} />}

        {rosterState.status === 'success' && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-sm)', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: 'var(--border-width) solid var(--border)', color: 'var(--text3)' }}>
                  <th style={{ padding: 'var(--space-2) var(--space-3)', fontWeight: 600, fontSize: 'var(--text-2xs)', textTransform: 'uppercase' }}>ORGANIZATION</th>
                  <th style={{ padding: 'var(--space-2) var(--space-3)', fontWeight: 600, fontSize: 'var(--text-2xs)', textTransform: 'uppercase' }}>STATE</th>
                  <th style={{ padding: 'var(--space-2) var(--space-3)', fontWeight: 600, fontSize: 'var(--text-2xs)', textTransform: 'uppercase', textAlign: 'right' }}>AGENTS</th>
                  <th style={{ padding: 'var(--space-2) var(--space-3)', fontWeight: 600, fontSize: 'var(--text-2xs)', textTransform: 'uppercase', textAlign: 'right' }}>24H EXEC</th>
                  <th style={{ padding: 'var(--space-2) var(--space-3)', fontWeight: 600, fontSize: 'var(--text-2xs)', textTransform: 'uppercase', textAlign: 'right' }}>ERR%</th>
                  <th style={{ padding: 'var(--space-2) var(--space-3)', fontWeight: 600, fontSize: 'var(--text-2xs)', textTransform: 'uppercase' }}>SPEND/QUOTA</th>
                  <th style={{ padding: 'var(--space-2) var(--space-3)', fontWeight: 600, fontSize: 'var(--text-2xs)', textTransform: 'uppercase', textAlign: 'center' }}>ATTENTION</th>
                  <th style={{ padding: 'var(--space-2) var(--space-3)', fontWeight: 600, fontSize: 'var(--text-2xs)', textTransform: 'uppercase' }}>PLAN</th>
                  <th style={{ padding: 'var(--space-2) var(--space-3)', fontWeight: 600, fontSize: 'var(--text-2xs)', textTransform: 'uppercase', textAlign: 'right' }}>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {filteredOrgs.map((org) => {
                  const stateSignal: SignalState =
                    org.status === 'suspended'
                      ? 'idle'
                      : org.status === 'degraded'
                        ? 'attention'
                        : org.status === 'active'
                          ? 'live'
                          : 'halt';

                  const stateLabel =
                    org.status === 'suspended'
                      ? 'suspended'
                      : org.status === 'degraded'
                        ? 'degraded'
                        : org.status === 'active'
                          ? 'live'
                          : 'disabled';

                  return (
                    <tr
                      key={org.id}
                      style={{
                        borderBottom: 'var(--border-width) solid var(--border)',
                        height: 'var(--row-height)',
                        background: org.activeElevation ? 'var(--amber-bg)' : 'transparent',
                      }}
                    >
                      <td style={{ padding: 'var(--space-2) var(--space-3)' }}>
                        <div style={{ fontWeight: 600, color: 'var(--text)' }}>{org.name}</div>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-2xs)', color: 'var(--text3)' }}>
                          {org.slug}
                        </div>
                      </td>

                      <td style={{ padding: 'var(--space-2) var(--space-3)' }}>
                        <SignalBadge state={stateSignal} label={stateLabel} size="sm" />
                      </td>

                      <td style={{ padding: 'var(--space-2) var(--space-3)', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                        {org.status === 'suspended' ? '0' : org.agentCount}
                      </td>

                      <td style={{ padding: 'var(--space-2) var(--space-3)', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                        {org.executions24h.toLocaleString()}
                      </td>

                      <td style={{ padding: 'var(--space-2) var(--space-3)', textAlign: 'right', fontFamily: 'var(--font-mono)', color: org.errorRatePct > 5.0 ? 'var(--red)' : 'var(--text)' }}>
                        {org.status === 'suspended' ? '—' : `${org.errorRatePct.toFixed(1)}%`}
                      </td>

                      <td style={{ padding: 'var(--space-2) var(--space-3)', minWidth: '160px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-mono)', marginBottom: '2px' }}>
                          <span>₹{org.spendInr}</span>
                          <span style={{ color: 'var(--text3)' }}>{org.spendRatioPct}%</span>
                        </div>
                        <div style={{ width: '100%', height: '4px', background: 'var(--surface3)', borderRadius: '2px', overflow: 'hidden' }}>
                          <div
                            style={{
                              width: `${Math.min(org.spendRatioPct, 100)}%`,
                              height: '100%',
                              backgroundColor: org.spendRatioPct > 90 ? 'var(--red)' : 'var(--green)',
                            }}
                          />
                        </div>
                      </td>

                      <td style={{ padding: 'var(--space-2) var(--space-3)', textAlign: 'center' }}>
                        {org.attentionCount > 0 ? (
                          <span
                            style={{
                              fontFamily: 'var(--font-mono)',
                              fontSize: 'var(--text-xs)',
                              color: 'var(--amber)',
                              fontWeight: 600,
                            }}
                          >
                            <Icon name="alert" label="Attention items" /> {org.attentionCount}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--text3)', fontSize: 'var(--text-xs)' }}>—</span>
                        )}
                      </td>

                      <td style={{ padding: 'var(--space-2) var(--space-3)' }}>
                        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text2)' }}>
                          {org.channelPlan === 'combined'
                            ? 'Combined'
                            : org.channelPlan === 'voice_only'
                              ? 'Voice'
                              : 'WhatsApp'}
                        </span>
                      </td>

                      <td style={{ padding: 'var(--space-2) var(--space-3)', textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', gap: 'var(--space-2)' }}>
                          <button
                            onClick={() => setElevateTenant({ id: org.id, name: org.name })}
                            style={{
                              background: 'none',
                              border: 'var(--border-width) solid var(--amber)',
                              color: 'var(--amber)',
                              borderRadius: 'var(--radius-sm)',
                              padding: '2px var(--space-2)',
                              fontSize: 'var(--text-2xs)',
                              fontWeight: 600,
                              cursor: 'pointer',
                            }}
                            title="Temporary operator elevation with audit trail"
                          >
                            Elevate
                          </button>

                          <button
                            onClick={() => setSuspendTarget(org)}
                            style={{
                              background: 'none',
                              border: 'var(--border-width) solid var(--border)',
                              color: org.status === 'suspended' ? 'var(--green)' : 'var(--red)',
                              borderRadius: 'var(--radius-sm)',
                              padding: '2px var(--space-2)',
                              fontSize: 'var(--text-2xs)',
                              cursor: 'pointer',
                            }}
                          >
                            {org.status === 'suspended' ? 'Reactivate' : 'Suspend'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* Provisioning Guided Flow Modal */}
      <ProvisionTenantModal
        isOpen={isProvisionOpen}
        onClose={() => setIsProvisionOpen(false)}
        onSuccess={(tenantName) => {
          setActionSuccess(`Tenant '${tenantName}' provisioned and audit entry committed.`);
          setRefreshTrigger((p) => p + 1);
        }}
      />

      {/* Elevation Modal */}
      <ElevationModal
        isOpen={Boolean(elevateTenant)}
        tenant={elevateTenant}
        onClose={() => setElevateTenant(null)}
        onElevated={handleElevatedSession}
      />

      {/* Suspend Confirmation Dialog */}
      <ConfirmDialog
        isOpen={Boolean(suspendTarget)}
        isHighRisk={suspendTarget?.status !== 'suspended'}
        title={suspendTarget?.status === 'suspended' ? 'Reactivate Tenant' : 'Suspend Tenant Execution'}
        actionName={`tenant:${suspendTarget?.status === 'suspended' ? 'reactivate' : 'suspend'}`}
        consequence={
          suspendTarget?.status === 'suspended'
            ? `Workforce autonomous execution will resume for '${suspendTarget?.name}'.`
            : `All autonomous task executions for '${suspendTarget?.name}' will be immediately halted. All client data, conversations, and audit logs are safely preserved.`
        }
        confirmLabel={suspendTarget?.status === 'suspended' ? 'Reactivate Tenant' : 'Confirm Suspension'}
        onConfirm={handleToggleSuspend}
        onCancel={() => setSuspendTarget(null)}
      />
    </div>
  );
}
