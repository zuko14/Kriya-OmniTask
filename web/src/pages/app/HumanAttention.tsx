import { useState, useCallback } from 'react';
import { apiFetch, ApiError } from '../../lib/apiClient';
import { useAsync } from '../../lib/useAsync';
import { DataTable, Column } from '../../components/DataTable';
import { AsyncState } from '../../components/AsyncState';
import styles from './HumanAttention.module.css';

export interface AttentionItem {
  id: string;
  organization_id: string;
  correlation_id: string;
  trace_id?: string;
  customer_id?: string;
  channel: string;
  source_agent_id: string;
  title: string;
  description: string;
  reason_category: string;
  priority: 'P0_CRITICAL' | 'P1_HIGH' | 'P2_MEDIUM' | 'P3_LOW';
  status: 'pending' | 'claimed' | 'resolved' | 'dismissed' | 'timed_out';
  assigned_user_id?: string;
  recommended_action?: string;
  sla_expires_at: string;
  created_at: string;
}

export interface AttentionMetrics {
  totalItems: number;
  pendingCount: number;
  claimedCount: number;
  resolvedCount: number;
  slaBreachCount: number;
  activeTakeoversCount: number;
  avgResolutionMinutes: number;
}

export function HumanAttention() {
  const [statusFilter, setStatusFilter] = useState<string>('pending');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [refreshTrigger, setRefreshTrigger] = useState<number>(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Modal resolution state
  const [resolvingItem, setResolvingItem] = useState<AttentionItem | null>(null);
  const [resolutionAction, setResolutionAction] = useState<string>('approved');
  const [resolutionNotes, setResolutionNotes] = useState<string>('');
  const [submittingResolution, setSubmittingResolution] = useState<boolean>(false);

  const fetchItems = useCallback(() => {
    const params = new URLSearchParams();
    if (statusFilter !== 'all') params.set('status', statusFilter);
    if (priorityFilter !== 'all') params.set('priority', priorityFilter);
    params.set('limit', '50');
    return apiFetch<{ items: AttentionItem[]; count: number }>(`/api/v1/attention/items?${params.toString()}`);
  }, [statusFilter, priorityFilter, refreshTrigger]);

  const fetchMetrics = useCallback(() => {
    return apiFetch<AttentionMetrics>('/api/v1/attention/metrics');
  }, [refreshTrigger]);

  const itemsState = useAsync(fetchItems, [fetchItems]);
  const metricsState = useAsync(fetchMetrics, [fetchMetrics]);

  const handleRefresh = () => {
    setRefreshTrigger((prev) => prev + 1);
    setActionError(null);
    setActionSuccess(null);
  };

  const handleClaim = async (item: AttentionItem) => {
    try {
      setActionError(null);
      await apiFetch(`/api/v1/attention/items/${item.id}/claim`, { method: 'POST' });
      setActionSuccess(`Successfully claimed item '${item.title}'.`);
      setRefreshTrigger((prev) => prev + 1);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Failed to claim item');
    }
  };

  const handleOpenResolve = (item: AttentionItem) => {
    setResolvingItem(item);
    setResolutionAction('approved');
    setResolutionNotes('');
    setActionError(null);
  };

  const handleSubmitResolution = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resolvingItem) return;

    try {
      setSubmittingResolution(true);
      setActionError(null);
      await apiFetch(`/api/v1/attention/items/${resolvingItem.id}/resolve`, {
        method: 'POST',
        body: JSON.stringify({
          action: resolutionAction,
          notes: resolutionNotes || undefined,
        }),
      });
      setActionSuccess(`Resolved item '${resolvingItem.title}' with action '${resolutionAction}'.`);
      setResolvingItem(null);
      setRefreshTrigger((prev) => prev + 1);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Failed to resolve item');
    } finally {
      setSubmittingResolution(false);
    }
  };

  const handleTakeover = async (item: AttentionItem) => {
    if (!item.customer_id) return;
    try {
      setActionError(null);
      await apiFetch('/api/v1/attention/takeovers', {
        method: 'POST',
        body: JSON.stringify({
          customerId: item.customer_id,
          channel: item.channel,
          reason: `Human takeover initiated from attention item '${item.title}'`,
        }),
      });
      setActionSuccess(`Live conversation takeover active for customer '${item.customer_id}'.`);
      setRefreshTrigger((prev) => prev + 1);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Failed to initiate takeover');
    }
  };

  const columns: Column<AttentionItem>[] = [
    {
      key: 'priority',
      header: 'Priority',
      width: '110px',
      render: (item) => {
        const priorityClass =
          item.priority === 'P0_CRITICAL'
            ? styles.priorityP0
            : item.priority === 'P1_HIGH'
            ? styles.priorityP1
            : item.priority === 'P2_MEDIUM'
            ? styles.priorityP2
            : styles.priorityP3;
        return <span className={`${styles.badge} ${priorityClass}`}>{item.priority.replace('_', ' ')}</span>;
      },
    },
    {
      key: 'title',
      header: 'Exception / Summary',
      render: (item) => (
        <div>
          <div style={{ fontWeight: 600, color: 'var(--color-ink)', marginBottom: '2px' }}>{item.title}</div>
          <div style={{ fontSize: '12px', color: 'var(--color-ink-muted)' }}>{item.description}</div>
          <div style={{ fontSize: '11px', color: 'var(--color-ink-muted)', marginTop: '4px', fontFamily: 'var(--font-mono)' }}>
            Category: {item.reason_category} · Agent: {item.source_agent_id}
          </div>
        </div>
      ),
    },
    {
      key: 'channel',
      header: 'Channel',
      width: '90px',
      render: (item) => <span style={{ textTransform: 'capitalize' }}>{item.channel}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      width: '100px',
      render: (item) => {
        const statusClass =
          item.status === 'pending'
            ? styles.statusPending
            : item.status === 'claimed'
            ? styles.statusClaimed
            : styles.statusResolved;
        return <span className={`${styles.badge} ${statusClass}`}>{item.status}</span>;
      },
    },
    {
      key: 'sla',
      header: 'SLA Expiry',
      width: '150px',
      render: (item) => {
        const expiresAt = new Date(item.sla_expires_at);
        const isBreached = Date.now() > expiresAt.getTime();
        return (
          <span style={{ fontSize: '12px', color: isBreached ? 'var(--color-critical)' : 'var(--color-ink-muted)' }}>
            {isBreached ? '⚠️ Breached' : expiresAt.toLocaleTimeString()}
          </span>
        );
      },
    },
    {
      key: 'actions',
      header: 'Actions',
      width: '200px',
      render: (item) => (
        <div className={styles.actionGroup}>
          {item.status === 'pending' && (
            <button className={styles.btnSecondary} onClick={() => handleClaim(item)}>
              Claim
            </button>
          )}
          {item.status !== 'resolved' && (
            <button className={styles.btnSecondary} onClick={() => handleOpenResolve(item)}>
              Resolve
            </button>
          )}
          {item.customer_id && item.status !== 'resolved' && (
            <button className={styles.btnSecondary} onClick={() => handleTakeover(item)}>
              Takeover
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
          <h1>Human Attention Center</h1>
          <p className={styles.subtitle}>Priority escalation queue, SLA enforcement, and live agent conversation takeover.</p>
        </div>
        <button className={styles.btnPrimary} onClick={handleRefresh}>
          Refresh Queue
        </button>
      </header>

      {actionError && <div className={styles.errorBanner}>⚠️ {actionError}</div>}
      {actionSuccess && <div className={styles.successBanner}>✓ {actionSuccess}</div>}

      {/* Metrics Strip */}
      {metricsState.status === 'success' && (
        <div className={styles.metricsGrid}>
          <div className={styles.metricCard}>
            <span className={styles.metricLabel}>Pending Items</span>
            <span className={styles.metricValue}>{metricsState.data.pendingCount}</span>
          </div>
          <div className={styles.metricCard}>
            <span className={styles.metricLabel}>Claimed Items</span>
            <span className={styles.metricValue}>{metricsState.data.claimedCount}</span>
          </div>
          <div className={styles.metricCard}>
            <span className={styles.metricLabel}>SLA Breaches</span>
            <span className={`${styles.metricValue} ${metricsState.data.slaBreachCount > 0 ? styles.metricAlert : ''}`}>
              {metricsState.data.slaBreachCount}
            </span>
          </div>
          <div className={styles.metricCard}>
            <span className={styles.metricLabel}>Active Takeovers</span>
            <span className={styles.metricValue}>{metricsState.data.activeTakeoversCount}</span>
          </div>
          <div className={styles.metricCard}>
            <span className={styles.metricLabel}>Avg Resolution</span>
            <span className={styles.metricValue}>{metricsState.data.avgResolutionMinutes}m</span>
          </div>
        </div>
      )}

      {/* Controls Bar */}
      <div className={styles.controlsBar}>
        <div className={styles.filterGroup}>
          <label className={styles.selectLabel}>
            Status:
            <select
              className={styles.select}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              aria-label="Filter by status"
            >
              <option value="all">All Statuses</option>
              <option value="pending">Pending</option>
              <option value="claimed">Claimed</option>
              <option value="resolved">Resolved</option>
              <option value="dismissed">Dismissed</option>
              <option value="timed_out">Timed Out</option>
            </select>
          </label>

          <label className={styles.selectLabel}>
            Priority:
            <select
              className={styles.select}
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value)}
              aria-label="Filter by priority"
            >
              <option value="all">All Priorities</option>
              <option value="P0_CRITICAL">P0 Critical</option>
              <option value="P1_HIGH">P1 High</option>
              <option value="P2_MEDIUM">P2 Medium</option>
              <option value="P3_LOW">P3 Low</option>
            </select>
          </label>
        </div>
      </div>

      {/* Main Table */}
      {itemsState.status !== 'success' ? (
        <AsyncState
          status={itemsState.status === 'loading' ? 'loading' : 'error'}
          error={itemsState.error}
        />
      ) : (
        <DataTable
          columns={columns}
          data={itemsState.data.items}
          keyExtractor={(item) => item.id}
          emptyMessage="No attention items matching selected filters."
          ariaLabel="Attention items queue table"
        />
      )}

      {/* Resolution Modal */}
      {resolvingItem && (
        <div className={styles.modalBackdrop} role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <div className={styles.modal}>
            <h2 className={styles.modalTitle} id="modal-title">Resolve Attention Item</h2>
            <p style={{ fontSize: '13px', color: 'var(--color-ink-muted)', margin: 0 }}>
              Resolving: <strong>{resolvingItem.title}</strong>
            </p>

            <form className={styles.modalForm} onSubmit={handleSubmitResolution}>
              <div className={styles.formField}>
                <label className={styles.formLabel} htmlFor="resolution-action-select">Verdict / Action</label>
                <select
                  id="resolution-action-select"
                  className={styles.select}
                  value={resolutionAction}
                  onChange={(e) => setResolutionAction(e.target.value)}
                >
                  <option value="approved">Approve (Proceed with agent action)</option>
                  <option value="rejected">Reject (Deny agent proposal)</option>
                  <option value="overridden">Override (Execute custom payload)</option>
                  <option value="taken_over">Take Over (Manual operator intervention)</option>
                  <option value="dismissed">Dismiss (No action needed)</option>
                </select>
              </div>

              <div className={styles.formField}>
                <label className={styles.formLabel} htmlFor="resolution-notes-input">Resolution Notes</label>
                <textarea
                  id="resolution-notes-input"
                  className={styles.textarea}
                  placeholder="Provide audit notes explaining the decision..."
                  value={resolutionNotes}
                  onChange={(e) => setResolutionNotes(e.target.value)}
                />
              </div>

              <div className={styles.modalActions}>
                <button
                  type="button"
                  className={styles.btnSecondary}
                  onClick={() => setResolvingItem(null)}
                  disabled={submittingResolution}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={styles.btnPrimary}
                  disabled={submittingResolution}
                >
                  {submittingResolution ? 'Submitting...' : 'Submit Resolution'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
