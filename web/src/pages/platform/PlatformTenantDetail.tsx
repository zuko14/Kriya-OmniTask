import { useCallback } from 'react';
import { Link, useParams } from 'react-router';
import { apiFetch } from '../../lib/apiClient';
import { useAsync } from '../../lib/useAsync';
import { AsyncState } from '../../components/AsyncState';
import { Panel, SignalBadge, type SignalState } from '../../components/primitives';

interface TenantActivity {
  tenant: {
    id: string;
    name: string;
    slug: string;
    status: string;
    planTier: string;
    channelPlan: string;
    industry?: string;
    region?: string;
    timezone?: string;
    createdAt: string;
  };
  stats: {
    agentCount: number;
    userCount: number;
    attentionCount: number;
    runs24h: number;
    failed24h: number;
    errorRatePct: number | null;
    spendInrMonth: number;
    lastActivityAt: string | null;
  };
  users: { id: string; email: string; fullName: string; status: string; roles: string[]; lastLoginAt: string | null }[];
  recentRuns: { id: string; graphId: string; status: string; outcome: string | null; parkReason: string | null; createdAt: string }[];
  auditTrail: { id: string; action: string; resourceType: string; resourceId: string | null; userId: string | null; createdAt: string }[];
  operatorActions: { id: string; operatorId: string; actionType: string; reason: string; createdAt: string }[];
}

const STATUS_SIGNAL: Record<string, SignalState> = { active: 'live', suspended: 'idle', degraded: 'attention', disabled: 'halt' };
const STATUS_LABEL: Record<string, string> = { active: 'live', suspended: 'suspended', degraded: 'degraded', disabled: 'deleted' };

const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : '—');
const cell: React.CSSProperties = { padding: 'var(--space-2) var(--space-3)', textAlign: 'left', verticalAlign: 'top' };
const head: React.CSSProperties = { ...cell, fontWeight: 600, fontSize: 'var(--text-2xs)', textTransform: 'uppercase', color: 'var(--text3)' };
const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' };

