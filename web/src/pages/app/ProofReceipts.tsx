import { useState } from 'react';
import { apiFetch, ApiError } from '../../lib/apiClient';
import { useAsync } from '../../lib/useAsync';
import { AsyncState } from '../../components/AsyncState';
import { DataTable, Column } from '../../components/DataTable';
import { OutcomeBadge } from '../../components/primitives/OutcomeBadge';
import styles from './TrustScreens.module.css';

/** Server shape: src/trust/proof/proofService.ts (SignedReceipt, exportBundle). */
interface SignedReceipt {
  body: {
    receiptId: string;
    sequence: number;
    actionType: string;
    riskTier: string;
    target: { system: string; externalRef?: string };
    verification: { method: string; state: string };
    issuedAt: string;
  };
  hash: string;
  keyId: string;
  signature: string;
}
interface Bundle { tenantId: string; receipts: SignedReceipt[]; publicKeys: Record<string, string> }
interface Page { receipts: SignedReceipt[]; total: number; limit: number; offset: number; count: number }
const PAGE = 50;
type Check = { valid: boolean; reason?: string };

const errorText = (e: unknown) => (e instanceof ApiError ? e.message : 'The check could not be run.');

/**
 * Kriya Proof receipts (WP-3.3): every consequential action's signed, hash-chained record.
 * "Verify" runs the server's signature + chain-link check; nothing is shown as valid unless the server said so.
 */
export function ProofReceipts() {
  const [offset, setOffset] = useState(0);
  const page = useAsync(() => apiFetch<Page>(`/api/v1/proof/receipts?limit=${PAGE}&offset=${offset}`), [offset]);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [checks, setChecks] = useState<Record<string, Check | 'running' | { error: string }>>({});
  const [chain, setChain] = useState<null | 'running' | { error: string } | { valid: boolean; checked: number; brokenAt?: number; reason?: string }>(null);

  async function verifyOne(id: string) {
    setChecks((c) => ({ ...c, [id]: 'running' }));
    try {
      const r = await apiFetch<Check>(`/api/v1/proof/receipts/${encodeURIComponent(id)}/verify`);
      setChecks((c) => ({ ...c, [id]: r }));
    } catch (e) {
      setChecks((c) => ({ ...c, [id]: { error: errorText(e) } }));
    }
  }

  async function verifyChain() {
    setChain('running');
    try {
      setChain(await apiFetch('/api/v1/proof/chain/verify'));
    } catch (e) {
      setChain({ error: errorText(e) });
    }
  }

  // The auditor bundle (all receipts + public keys) is fetched only when asked for.
  async function download() {
    setExporting(true);
    setExportError(null);
    try {
      const bundle = await apiFetch<Bundle>('/api/v1/proof/export');
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `kriya-proof-${bundle.tenantId}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setExportError(errorText(e));
    } finally {
      setExporting(false);
    }
  }

  const columns: Column<SignedReceipt>[] = [
    { key: 'sequence', header: '#', width: '60px', render: (r) => <span className={styles.mono}>{r.body.sequence}</span> },
    { key: 'action', header: 'Action', render: (r) => r.body.actionType },
    { key: 'tier', header: 'Tier', width: '70px', render: (r) => r.body.riskTier },
    { key: 'target', header: 'Target', render: (r) => `${r.body.target.system}${r.body.target.externalRef ? ` · ${r.body.target.externalRef}` : ''}` },
    { key: 'state', header: 'Outcome', render: (r) => <OutcomeBadge state={r.body.verification?.state} /> },
    { key: 'issued', header: 'Issued', render: (r) => new Date(r.body.issuedAt).toLocaleString() },
    {
      key: 'verify',
      header: 'Signature + chain',
      render: (r) => {
        const c = checks[r.body.receiptId];
        if (!c) {
          return (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => verifyOne(r.body.receiptId)} aria-label={`Verify receipt ${r.body.sequence}`}>
              Verify
            </button>
          );
        }
        if (c === 'running') return <span className={styles.note}>Checking…</span>;
        if ('error' in c) return <span className="badge badge-sm badge-red">{c.error}</span>;
        return c.valid ? <span className="badge badge-sm badge-green">Valid</span> : <span className="badge badge-sm badge-red">Invalid{c.reason ? ` · ${c.reason}` : ''}</span>;
      },
    },
  ];

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>Proof Receipts</h1>
          <p className={styles.subtitle}>Signed, hash-chained records of every consequential action. A receipt's outcome is what the system observed, not what was attempted.</p>
        </div>
        <div className={styles.row}>
          <button type="button" className="btn btn-ghost" onClick={verifyChain} disabled={chain === 'running'}>
            {chain === 'running' ? 'Checking chain…' : 'Verify whole chain'}
          </button>
          <button type="button" className="btn btn-accent" onClick={download} disabled={exporting}>
            {exporting ? 'Preparing export…' : 'Export auditor bundle'}
          </button>
        </div>
      </header>

      {chain && chain !== 'running' && (
        'error' in chain ? (
          <div className="alert alert-err" role="alert">{chain.error}</div>
        ) : chain.valid ? (
          <div className="alert alert-ok" role="status">Chain intact: {chain.checked} receipts checked, every signature and link valid.</div>
        ) : (
          <div className="alert alert-err" role="alert">
            Chain broken{chain.brokenAt !== undefined ? ` at sequence ${chain.brokenAt}` : ''}{chain.reason ? `: ${chain.reason}` : ''} ({chain.checked} checked).
          </div>
        )
      )}

      {exportError && (
        <div className="alert alert-err" role="alert">
          Export failed: {exportError}
        </div>
      )}

      {page.status !== 'success' ? (
        <AsyncState status={page.status} error={page.error} />
      ) : (
        <>
          <DataTable columns={columns} data={page.data.receipts} keyExtractor={(r) => r.body.receiptId} emptyMessage="No receipts yet. Receipts are written when an agent takes a consequential action." ariaLabel="Proof receipts" />
          {page.data.total > 0 && (
            <div className={styles.row} style={{ justifyContent: 'space-between' }}>
              <span className={styles.note}>
                {page.data.offset + 1}–{page.data.offset + page.data.count} of {page.data.total}
              </span>
              <span className={styles.row}>
                <button type="button" className="btn btn-ghost btn-sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
                  Previous
                </button>
                <button type="button" className="btn btn-ghost btn-sm" disabled={page.data.offset + page.data.count >= page.data.total} onClick={() => setOffset(offset + PAGE)}>
                  Next
                </button>
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
