import { useState, useCallback } from 'react';
import { apiFetch, ApiError } from '../../lib/apiClient';
import { useAsync } from '../../lib/useAsync';
import { DataTable, Column } from '../../components/DataTable';
import { AsyncState } from '../../components/AsyncState';
import styles from './PlatformAudit.module.css';

export interface OperatorAuditLog {
  id: string;
  operatorId: string;
  targetTenantId?: string;
  actionType: string;
  reason: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export function PlatformAudit() {
  const [refreshTrigger, setRefreshTrigger] = useState<number>(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Filter
  const [filterAction, setFilterAction] = useState<string>('ALL');

  // Selected Log for JSON Inspection
  const [selectedLog, setSelectedLog] = useState<OperatorAuditLog | null>(null);

  // Manual Audit Log Modal
  const [isLogging, setIsLogging] = useState<boolean>(false);
  const [eventType, setEventType] = useState<string>('manual_security_checkpoint');
  const [targetResource, setTargetResource] = useState<string>('tenant_isolation_boundary');
  const [actionDescription, setActionDescription] = useState<string>('Periodic security checkpoint validation');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const fetchLogs = useCallback(() => {
    return apiFetch<{ logs: OperatorAuditLog[]; count: number }>('/api/v1/admin/audit-logs?limit=100');
  }, [refreshTrigger]);

  const logsState = useAsync(fetchLogs, [fetchLogs]);

  const handleManualLog = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsSubmitting(true);
      setActionError(null);
      await apiFetch('/api/v1/security/audit/log', {
        method: 'POST',
        body: JSON.stringify({
          eventType,
          targetResource,
          action: actionDescription,
          payload: { timestamp: new Date().toISOString(), manuallyLogged: true },
        }),
      });
      setActionSuccess('Chained cryptographic audit event logged.');
      setIsLogging(false);
      setRefreshTrigger((prev) => prev + 1);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Failed to record audit log');
    } finally {
      setIsSubmitting(false);
    }
  };

  const logs = logsState.status === 'success' ? logsState.data.logs : [];
  const filteredLogs = logs.filter((l) => (filterAction === 'ALL' ? true : l.actionType === filterAction));

  const uniqueActions = Array.from(new Set(logs.map((l) => l.actionType)));

