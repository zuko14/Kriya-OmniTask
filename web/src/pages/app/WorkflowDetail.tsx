import { useState, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router';
import { apiFetch, ApiError } from '../../lib/apiClient';
import { useAsync } from '../../lib/useAsync';
import { DataTable, Column } from '../../components/DataTable';
import { AsyncState } from '../../components/AsyncState';
import styles from './WorkflowDetail.module.css';

export interface DAGStepItem {
  id: string;
  name: string;
  type: string;
  dependsOn: string[];
  config: Record<string, unknown>;
}

export interface WorkflowDetailRecord {
  id: string;
  tenant_id: string;
  slug: string;
  name: string;
  description: string;
  trigger_type: string;
  dag_json: string;
  is_active: number;
  version: string;
  created_at: string;
}

export interface WorkflowExecutionItem {
  id: string;
  workflow_id: string;
  status: string;
  current_step_id: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export function WorkflowDetail() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();

  const [refreshTrigger, setRefreshTrigger] = useState<number>(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [isTriggering, setIsTriggering] = useState<boolean>(false);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [showConfirmDelete, setShowConfirmDelete] = useState<boolean>(false);

  const fetchWorkflow = useCallback(() => {
    if (!slug) throw new Error('No workflow slug provided');
    return apiFetch<WorkflowDetailRecord>(`/api/v1/workflows/${slug}`);
  }, [slug, refreshTrigger]);

  const fetchExecutions = useCallback(() => {
    return apiFetch<{ total: number; executions: WorkflowExecutionItem[] }>('/api/v1/workflows/executions');
  }, [refreshTrigger]);

  const workflowState = useAsync(fetchWorkflow, [fetchWorkflow]);
  const executionsState = useAsync(fetchExecutions, [fetchExecutions]);

  const handleTrigger = async () => {
    if (!slug) return;
    try {
      setIsTriggering(true);
      setActionError(null);
      await apiFetch(`/api/v1/workflows/${slug}/trigger`, {
        method: 'POST',
        body: JSON.stringify({ context: {} }),
      });
      setActionSuccess(`Workflow execution triggered successfully.`);
      setRefreshTrigger((prev) => prev + 1);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Failed to trigger workflow');
    } finally {
      setIsTriggering(false);
    }
  };

  const handleDelete = async () => {
    if (!slug) return;
    try {
      setIsDeleting(true);
      setActionError(null);
      await apiFetch(`/api/v1/workflows/${slug}`, { method: 'DELETE' });
      navigate('/app/workflows');
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Failed to delete workflow');
      setIsDeleting(false);
      setShowConfirmDelete(false);
    }
  };

  if (workflowState.status !== 'success') {
    return (
      <div className={styles.container}>
        <Link to="/app/workflows" className={styles.backLink}>← Back to Workflows</Link>
        <AsyncState status={workflowState.status === 'loading' ? 'loading' : 'error'} error={workflowState.error} />
      </div>
    );
  }

  const wf = workflowState.data;
  let steps: DAGStepItem[] = [];
  try {
    const parsed = JSON.parse(wf.dag_json);
    steps = parsed.steps || [];
  } catch {
    // fallback
  }

  const executions = executionsState.status === 'success' ? executionsState.data.executions : [];

  const executionColumns: Column<WorkflowExecutionItem>[] = [
    {
      key: 'id',
      header: 'Execution ID',
      render: (e) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px' }}>{e.id}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      width: '130px',
      render: (e) => (
        <span
          className={styles.badge}
          style={{
            background: e.status === 'completed' ? 'rgba(63, 166, 107, 0.15)' : 'rgba(76, 134, 214, 0.15)',
            color: e.status === 'completed' ? 'var(--color-verify)' : 'var(--color-signal)',
          }}
        >
          {e.status}
        </span>
      ),
    },
    {
      key: 'current_step',
      header: 'Current Step',
      width: '180px',
      render: (e) => <span style={{ fontSize: '12px' }}>{e.current_step_id || 'Finished'}</span>,
    },
    {
      key: 'created_at',
      header: 'Started At',
      width: '160px',
      render: (e) => <span style={{ fontSize: '11px', color: 'var(--color-ink-muted)' }}>{new Date(e.created_at).toLocaleString()}</span>,
    },
  ];

  return (
    <div className={styles.container}>
      <Link to="/app/workflows" className={styles.backLink}>← Back to Workflows</Link>

      {actionError && <div className={styles.errorBanner}>⚠️ {actionError}</div>}
      {actionSuccess && <div className={styles.successBanner}>✓ {actionSuccess}</div>}

      {/* Header Card */}
      <div className={styles.headerCard}>
        <div className={styles.headerInfo}>
          <h1>{wf.name}</h1>
          <p style={{ fontSize: '13px', color: 'var(--color-ink-muted)', margin: '4px 0 8px 0' }}>{wf.description}</p>
          <div className={styles.headerMeta}>
            <span>Slug: <strong style={{ fontFamily: 'var(--font-mono)' }}>{wf.slug}</strong></span>
            <span>Trigger: <strong style={{ textTransform: 'capitalize' }}>{wf.trigger_type}</strong></span>
            <span>Version: <strong>{wf.version}</strong></span>
          </div>
        </div>

        <div className={styles.headerActions}>
          <button className={styles.btnPrimary} onClick={handleTrigger} disabled={isTriggering}>
            {isTriggering ? 'Triggering...' : 'Trigger Execution'}
          </button>
        </div>
      </div>

      {/* Visual DAG Step Pipeline */}
      <div className={styles.sectionCard}>
        <h2 className={styles.sectionTitle}>DAG Pipeline Steps ({steps.length})</h2>
        {steps.length === 0 ? (
          <div style={{ color: 'var(--color-ink-muted)', fontSize: '13px' }}>No steps defined in this workflow DAG.</div>
        ) : (
          <div className={styles.stepsList}>
            {steps.map((step, idx) => (
              <div key={step.id} className={styles.stepCard}>
                <div className={styles.stepInfo}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                    <span style={{ fontSize: '12px', color: 'var(--color-ink-muted)', fontWeight: 600 }}>#{idx + 1}</span>
                    <span className={styles.stepName}>{step.name}</span>
                    <span className={`${styles.badge} ${styles.badgeStepType}`}>{step.type.replace('_', ' ')}</span>
                  </div>
                  <div className={styles.stepMeta}>
                    ID: {step.id} · Depends on: {step.dependsOn.length > 0 ? step.dependsOn.join(', ') : 'Root step (None)'}
                  </div>
                  <pre style={{ background: 'var(--color-surface)', padding: 'var(--space-2)', borderRadius: 'var(--radius-sm)', fontSize: '11px', color: 'var(--color-ink-muted)', margin: 'var(--space-1) 0 0 0', overflowX: 'auto' }}>
                    {JSON.stringify(step.config, null, 2)}
                  </pre>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent Executions */}
      <div className={styles.sectionCard}>
        <h2 className={styles.sectionTitle}>Recent Workflow Executions</h2>
        <DataTable
          columns={executionColumns}
          data={executions}
          keyExtractor={(e) => e.id}
          emptyMessage="No executions recorded for this workflow pipeline yet."
          ariaLabel="Recent workflow executions table"
        />
      </div>

      {/* Delete / Deregister Zone */}
      <div className={styles.sectionCard} style={{ borderTop: '1px solid var(--color-border)' }}>
        <h2 className={styles.sectionTitle} style={{ color: 'var(--color-critical)' }}>Delete Workflow Pipeline</h2>
        <p style={{ fontSize: '13px', color: 'var(--color-ink-muted)', margin: 0 }}>
          Permanently delete this workflow definition. Active executions will terminate.
        </p>
        {!showConfirmDelete ? (
          <button className={styles.btnDanger} onClick={() => setShowConfirmDelete(true)} style={{ alignSelf: 'flex-start' }}>
            Delete Workflow
          </button>
        ) : (
          <div style={{ background: 'rgba(216, 87, 75, 0.1)', padding: 'var(--space-4)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-critical)' }}>
            <p style={{ fontSize: '13px', color: 'var(--color-critical)', margin: '0 0 var(--space-3) 0', fontWeight: 600 }}>
              ⚠️ Are you sure you want to permanently delete workflow '{wf.name}'?
            </p>
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <button className={styles.btnDanger} onClick={handleDelete} disabled={isDeleting}>
                {isDeleting ? 'Deleting...' : 'Yes, Permanently Delete'}
              </button>
              <button className={styles.btnSecondary} onClick={() => setShowConfirmDelete(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
