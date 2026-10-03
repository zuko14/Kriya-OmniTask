import { useState, type FormEvent } from 'react';
import { apiFetch, ApiError } from '../../lib/apiClient';
import { useAsync } from '../../lib/useAsync';
import { useAuth } from '../../lib/authContext';
import { AsyncState } from '../../components/AsyncState';
import { DataTable, Column } from '../../components/DataTable';
import { ConfirmDialog } from '../../components/primitives/ConfirmDialog';
import styles from './TrustScreens.module.css';

/** Server shape: src/trust/mandate/mandateService.ts (MandateRecord). */
export interface MandateRecord {
  id: string;
  agent_slug: string;
  action_types_json: string;
  per_action_limit: number | null;
  daily_limit: number | null;
  currency: string;
  max_count_per_day: number | null;
  valid_from: string;
  valid_until: string | null;
  revoked_at: string | null;
  version: number;
}

function actions(m: MandateRecord): string {
  try {
    const list = JSON.parse(m.action_types_json);
    return Array.isArray(list) ? list.join(', ') : 'Unreadable';
  } catch {
    return 'Unreadable';
  }
}

export function mandateStatus(m: MandateRecord, now = Date.now()): 'revoked' | 'expired' | 'not_yet_valid' | 'active' {
  if (m.revoked_at) return 'revoked';
  if (m.valid_until && new Date(m.valid_until).getTime() <= now) return 'expired';
  if (new Date(m.valid_from).getTime() > now) return 'not_yet_valid';
  return 'active';
}

const STATUS_BADGE = {
  active: ['badge-green', 'Active'],
  revoked: ['badge-muted', 'Revoked'],
  expired: ['badge-amber', 'Expired'],
  not_yet_valid: ['badge-blue', 'Not yet valid'],
} as const;

const errorText = (e: unknown) => (e instanceof ApiError ? e.message : 'The request failed.');

/**
 * Kriya Mandate: delegated authority an agent needs before any T2 action (WP-3.1).
 * Creating and revoking are enforced server-side (tenant:admin); this screen only reports what the API returns.
 */