/** Owner-console drill-down: who the client's users are and what the workspace has been doing. */
export function PlatformTenantDetail() {
  const { id = '' } = useParams();
  const fetchActivity = useCallback(
    () => apiFetch<TenantActivity>(`/api/v1/admin/tenants/${encodeURIComponent(id)}/activity?limit=100`),
    [id]
  );
  const state = useAsync(fetchActivity, [id]);

  if (state.status === 'error') return <AsyncState status="error" error={state.error} />;
  if (state.status !== 'success' || !state.data) return <AsyncState status="loading" />;
  const { tenant, stats, users, recentRuns, auditTrail, operatorActions } = state.data;

  const tiles: [string, string][] = [
    ['Users', String(stats.userCount)],
    ['Agents', String(stats.agentCount)],
    ['Runs (24h)', String(stats.runs24h)],
    ['Error rate (24h)', stats.errorRatePct === null ? 'No runs' : `${stats.errorRatePct.toFixed(1)}%`],
    ['Spend (month to date)', `₹${stats.spendInrMonth.toLocaleString('en-IN')}`],
    ['Pending attention', String(stats.attentionCount)],
    ['Last activity', when(stats.lastActivityAt)],
  ];

  return (
    <div style={{ maxWidth: 'var(--main-max)', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      <header style={{ borderBottom: 'var(--border-width) solid var(--border)', paddingBottom: 'var(--space-4)' }}>
        <Link to="/owner/tenants" style={{ fontSize: 'var(--text-xs)', color: 'var(--text2)' }}>
          ← All clients
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap', marginTop: 'var(--space-2)' }}>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-3xl)', fontWeight: 700, margin: 0 }}>{tenant.name}</h1>
          <SignalBadge state={STATUS_SIGNAL[tenant.status] ?? 'info'} label={STATUS_LABEL[tenant.status] ?? tenant.status} size="sm" />
        </div>
        <p style={{ ...mono, color: 'var(--text3)', margin: 'var(--space-1) 0 0' }}>
          workspace {tenant.slug} · {tenant.planTier} · {tenant.channelPlan} · {tenant.region ?? '—'} · created {when(tenant.createdAt)}
        </p>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 'var(--space-3)' }}>
        {tiles.map(([label, value]) => (
          <div key={label} style={{ background: 'var(--surface)', border: 'var(--border-width) solid var(--border)', padding: 'var(--space-3)', borderRadius: 'var(--radius-md)' }}>
            <div className="eyebrow">{label}</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-xl)', fontWeight: 700, marginTop: 'var(--space-1)' }}>{value}</div>
          </div>
        ))}
      </div>
      <p style={{ margin: 0, fontSize: 'var(--text-2xs)', color: 'var(--text3)' }}>
        Source: this workspace&apos;s own records (graph runs, cost attribution, audit log). Spend converts recorded USD cost at the platform rate.
      </p>

      <Panel title="Users" eyebrow="Who can sign in at /admin">
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-sm)' }}>
            <thead>
              <tr><th style={head}>Email</th><th style={head}>Name</th><th style={head}>Roles</th><th style={head}>Status</th><th style={head}>Last sign-in</th></tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} style={{ borderTop: 'var(--border-width) solid var(--border)' }}>
                  <td style={{ ...cell, ...mono }}>{u.email}</td>
                  <td style={cell}>{u.fullName}</td>
                  <td style={cell}>{u.roles.join(', ') || '—'}</td>
                  <td style={cell}>{u.status}</td>
                  <td style={cell}>{when(u.lastLoginAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Recent workflow runs" eyebrow="Latest 20">
        {recentRuns.length === 0 ? (
          <p style={{ color: 'var(--text3)', fontSize: 'var(--text-sm)', margin: 0 }}>No workflow runs yet.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-sm)' }}>
              <thead>
                <tr><th style={head}>Started</th><th style={head}>Workflow</th><th style={head}>Status</th><th style={head}>Outcome</th></tr>
              </thead>
              <tbody>
                {recentRuns.map((r) => (
                  <tr key={r.id} style={{ borderTop: 'var(--border-width) solid var(--border)' }}>
                    <td style={cell}>{when(r.createdAt)}</td>
                    <td style={{ ...cell, ...mono }}>{r.graphId}</td>
                    <td style={{ ...cell, color: r.status === 'failed' ? 'var(--red)' : r.status === 'parked' ? 'var(--amber)' : 'var(--text)' }}>{r.status}</td>
                    <td style={cell}>{r.outcome ?? r.parkReason ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Activity log" eyebrow="Workspace audit trail · latest 100">
        {auditTrail.length === 0 ? (
          <p style={{ color: 'var(--text3)', fontSize: 'var(--text-sm)', margin: 0 }}>No recorded activity yet.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-sm)' }}>
              <thead>
                <tr><th style={head}>Time</th><th style={head}>Action</th><th style={head}>Resource</th><th style={head}>User</th></tr>
              </thead>
              <tbody>
                {auditTrail.map((e) => (
                  <tr key={e.id} style={{ borderTop: 'var(--border-width) solid var(--border)' }}>
                    <td style={{ ...cell, whiteSpace: 'nowrap' }}>{when(e.createdAt)}</td>
                    <td style={{ ...cell, ...mono }}>{e.action}</td>
                    <td style={{ ...cell, ...mono, color: 'var(--text2)' }}>{e.resourceType}{e.resourceId ? ` · ${e.resourceId}` : ''}</td>
                    <td style={{ ...cell, ...mono, color: 'var(--text2)' }}>{users.find((u) => u.id === e.userId)?.email ?? e.userId ?? 'system'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="Operator actions on this client" eyebrow="Provisioning, suspensions, deletions, elevations">
        {operatorActions.length === 0 ? (
          <p style={{ color: 'var(--text3)', fontSize: 'var(--text-sm)', margin: 0 }}>None recorded.</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 'var(--space-4)', fontSize: 'var(--text-sm)', display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            {operatorActions.map((a) => (
              <li key={a.id}>
                <span style={mono}>{when(a.createdAt)}</span> · <strong>{a.actionType}</strong> · {a.reason}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
