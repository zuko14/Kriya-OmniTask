import { useState } from 'react';
import { apiFetch } from '../../lib/apiClient';
import { useAsync } from '../../lib/useAsync';
import { AsyncState } from '../../components/AsyncState';
import { DataTable, Column } from '../../components/DataTable';
import { OutcomeBadge } from '../../components/primitives/OutcomeBadge';
import styles from './TrustScreens.module.css';

/** Server shape: src/attention/types/attentionTypes.ts (VerificationJobRecord). */
export interface VerificationJob {
  id: string;
  run_id: string;
  tool_slug: string;
  status: 'pending' | 'verified' | 'mismatch' | 'expired';
  attempts: number;
  max_attempts: number;
  deadline_at: string;
  next_check_at: string;
  error_message?: string | null;
}
interface Page { jobs: VerificationJob[]; total: number; limit: number; offset: number; count: number }

const VIEWS = {
  attention: { label: 'Needs attention', status: 'mismatch,expired', empty: 'No mismatched or expired verifications.' },
  pending: { label: 'Awaiting confirmation', status: 'pending', empty: 'Nothing is waiting for read-back confirmation.' },
  verified: { label: 'Verified', status: 'verified', empty: 'No verified actions yet.' },
} as const;
type View = keyof typeof VIEWS;
const PAGE = 50;

/** A pending check whose deadline has passed is overdue: it is still unconfirmed, not done. */
export function isOverdue(job: VerificationJob, now = Date.now()): boolean {
  return job.status === 'pending' && new Date(job.deadline_at).getTime() < now;
}

/**
 * Verification Queue (04_UI_UX_KRIYA_DESIGN.md §4, WP-3.4 read-back): actions the system has not yet confirmed in
 * the target system, and checks that failed. "Verified" only ever means the read-back matched.
 */
export function VerificationQueue() {
  const [view, setView] = useState<View>('attention');
  const [offset, setOffset] = useState(0);
  const page = useAsync(
    () => apiFetch<Page>(`/api/v1/verification/jobs?status=${encodeURIComponent(VIEWS[view].status)}&limit=${PAGE}&offset=${offset}`),
    [view, offset]
  );

  const columns: Column<VerificationJob>[] = [
    { key: 'tool', header: 'Action', render: (j) => j.tool_slug },
    { key: 'run', header: 'Run', render: (j) => <span className={styles.mono}>{j.run_id}</span> },
    {
      key: 'status',
      header: 'Outcome',
      render: (j) => (
        <span className={styles.row}>
          <OutcomeBadge state={j.status} />
          {isOverdue(j) && <span className="badge badge-sm badge-red">Past deadline</span>}
        </span>
      ),
    },
    { key: 'attempts', header: 'Checks', render: (j) => `${j.attempts} / ${j.max_attempts}` },
    { key: 'deadline', header: 'Deadline', render: (j) => new Date(j.deadline_at).toLocaleString() },
    { key: 'next', header: 'Next check', render: (j) => (j.status === 'pending' ? new Date(j.next_check_at).toLocaleString() : '—') },
    { key: 'reason', header: 'Reason', render: (j) => j.error_message || '—' },
  ];

  function choose(v: View) {
    setView(v);
    setOffset(0);
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>Verification Queue</h1>
          <p className={styles.subtitle}>
            Every consequential action is read back from the target system. Until that read-back matches, the action is submitted, not done.
          </p>
        </div>
        <div className="segmented" role="group" aria-label="Queue view">
          {(Object.keys(VIEWS) as View[]).map((v) => (
            <button key={v} type="button" aria-pressed={view === v} onClick={() => choose(v)}>
              {VIEWS[v].label}
            </button>
          ))}
        </div>
      </header>

      {page.status !== 'success' ? (
        <AsyncState status={page.status} error={page.error} />
      ) : (
        <>
          <DataTable columns={columns} data={page.data.jobs} keyExtractor={(j) => j.id} emptyMessage={VIEWS[view].empty} ariaLabel={VIEWS[view].label} />
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