export function Mandates() {
  const { auth } = useAuth();
  const [refresh, setRefresh] = useState(0);
  const list = useAsync(() => apiFetch<{ mandates: MandateRecord[] }>('/api/v1/mandates'), [refresh]);
  const [revoking, setRevoking] = useState<MandateRecord | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [form, setForm] = useState({ agentSlug: '', actionTypes: '', perActionLimit: '', dailyLimit: '', currency: 'INR', maxCountPerDay: '', validUntil: '' });
  const [saving, setSaving] = useState(false);

  async function revoke() {
    if (!revoking) return;
    const target = revoking;
    setRevoking(null);
    try {
      await apiFetch(`/api/v1/mandates/${encodeURIComponent(target.id)}`, { method: 'DELETE' });
      setMessage({ ok: true, text: `Mandate for ${target.agent_slug} revoked.` });
    } catch (e) {
      setMessage({ ok: false, text: errorText(e) });
    }
    setRefresh((n) => n + 1);
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!auth) return;
    setSaving(true);
    setMessage(null);
    const num = (v: string) => (v.trim() === '' ? undefined : Number(v));
    try {
      await apiFetch('/api/v1/mandates', {
        method: 'POST',
        body: JSON.stringify({
          principalId: auth.user.id,
          agentSlug: form.agentSlug.trim(),
          actionTypes: form.actionTypes.split(',').map((a) => a.trim()).filter(Boolean),
          perActionLimit: num(form.perActionLimit),
          dailyLimit: num(form.dailyLimit),
          currency: form.currency.trim().toUpperCase(),
          maxCountPerDay: num(form.maxCountPerDay),
          validUntil: form.validUntil ? new Date(form.validUntil).toISOString() : undefined,
        }),
      });
      setMessage({ ok: true, text: `Mandate created for ${form.agentSlug.trim()}.` });
      setForm({ ...form, agentSlug: '', actionTypes: '' });
      setRefresh((n) => n + 1);
    } catch (err) {
      setMessage({ ok: false, text: errorText(err) });
    } finally {
      setSaving(false);
    }
  }

  const columns: Column<MandateRecord>[] = [
    { key: 'agent_slug', header: 'Agent', render: (m) => (m.agent_slug === '*' ? 'Any agent' : m.agent_slug) },
    { key: 'actions', header: 'Actions allowed', render: actions },
    {
      key: 'limits',
      header: 'Limits',
      render: (m) =>
        [
          m.per_action_limit !== null ? `${m.per_action_limit} ${m.currency} / action` : null,
          m.daily_limit !== null ? `${m.daily_limit} ${m.currency} / day` : null,
          m.max_count_per_day !== null ? `${m.max_count_per_day} actions / day` : null,
        ]
          .filter(Boolean)
          .join(' · ') || 'No numeric limit',
    },
    { key: 'validity', header: 'Valid', render: (m) => `${new Date(m.valid_from).toLocaleDateString()} → ${m.valid_until ? new Date(m.valid_until).toLocaleDateString() : 'no end date'}` },
    {
      key: 'status',
      header: 'Status',
      render: (m) => {
        const [cls, label] = STATUS_BADGE[mandateStatus(m)];
        return <span className={`badge badge-sm ${cls}`}>{label}</span>;
      },
    },
    {
      key: 'actionsCol',
      header: '',
      render: (m) =>
        mandateStatus(m) === 'revoked' ? null : (
          <button type="button" className="btn btn-danger btn-sm" onClick={() => setRevoking(m)} aria-label={`Revoke mandate for ${m.agent_slug}`}>
            Revoke
          </button>
        ),
    },
  ];

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>Mandates</h1>
          <p className={styles.subtitle}>Delegated authority. An agent can take a T2 action only inside an active mandate; T3 actions always need a person.</p>
        </div>
      </header>

      {message && (
        <div className={`alert ${message.ok ? 'alert-ok' : 'alert-err'}`} role={message.ok ? 'status' : 'alert'}>
          {message.text}
        </div>
      )}

      {list.status !== 'success' ? (
        <AsyncState status={list.status} error={list.error} />
      ) : (
        <DataTable columns={columns} data={list.data.mandates} keyExtractor={(m) => m.id} emptyMessage="No mandates. Agents cannot take T2 actions until one is granted." ariaLabel="Mandates" />
      )}

      <form className="card" onSubmit={create} aria-label="Grant a mandate">
        <h2>Grant a mandate</h2>
        <div className={styles.form}>
          <label className={styles.field}>
            Agent slug (* for any)
            <input required value={form.agentSlug} onChange={(e) => setForm({ ...form, agentSlug: e.target.value })} />
          </label>
          <label className={styles.field}>
            Action types (comma separated)
            <input required value={form.actionTypes} onChange={(e) => setForm({ ...form, actionTypes: e.target.value })} />
          </label>
          <label className={styles.field}>
            Per-action limit
            <input type="number" min="0" step="any" value={form.perActionLimit} onChange={(e) => setForm({ ...form, perActionLimit: e.target.value })} />
          </label>
          <label className={styles.field}>
            Daily limit
            <input type="number" min="0" step="any" value={form.dailyLimit} onChange={(e) => setForm({ ...form, dailyLimit: e.target.value })} />
          </label>
          <label className={styles.field}>
            Currency
            <input required maxLength={3} value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} />
          </label>
          <label className={styles.field}>
            Max actions per day
            <input type="number" min="1" step="1" value={form.maxCountPerDay} onChange={(e) => setForm({ ...form, maxCountPerDay: e.target.value })} />
          </label>
          <label className={styles.field}>
            Valid until (optional)
            <input type="datetime-local" value={form.validUntil} onChange={(e) => setForm({ ...form, validUntil: e.target.value })} />
          </label>
        </div>
        <div className={styles.row} style={{ marginTop: 'var(--space-4)' }}>
          <button type="submit" className="btn btn-accent" disabled={saving}>
            {saving ? 'Granting…' : 'Grant mandate'}
          </button>
          <p className={styles.note}>Only owners and admins can grant or revoke; the server rejects anyone else.</p>
        </div>
      </form>

      <ConfirmDialog
        isOpen={revoking !== null}
        title="Revoke this mandate?"
        actionName={revoking ? `revoke mandate · ${revoking.agent_slug}` : ''}
        consequence="The agent loses this authority immediately; any T2 action that needs it will be blocked until a new mandate is granted."
        isHighRisk
        confirmLabel="Revoke"
        onConfirm={revoke}
        onCancel={() => setRevoking(null)}
      />
    </div>
  );
}
