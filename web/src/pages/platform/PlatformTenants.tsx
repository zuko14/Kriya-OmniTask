import { useState, useCallback } from 'react';
import { apiFetch, ApiError } from '../../lib/apiClient';
import { useAsync } from '../../lib/useAsync';
import { DataTable, Column } from '../../components/DataTable';
import { AsyncState } from '../../components/AsyncState';
import styles from './PlatformTenants.module.css';

export interface AdminTenantRecord {
  id: string;
  name: string;
  slug: string;
  status: 'active' | 'suspended' | 'pending_deletion' | 'trial';
  plan_tier: string;
  channel_plan: string;
  created_at: string;
  updated_at: string;
}

export function PlatformTenants() {
  const [refreshTrigger, setRefreshTrigger] = useState<number>(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Status Filter
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  // Provision Modal
  const [isProvisioning, setIsProvisioning] = useState<boolean>(false);
  const [tenantName, setTenantName] = useState<string>('');
  const [tenantSlug, setTenantSlug] = useState<string>('');
  const [adminEmail, setAdminEmail] = useState<string>('');
  const [planTier, setPlanTier] = useState<'starter' | 'growth' | 'enterprise'>('growth');
  const [channelPlan, setChannelPlan] = useState<'single_channel' | 'dual_channel' | 'omnichannel' | 'combined'>('combined');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Status Modal
  const [targetTenant, setTargetTenant] = useState<AdminTenantRecord | null>(null);
  const [newStatus, setNewStatus] = useState<'active' | 'suspended' | 'pending_deletion' | 'trial'>('suspended');
  const [statusReason, setStatusReason] = useState<string>('');
  const [isUpdatingStatus, setIsUpdatingStatus] = useState<boolean>(false);

  const fetchTenants = useCallback(() => {
    return apiFetch<{ tenants: AdminTenantRecord[]; count: number }>('/api/v1/admin/tenants');
  }, [refreshTrigger]);

  const tenantsState = useAsync(fetchTenants, [fetchTenants]);

  const handleProvision = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsSubmitting(true);
      setActionError(null);
      const generatedId = `tenant_${tenantSlug.toLowerCase().replace(/[^a-z0-9]/g, '_')}_${Date.now().toString(36)}`;
      await apiFetch('/api/v1/admin/tenants/provision', {
        method: 'POST',
        body: JSON.stringify({
          id: generatedId,
          name: tenantName,
          slug: tenantSlug,
          planTier,
          channelPlan,
          adminEmail,
          maxAgents: 10,
          maxWorkflows: 50,
        }),
      });
      setActionSuccess(`Tenant '${tenantName}' (${tenantSlug}) provisioned successfully.`);
      setIsProvisioning(false);
      setTenantName('');
      setTenantSlug('');
      setAdminEmail('');
      setRefreshTrigger((prev) => prev + 1);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Failed to provision tenant');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateStatus = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetTenant) return;
    try {
      setIsUpdatingStatus(true);
      setActionError(null);
      await apiFetch(`/api/v1/admin/tenants/${targetTenant.id}/status`, {
        method: 'PUT',
        body: JSON.stringify({
          status: newStatus,
          reason: statusReason || `Platform operator status change to ${newStatus}`,
        }),
      });
      setActionSuccess(`Tenant '${targetTenant.name}' status updated to '${newStatus}'.`);
      setTargetTenant(null);
      setStatusReason('');
      setRefreshTrigger((prev) => prev + 1);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Failed to update tenant status');
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const allTenants = tenantsState.status === 'success' ? tenantsState.data.tenants : [];
  const filteredTenants = allTenants.filter((t) => (statusFilter === 'ALL' ? true : t.status === statusFilter));

  const columns: Column<AdminTenantRecord>[] = [
    {
      key: 'name',
      header: 'Tenant Name',
      render: (t) => (
        <div>
          <strong>{t.name}</strong>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--color-ink-muted)' }}>{t.id}</div>
        </div>
      ),
    },
    {
      key: 'slug',
      header: 'Slug',
      render: (t) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px' }}>{t.slug}</span>,
    },
    {
      key: 'plan_tier',
      header: 'Plan Tier',
      render: (t) => (
        <span style={{ textTransform: 'capitalize', fontSize: '12px' }}>
          {t.plan_tier} ({t.channel_plan?.replace('_', ' ')})
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: '120px',
      render: (t) => {
        let badgeClass = styles.badgeActive;
        if (t.status === 'suspended' || t.status === 'pending_deletion') badgeClass = styles.badgeSuspended;
        if (t.status === 'trial') badgeClass = styles.badgeTrial;
        return <span className={`${styles.badge} ${badgeClass}`}>{t.status}</span>;
      },
    },
    {
      key: 'created_at',
      header: 'Created',
      width: '130px',
      render: (t) => <span style={{ fontSize: '11px', color: 'var(--color-ink-muted)' }}>{new Date(t.created_at).toLocaleDateString()}</span>,
    },
    {
      key: 'actions',
      header: 'Lifecycle Actions',
      width: '170px',
      render: (t) => (
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          {t.status === 'active' ? (
            <button
              className={styles.btnDanger}
              onClick={() => {
                setTargetTenant(t);
                setNewStatus('suspended');
              }}
            >
              Suspend
            </button>
          ) : (
            <button
              className={styles.btnSecondary}
              onClick={() => {
                setTargetTenant(t);
                setNewStatus('active');
              }}
            >
              Reactivate
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.titleGroup}>
          <h1>Platform Tenant Registry & Lifecycle</h1>
          <p className={styles.subtitle}>Cross-tenant organization fleet provisioning, quota limits, and lifecycle suspension controls.</p>
        </div>
        <div className={styles.headerActions}>
          <button className={styles.btnPrimary} onClick={() => setIsProvisioning(true)}>
            + Provision New Tenant
          </button>
        </div>
      </header>

      {/* Operator RBAC Transparency Notice */}
      <div className={styles.noticeBanner}>
        <span>ℹ️</span>
        <div>
          <strong>Platform Operator Control Plane:</strong> Cross-tenant actions are executed via <code>system:admin</code> credentials.
          All lifecycle state transitions are logged to the immutable operator audit ledger.
        </div>
      </div>

      {actionError && <div style={{ color: 'var(--color-critical)', background: 'rgba(216,87,75,0.1)', padding: 'var(--space-3)', borderRadius: 'var(--radius-sm)' }}>⚠️ {actionError}</div>}
      {actionSuccess && <div style={{ color: 'var(--color-verify)', background: 'rgba(63,166,107,0.1)', padding: 'var(--space-3)', borderRadius: 'var(--radius-sm)' }}>✓ {actionSuccess}</div>}

      <div className={styles.sectionCard}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
          <h2 className={styles.sectionTitle}>Registered Tenants ({filteredTenants.length} of {allTenants.length})</h2>
          <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
            <label htmlFor="tenant-status-filter" style={{ fontSize: '12px', color: 'var(--color-ink-muted)' }}>Status:</label>
            <select
              id="tenant-status-filter"
              className={styles.select}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="ALL">All Statuses</option>
              <option value="active">Active</option>
              <option value="trial">Trial</option>
              <option value="suspended">Suspended</option>
              <option value="pending_deletion">Pending Deletion</option>
            </select>
          </div>
        </div>

        {tenantsState.status !== 'success' ? (
          <AsyncState status={tenantsState.status === 'loading' ? 'loading' : 'error'} error={tenantsState.error} />
        ) : (
          <DataTable
            columns={columns}
            data={filteredTenants}
            keyExtractor={(t) => t.id}
            emptyMessage="No tenants matching the selected filter."
            ariaLabel="Platform tenants registry table"
          />
        )}
      </div>

      {/* Provision Tenant Modal */}
      {isProvisioning && (
        <div className={styles.modalBackdrop} role="dialog" aria-modal="true" aria-labelledby="provision-modal-title">
          <div className={styles.modal}>
            <h2 className={styles.modalTitle} id="provision-modal-title">Provision New Organization Tenant</h2>
            <form onSubmit={handleProvision} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              <div className={styles.formGrid}>
                <div className={styles.formField}>
                  <label className={styles.formLabel} htmlFor="provision-name-input">Organization Name *</label>
                  <input
                    id="provision-name-input"
                    type="text"
                    required
                    className={styles.input}
                    placeholder="e.g. Acme Corp"
                    value={tenantName}
                    onChange={(e) => {
                      setTenantName(e.target.value);
                      if (!tenantSlug) {
                        setTenantSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, '-'));
                      }
                    }}
                  />
                </div>

                <div className={styles.formField}>
                  <label className={styles.formLabel} htmlFor="provision-slug-input">Tenant Slug *</label>
                  <input
                    id="provision-slug-input"
                    type="text"
                    required
                    className={styles.input}
                    placeholder="acme-corp"
                    value={tenantSlug}
                    onChange={(e) => setTenantSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                  />
                </div>
              </div>

              <div className={styles.formField}>
                <label className={styles.formLabel} htmlFor="provision-email-input">Admin Contact Email *</label>
                <input
                  id="provision-email-input"
                  type="email"
                  required
                  className={styles.input}
                  placeholder="admin@acme.com"
                  value={adminEmail}
                  onChange={(e) => setAdminEmail(e.target.value)}
                />
              </div>

              <div className={styles.formGrid}>
                <div className={styles.formField}>
                  <label className={styles.formLabel} htmlFor="provision-plan-select">Plan Tier</label>
                  <select
                    id="provision-plan-select"
                    className={styles.select}
                    value={planTier}
                    onChange={(e) => setPlanTier(e.target.value as 'starter' | 'growth' | 'enterprise')}
                  >
                    <option value="starter">Starter</option>
                    <option value="growth">Growth</option>
                    <option value="enterprise">Enterprise</option>
                  </select>
                </div>

                <div className={styles.formField}>
                  <label className={styles.formLabel} htmlFor="provision-channel-select">Channel Package</label>
                  <select
                    id="provision-channel-select"
                    className={styles.select}
                    value={channelPlan}
                    onChange={(e) => setChannelPlan(e.target.value as 'single_channel' | 'dual_channel' | 'omnichannel' | 'combined')}
                  >
                    <option value="combined">Combined (Web + WhatsApp + Voice)</option>
                    <option value="omnichannel">Omnichannel</option>
                    <option value="dual_channel">Dual Channel</option>
                    <option value="single_channel">Single Channel</option>
                  </select>
                </div>
              </div>

              <div className={styles.modalActions}>
                <button type="button" className={styles.btnSecondary} onClick={() => setIsProvisioning(false)} disabled={isSubmitting}>
                  Cancel
                </button>
                <button type="submit" className={styles.btnPrimary} disabled={isSubmitting}>
                  {isSubmitting ? 'Provisioning...' : 'Provision Tenant'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Update Status Modal */}
      {targetTenant && (
        <div className={styles.modalBackdrop} role="dialog" aria-modal="true" aria-labelledby="status-modal-title">
          <div className={styles.modal}>
            <h2 className={styles.modalTitle} id="status-modal-title">Update Tenant Status: {targetTenant.name}</h2>
            <form onSubmit={handleUpdateStatus} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              <div className={styles.formField}>
                <label className={styles.formLabel} htmlFor="status-select">Target Lifecycle Status</label>
                <select
                  id="status-select"
                  className={styles.select}
                  value={newStatus}
                  onChange={(e) => setNewStatus(e.target.value as 'active' | 'suspended' | 'pending_deletion' | 'trial')}
                >
                  <option value="active">Active (Permits workforce execution)</option>
                  <option value="suspended">Suspended (Blocks agent & workflow runs)</option>
                  <option value="trial">Trial (Quota throttled)</option>
                  <option value="pending_deletion">Pending Deletion (Scheduled purge)</option>
                </select>
              </div>

              <div className={styles.formField}>
                <label className={styles.formLabel} htmlFor="status-reason-input">Operator Audit Reason *</label>
                <input
                  id="status-reason-input"
                  type="text"
                  required
                  className={styles.input}
                  placeholder="e.g. Non-payment, violation of ToS, customer request"
                  value={statusReason}
                  onChange={(e) => setStatusReason(e.target.value)}
                />
              </div>

              <div className={styles.modalActions}>
                <button type="button" className={styles.btnSecondary} onClick={() => setTargetTenant(null)} disabled={isUpdatingStatus}>
                  Cancel
                </button>
                <button type="submit" className={newStatus === 'suspended' ? styles.btnDanger : styles.btnPrimary} disabled={isUpdatingStatus}>
                  {isUpdatingStatus ? 'Updating...' : `Confirm ${newStatus.toUpperCase()}`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
