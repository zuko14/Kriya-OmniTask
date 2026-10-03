import { useState, useCallback } from 'react';
import { useAuth } from '../../lib/authContext';
import { apiFetch, ApiError } from '../../lib/apiClient';
import { useAsync } from '../../lib/useAsync';
import { DataTable, Column } from '../../components/DataTable';
import { AsyncState } from '../../components/AsyncState';
import { useBusinessDna } from '../../lib/dnaContext';
import styles from './TenantSettings.module.css';

export interface TenantDetails {
  tenant: {
    id: string;
    name: string;
    slug: string;
    status: string;
    plan_tier: string;
    channel_plan: string;
    created_at: string;
  };
  configuration: Record<string, unknown>;
  limits: Record<string, number | unknown>;
}

export interface UserRecord {
  id: string;
  tenant_id: string;
  email: string;
  full_name: string;
  created_at: string;
}

export function TenantSettings() {
  const { auth } = useAuth();
  const { dna, vocabulary, capabilities, agents } = useBusinessDna();
  const tenantId = auth?.tenant?.id;

  const [refreshTrigger, setRefreshTrigger] = useState<number>(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Invite Modal
  const [isInviting, setIsInviting] = useState<boolean>(false);
  const [inviteEmail, setInviteEmail] = useState<string>('');
  const [inviteName, setInviteName] = useState<string>('');
  const [invitePassword, setInvitePassword] = useState<string>('');
  const [inviteRole, setInviteRole] = useState<string>('agent_operator');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const fetchTenantDetails = useCallback(() => {
    if (!tenantId) return Promise.resolve(null);
    return apiFetch<TenantDetails>(`/api/v1/tenants/${tenantId}`);
  }, [tenantId, refreshTrigger]);

  const fetchUsers = useCallback(() => {
    return apiFetch<{ users: UserRecord[] }>('/api/v1/users');
  }, [refreshTrigger]);

  const tenantState = useAsync(fetchTenantDetails, [fetchTenantDetails]);
  const usersState = useAsync(fetchUsers, [fetchUsers]);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsSubmitting(true);
      setActionError(null);
      await apiFetch('/api/v1/users/invite', {
        method: 'POST',
        body: JSON.stringify({
          email: inviteEmail,
          fullName: inviteName,
          temporaryPassword: invitePassword,
          role: inviteRole,
        }),
      });
      setActionSuccess(`Invited '${inviteEmail}' with role '${inviteRole}'.`);
      setIsInviting(false);
      setInviteEmail('');
      setInviteName('');
      setInvitePassword('');
      setRefreshTrigger((prev) => prev + 1);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Failed to invite user');
    } finally {
      setIsSubmitting(false);
    }
  };

  const tenant = tenantState.status === 'success' ? tenantState.data?.tenant : null;
  const limits = tenantState.status === 'success' ? tenantState.data?.limits || {} : {};
  const users = usersState.status === 'success' ? (usersState.data?.users ?? []) : [];

  const userColumns: Column<UserRecord>[] = [
    {
      key: 'full_name',
      header: 'Full Name',
      render: (u) => <strong>{u.full_name}</strong>,
    },
    {
      key: 'email',
      header: 'Email Address',
      render: (u) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px' }}>{u.email}</span>,
    },
    {
      key: 'created_at',
      header: 'Joined Date',
      width: '160px',
      render: (u) => <span style={{ fontSize: '11px', color: 'var(--text2)' }}>{new Date(u.created_at).toLocaleDateString()}</span>,
    },
  ];

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.titleGroup}>
          <h1>Organization & Workspace Settings</h1>
          <p className={styles.subtitle}>Tenant identity, plan quota limits, and workforce team access management.</p>
        </div>
        <div className={styles.headerActions}>
          <button className="btn btn-accent" onClick={() => setIsInviting(true)}>
            + Invite Team Member
          </button>
        </div>
      </header>

      {actionError && <div className="alert alert-err" role="alert">{actionError}</div>}
      {actionSuccess && <div className="alert alert-ok" role="status">{actionSuccess}</div>}

      {/* Tenant Profile Card */}
      <div className={styles.sectionCard}>
        <h2 className={styles.sectionTitle}>Tenant Profile & Plan Tier</h2>
        {tenantState.status !== 'success' ? (
          <AsyncState status={tenantState.status === 'loading' ? 'loading' : 'error'} error={tenantState.error} />
        ) : (
          <div className={styles.gridTwo}>
            <div className={styles.metaField}>
              <span className={styles.metaLabel}>Tenant Name</span>
              <span className={styles.metaValue}>{tenant?.name}</span>
            </div>
            <div className={styles.metaField}>
              <span className={styles.metaLabel}>Tenant Slug</span>
              <span className={styles.metaValue} style={{ fontFamily: 'var(--font-mono)' }}>{tenant?.slug}</span>
            </div>
            <div className={styles.metaField}>
              <span className={styles.metaLabel}>Plan Tier</span>
              <span className={styles.metaValue} style={{ textTransform: 'capitalize' }}>
                {tenant?.plan_tier} Tier ({tenant?.channel_plan?.replace('_', ' ')})
              </span>
            </div>
            <div className={styles.metaField}>
              <span className={styles.metaLabel}>Tenant Status</span>
              <span className={`${styles.badge} ${styles.badgeActive}`}>{tenant?.status}</span>
            </div>
          </div>
        )}
      </div>

      {/* Business DNA & Active Roster Manifest (§3, §4) */}
      <div className={styles.sectionCard}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
          <h2 className={styles.sectionTitle} style={{ margin: 0 }}>Business DNA & Active Roster Manifest</h2>
          {dna?.activeManifest && (
            <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', padding: '2px 8px', borderRadius: 'var(--radius-sm)', background: 'var(--surface3)', color: 'var(--text2)' }}>
              Manifest v{dna.activeManifest.version} · SHA-256: {dna.activeManifest.checksum?.slice(0, 10)}…
            </span>
          )}
        </div>
        <div className={styles.gridTwo}>
          <div className={styles.metaField}>
            <span className={styles.metaLabel}>Active DNA Profile</span>
            <span className={styles.metaValue}>{dna?.dnaProfile?.display_name || 'Retail & Digital Commerce'}</span>
          </div>
          <div className={styles.metaField}>
            <span className={styles.metaLabel}>Business Type</span>
            <span className={styles.metaValue} style={{ fontFamily: 'var(--font-mono)' }}>{dna?.dnaProfile?.business_type || 'retail_commerce'}</span>
          </div>
          <div className={styles.metaField}>
            <span className={styles.metaLabel}>Entity Vocabulary</span>
            <span className={styles.metaValue} style={{ fontSize: '12px' }}>
              {vocabulary.customer} / {vocabulary.customer_plural} · {vocabulary.item} / {vocabulary.item_plural} · {vocabulary.transaction}
            </span>
          </div>
          <div className={styles.metaField}>
            <span className={styles.metaLabel}>Moulded Workforce</span>
            <span className={styles.metaValue} style={{ fontSize: '12px' }}>
              {agents.filter((a) => a.is_active).length} Active Agents ({agents.map((a) => a.name).join(', ')})
            </span>
          </div>
        </div>
        <div style={{ marginTop: 'var(--space-3)' }}>
          <span className={styles.metaLabel}>Active DNA Capabilities</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', marginTop: 'var(--space-1)' }}>
            {capabilities.map((cap) => (
              <span key={cap} style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', padding: '2px 6px', borderRadius: 'var(--radius-sm)', background: 'rgba(56,128,255,0.08)', color: 'var(--text)' }}>
                {cap}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Plan Quotas & Effective Limits Card */}
      <div className={styles.sectionCard}>
        <h2 className={styles.sectionTitle}>Effective Quotas & Security Guardrails</h2>
        <div className={styles.gridTwo}>
          {Object.entries(limits).map(([key, val]) => (
            <div key={key} className={styles.metaField}>
              <span className={styles.metaLabel}>{key.replace(/([A-Z])/g, ' $1')}</span>
              <span className={styles.metaValue} style={{ fontFamily: 'var(--font-mono)' }}>
                {typeof val === 'object' ? JSON.stringify(val) : String(val)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Team Members Directory */}
      <div className={styles.sectionCard}>
        <h2 className={styles.sectionTitle}>Workforce Team Members ({users.length})</h2>
        {usersState.status !== 'success' ? (
          <AsyncState status={usersState.status === 'loading' ? 'loading' : 'error'} error={usersState.error} />
        ) : (
          <DataTable
            columns={userColumns}
            data={users}
            keyExtractor={(u) => u.id}
            emptyMessage="No team members registered."
            ariaLabel="Team members directory table"
          />
        )}
      </div>

      {/* Invite Member Modal */}
      {isInviting && (
        <div className={styles.modalBackdrop} role="dialog" aria-modal="true" aria-labelledby="invite-modal-title">
          <div className={styles.modal}>
            <h2 className={styles.modalTitle} id="invite-modal-title">Invite Team Member</h2>
            <form onSubmit={handleInvite} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              <div className={styles.formField}>
                <label className={styles.formLabel} htmlFor="invite-name-input">Full Name *</label>
                <input
                  id="invite-name-input"
                  type="text"
                  required
                  className={styles.input}
                  placeholder="e.g. Alex Morgan"
                  value={inviteName}
                  onChange={(e) => setInviteName(e.target.value)}
                />
              </div>

              <div className={styles.formField}>
                <label className={styles.formLabel} htmlFor="invite-email-input">Email Address *</label>
                <input
                  id="invite-email-input"
                  type="email"
                  required
                  className={styles.input}
                  placeholder="alex@company.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                />
              </div>

              <div className={styles.formField}>
                <label className={styles.formLabel} htmlFor="invite-pass-input">Temporary Password *</label>
                <input
                  id="invite-pass-input"
                  type="password"
                  required
                  minLength={8}
                  className={styles.input}
                  placeholder="Minimum 8 characters"
                  value={invitePassword}
                  onChange={(e) => setInvitePassword(e.target.value)}
                />
              </div>

              <div className={styles.formField}>
                <label className={styles.formLabel} htmlFor="invite-role-select">Assigned RBAC Role</label>
                <select
                  id="invite-role-select"
                  className={styles.select}
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value)}
                >
                  <option value="admin">Admin (Full tenant control)</option>
                  <option value="operations_manager">Operations Manager</option>
                  <option value="sales_manager">Sales Manager</option>
                  <option value="support_manager">Support Manager</option>
                  <option value="agent_operator">Agent Operator</option>
                  <option value="analyst">Analyst</option>
                  <option value="finance">Finance</option>
                  <option value="read_only">Read-Only Observer</option>
                </select>
              </div>

              <div className={styles.modalActions}>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setIsInviting(false)} disabled={isSubmitting}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-accent" disabled={isSubmitting}>
                  {isSubmitting ? 'Inviting...' : 'Send Invitation'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
