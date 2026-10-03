import { Fragment, useState, type FormEvent } from 'react';
import { apiFetch } from '../../lib/apiClient';
import { useAsync } from '../../lib/useAsync';
import { AsyncState } from '../../components/AsyncState';
import { DataTable, Column } from '../../components/DataTable';
import { OutcomeBadge } from '../../components/primitives/OutcomeBadge';
import styles from './TrustScreens.module.css';

/** Server shapes: src/observability/types/observabilityTypes.ts. */
interface TraceRow {
  id: string;
  root_agent_id: string;
  channel: string;
  status: string;
  total_latency_ms: number;
  total_tokens_input: number;
  total_tokens_output: number;
  total_cost_usd: number;
  started_at: string;
}
interface TimelineNode {
  nodeId: string;
  nodeKind: string;
  visit: number;
  step: number;
  latencyMs: number;
  costUsd: number;
  status: 'completed' | 'error' | 'parked';
  actionSummary: string;
  modelId?: string;
  toolName?: string;
  proofReceiptId?: string;
  verificationState?: string;
}
interface Timeline {
  runId: string;
  graphId: string;
  status: string;
  outcome?: string;
  totalDurationMs: number;
  totalCostUsd: number;
  totalTokens: number;
  nodes: TimelineNode[];
  verifications: Array<{ jobId: string; status: string }>;
}

const NODE_STATE: Record<TimelineNode['status'], string> = { completed: 'badge-muted', error: 'badge-red', parked: 'badge-amber' };

function RunGraph({ id }: { id: string }) {
  const run = useAsync(() => apiFetch<Timeline>(`/api/v1/observability/decision-traces/${encodeURIComponent(id)}`), [id]);
  if (run.status !== 'success') return <AsyncState status={run.status} error={run.error} />;
  const t = run.data;
  return (
    <section className="card" aria-label={`Run ${t.runId}`}>
      <div className={styles.header}>
        <div>
          <h2>Run {t.runId}</h2>
          <p className={styles.mono}>graph {t.graphId}</p>
        </div>
        <div className={styles.row}>
          <OutcomeBadge state={t.outcome ?? t.status} />
          <span className={styles.mono}>
            {t.totalDurationMs} ms · ${t.totalCostUsd.toFixed(4)} · {t.totalTokens.toLocaleString()} tokens
          </span>
        </div>
      </div>
      {t.nodes.length === 0 ? (
        <p className={styles.note}>No steps were recorded for this run.</p>
      ) : (
        <ol className={styles.timeline} aria-label="Steps taken">
          {t.nodes.map((n, i) => (
            <Fragment key={`${n.nodeId}-${n.visit}-${n.step}`}>
              {i > 0 && <div className={styles.edge} aria-hidden="true" />}
              <li className={styles.node}>
                <span className={styles.step}>#{n.step}</span>
                <div>
                  <div className={styles.nodeTitle}>
                    {n.nodeKind} · {n.nodeId}
                    {n.visit > 1 ? ` (visit ${n.visit})` : ''}
                  </div>
                  <div style={{ color: 'var(--text2)', fontSize: '0.85rem' }}>{n.actionSummary}</div>
                  <div className={styles.row} style={{ marginTop: 'var(--space-1)' }}>
                    <span className={`badge badge-sm ${NODE_STATE[n.status] ?? 'badge-muted'}`}>{n.status}</span>
                    {n.verificationState && <OutcomeBadge state={n.verificationState} />}
                    {n.proofReceiptId && <span className={styles.mono}>receipt {n.proofReceiptId}</span>}
                  </div>
                </div>
                <div className={styles.nodeMeta}>
                  {n.latencyMs} ms · ${n.costUsd.toFixed(4)}
                  {(n.modelId || n.toolName) && <div>{n.modelId ?? n.toolName}</div>}
                </div>
              </li>
            </Fragment>
          ))}
        </ol>
      )}
      {t.verifications.length > 0 && (
        <p className={styles.note} style={{ marginTop: 'var(--space-3)' }}>
          Read-back checks: {t.verifications.map((v) => `${v.jobId} ${v.status}`).join(' · ')}
        </p>
      )}
    </section>
  );
}

/** Run Trace (04_UI_UX_KRIYA_DESIGN.md §4, WP-2.6 data): the path a run actually took, step by step. */
export function RunTrace() {
  const traces = useAsync(() => apiFetch<{ traces: TraceRow[] }>('/api/v1/observability/traces?limit=50'), []);
  const [selected, setSelected] = useState<string | null>(null);
  const [lookup, setLookup] = useState('');

  const columns: Column<TraceRow>[] = [
    { key: 'started', header: 'Started', render: (t) => new Date(t.started_at).toLocaleString() },
    { key: 'agent', header: 'Agent', render: (t) => t.root_agent_id },
    { key: 'channel', header: 'Channel', render: (t) => t.channel },
    { key: 'status', header: 'Status', render: (t) => <OutcomeBadge state={t.status} /> },
    { key: 'cost', header: 'Cost', render: (t) => `$${t.total_cost_usd.toFixed(4)}` },
    { key: 'latency', header: 'Latency', render: (t) => `${t.total_latency_ms} ms` },
    {
      key: 'open',
      header: '',
      render: (t) => (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelected(t.id)} aria-label={`Open trace ${t.id}`}>
          Open
        </button>
      ),
    },
  ];

  function open(e: FormEvent) {
    e.preventDefault();
    if (lookup.trim()) setSelected(lookup.trim());
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>Run Trace</h1>
          <p className={styles.subtitle}>Every step a run took, its cost and latency, and whether its actions were verified and receipted.</p>
        </div>
        <form className={styles.row} onSubmit={open}>
          <input className="search-input" style={{ width: 260, padding: '9px 12px' }} aria-label="Run or trace id" placeholder="Run or trace id" value={lookup} onChange={(e) => setLookup(e.target.value)} />
          <button type="submit" className="btn btn-ghost">Open</button>
        </form>
      </header>

      {selected && <RunGraph id={selected} />}

      {traces.status !== 'success' ? (
        <AsyncState status={traces.status} error={traces.error} />
      ) : (
        <DataTable columns={columns} data={traces.data.traces} keyExtractor={(t) => t.id} emptyMessage="No runs recorded yet." ariaLabel="Recent runs" />
      )}
    </div>
  );
}