  const columns: Column<OperatorAuditLog>[] = [
    {
      key: 'createdAt',
      header: 'Timestamp',
      width: '160px',
      render: (l) => <span style={{ fontSize: '11px', color: 'var(--color-ink-muted)' }}>{new Date(l.createdAt).toLocaleString()}</span>,
    },
    {
      key: 'actionType',
      header: 'Action Type',
      render: (l) => (
        <span className={styles.badge} style={{ background: 'rgba(76, 134, 214, 0.1)', color: 'var(--color-signal)' }}>
          {l.actionType}
        </span>
      ),
    },
    {
      key: 'operatorId',
      header: 'Operator Actor',
      render: (l) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px' }}>{l.operatorId}</span>,
    },
    {
      key: 'targetTenantId',
      header: 'Target Tenant',
      render: (l) => (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px' }}>
          {l.targetTenantId || 'GLOBAL'}
        </span>
      ),
    },
    {
      key: 'reason',
      header: 'Audit Reason',
      render: (l) => <strong>{l.reason}</strong>,
    },
    {
      key: 'actions',
      header: 'Payload',
      width: '100px',
      render: (l) => (
        <button className={styles.btnSecondary} onClick={() => setSelectedLog(l)}>
          Inspect
        </button>
      ),
    },
  ];

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.titleGroup}>
          <h1>Platform Operator Audit Ledger</h1>
          <p className={styles.subtitle}>Immutable tamper-evident record of all operator actions, tenant provisions, and security events.</p>
        </div>
        <div className={styles.headerActions}>
          <button className={styles.btnPrimary} onClick={() => setIsLogging(true)}>
            + Log Security Event
          </button>
        </div>
      </header>

      {actionError && <div style={{ color: 'var(--color-critical)', background: 'rgba(216,87,75,0.1)', padding: 'var(--space-3)', borderRadius: 'var(--radius-sm)' }}>⚠️ {actionError}</div>}
      {actionSuccess && <div style={{ color: 'var(--color-verify)', background: 'rgba(63,166,107,0.1)', padding: 'var(--space-3)', borderRadius: 'var(--radius-sm)' }}>✓ {actionSuccess}</div>}

      <div className={styles.sectionCard}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
          <h2 className={styles.sectionTitle}>Audit Event Logs ({filteredLogs.length} of {logs.length})</h2>
          <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
            <label htmlFor="action-filter-select" style={{ fontSize: '12px', color: 'var(--color-ink-muted)' }}>Action:</label>
            <select
              id="action-filter-select"
              className={styles.select}
              value={filterAction}
              onChange={(e) => setFilterAction(e.target.value)}
            >
              <option value="ALL">All Action Types</option>
              {uniqueActions.map((act) => (
                <option key={act} value={act}>{act}</option>
              ))}
            </select>
          </div>
        </div>

        {logsState.status !== 'success' ? (
          <AsyncState status={logsState.status === 'loading' ? 'loading' : 'error'} error={logsState.error} />
        ) : (
          <DataTable
            columns={columns}
            data={filteredLogs}
            keyExtractor={(l) => l.id}
            emptyMessage="No operator audit events recorded."
            ariaLabel="Operator audit logs table"
          />
        )}
      </div>

      {/* Inspect Metadata Modal */}
      {selectedLog && (
        <div className={styles.modalBackdrop} role="dialog" aria-modal="true" aria-labelledby="inspect-modal-title">
          <div className={styles.modal}>
            <h2 className={styles.modalTitle} id="inspect-modal-title">Audit Event Details: {selectedLog.id}</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              <div><strong>Action:</strong> {selectedLog.actionType}</div>
              <div><strong>Actor:</strong> <code>{selectedLog.operatorId}</code></div>
              <div><strong>Target Tenant:</strong> <code>{selectedLog.targetTenantId || 'GLOBAL'}</code></div>
              <div><strong>Reason:</strong> {selectedLog.reason}</div>
              <div><strong>Timestamp:</strong> {new Date(selectedLog.createdAt).toISOString()}</div>
              <div><strong>Metadata / Payload:</strong></div>
              <textarea
                readOnly
                className={styles.textarea}
                value={JSON.stringify(selectedLog.metadata, null, 2)}
              />
            </div>
            <div className={styles.modalActions}>
              <button className={styles.btnSecondary} onClick={() => setSelectedLog(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manual Audit Log Modal */}
      {isLogging && (
        <div className={styles.modalBackdrop} role="dialog" aria-modal="true" aria-labelledby="log-modal-title">
          <div className={styles.modal}>
            <h2 className={styles.modalTitle} id="log-modal-title">Log Chained Security Event</h2>
            <form onSubmit={handleManualLog} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              <div className={styles.formField}>
                <label className={styles.formLabel} htmlFor="event-type-input">Event Type *</label>
                <input
                  id="event-type-input"
                  type="text"
                  required
                  className={styles.input}
                  value={eventType}
                  onChange={(e) => setEventType(e.target.value)}
                />
              </div>

              <div className={styles.formField}>
                <label className={styles.formLabel} htmlFor="target-resource-input">Target Resource *</label>
                <input
                  id="target-resource-input"
                  type="text"
                  required
                  className={styles.input}
                  value={targetResource}
                  onChange={(e) => setTargetResource(e.target.value)}
                />
              </div>

              <div className={styles.formField}>
                <label className={styles.formLabel} htmlFor="action-desc-input">Action Description *</label>
                <input
                  id="action-desc-input"
                  type="text"
                  required
                  className={styles.input}
                  value={actionDescription}
                  onChange={(e) => setActionDescription(e.target.value)}
                />
              </div>

              <div className={styles.modalActions}>
                <button type="button" className={styles.btnSecondary} onClick={() => setIsLogging(false)} disabled={isSubmitting}>
                  Cancel
                </button>
                <button type="submit" className={styles.btnPrimary} disabled={isSubmitting}>
                  {isSubmitting ? 'Logging...' : 'Record Hash Event'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
