/**
 * Outcome state badge (04_UI_UX_KRIYA_DESIGN.md §3, "verified or not done").
 * Only `verified` is ever green. Unknown states are shown verbatim in neutral, never as success.
 */
const STATES: Record<string, { cls: string; label: string }> = {
  verified: { cls: 'badge-green', label: 'Verified' },
  submitted: { cls: 'badge-blue', label: 'Submitted · awaiting confirmation' },
  pending: { cls: 'badge-blue', label: 'Pending verification' },
  awaiting_approval: { cls: 'badge-amber', label: 'Needs approval' },
  parked: { cls: 'badge-amber', label: 'Waiting on a person' },
  blocked: { cls: 'badge-red', label: 'Blocked' },
  failed: { cls: 'badge-red', label: 'Failed' },
  error: { cls: 'badge-red', label: 'Failed' },
  verification_failed: { cls: 'badge-red', label: 'Verification failed' },
  mismatch: { cls: 'badge-red', label: 'Verification mismatch' },
  expired: { cls: 'badge-red', label: 'Verification expired' },
  compensated: { cls: 'badge-muted', label: 'Compensated' },
};

export function OutcomeBadge({ state }: { state: string | null | undefined }) {
  const s = state ? STATES[state] : undefined;
  return <span className={`badge badge-sm ${s?.cls ?? 'badge-muted'}`}>{s?.label ?? (state || 'No state recorded')}</span>;
}
