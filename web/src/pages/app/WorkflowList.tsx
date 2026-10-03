import { useState, useCallback } from 'react';
import { Link } from 'react-router';
import { apiFetch, ApiError } from '../../lib/apiClient';
import { useAsync } from '../../lib/useAsync';
import { DataTable, Column } from '../../components/DataTable';
import { AsyncState } from '../../components/AsyncState';
import styles from './WorkflowList.module.css';
import { Icon } from '../../components/brand/Icon';

export interface WorkflowDefinition {
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

export interface WorkflowApproval {
  id: string;
  execution_id: string;
  step_id: string;
  status: string;
  required_role: string;
  step_payload_json: string;
  created_at: string;
}

export function WorkflowList() {
  const [refreshTrigger, setRefreshTrigger] = useState<number>(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // New Workflow Modal
  const [isCreating, setIsCreating] = useState<boolean>(false);
  const [name, setName] = useState<string>('');
  const [slug, setSlug] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [triggerType, setTriggerType] = useState<'manual' | 'webhook' | 'event' | 'schedule'>('manual');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const fetchWorkflows = useCallback(() => {
    return apiFetch<{ total: number; workflows: WorkflowDefinition[] }>('/api/v1/workflows');
  }, [refreshTrigger]);

  const fetchApprovals = useCallback(() => {
    return apiFetch<{ total: number; approvals: WorkflowApproval[] }>('/api/v1/workflows/approvals');
  }, [refreshTrigger]);

  const workflowsState = useAsync(fetchWorkflows, [fetchWorkflows]);
  const approvalsState = useAsync(fetchApprovals, [fetchApprovals]);

  const handleTrigger = async (workflow: WorkflowDefinition) => {
    try {
      setActionError(null);
      setActionSuccess(null);
      await apiFetch(`/api/v1/workflows/${workflow.slug}/trigger`, {
        method: 'POST',
        body: JSON.stringify({ context: {} }),
      });
      setActionSuccess(`Triggered execution for workflow '${workflow.name}'.`);
      setRefreshTrigger((prev) => prev + 1);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Failed to trigger workflow');
    }
  };

  const handleDecideApproval = async (approval: WorkflowApproval, decision: 'approved' | 'rejected') => {
    try {
      setActionError(null);
      await apiFetch('/api/v1/workflows/approvals/decide', {
        method: 'POST',
        body: JSON.stringify({
          executionId: approval.execution_id,
          stepId: approval.step_id,
          decision,
          notes: `Decided ${decision} from Workflows portal`,
        }),
      });
      setActionSuccess(`Decided approval: ${decision.toUpperCase()}.`);
      setRefreshTrigger((prev) => prev + 1);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Failed to decide approval');
    }
  };

  const handleCreateWorkflow = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsSubmitting(true);
      setActionError(null);
      await apiFetch('/api/v1/workflows', {
        method: 'POST',
        body: JSON.stringify({
          name,
          slug,
          description,
          triggerType,
          dag: {
            steps: [
              {
                id: 'step_initial_analyze',
                name: 'Initial Analysis',
                type: 'agent_task',
                dependsOn: [],
                config: { agentSlug: 'executive_analyst', objective: 'Analyze event context' },
              },
            ],
          },
          isActive: true,
          version: '1.0.0',
        }),
      });
      setIsCreating(false);
      setName('');
      setSlug('');
      setDescription('');
      setActionSuccess(`Created workflow '${name}' successfully.`);
      setRefreshTrigger((prev) => prev + 1);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Failed to create workflow');
    } finally {
      setIsSubmitting(false);
    }
  };

  const workflows = workflowsState.status === 'success' ? (workflowsState.data?.workflows ?? []) : [];
  const approvals = approvalsState.status === 'success' ? (approvalsState.data?.approvals ?? []) : [];
  const activeCount = workflows.filter((w) => w.is_active === 1 || (w.is_active as any) === true).length;

  const columns: Column<WorkflowDefinition>[] = [
    {
      key: 'name',
      header: 'Workflow Name',
      render: (w) => (
        <div>
          <Link to={`/app/workflows/${w.slug}`} style={{ color: 'var(--accent)', fontWeight: 600, textDecoration: 'none' }}>
            {w.name}
          </Link>
          <div style={{ fontSize: '12px', color: 'var(--text2)' }}>{w.description}</div>
          <div style={{ fontSize: '11px', color: 'var(--text2)', fontFamily: 'var(--font-mono)' }}>
            Slug: {w.slug} · v{w.version}
          </div>
        </div>
      ),
    },
    {
      key: 'trigger_type',
      header: 'Trigger Type',
      width: '130px',
      render: (w) => <span style={{ textTransform: 'capitalize', fontSize: '12px' }}>{w.trigger_type}</span>,
    },
    {
      key: 'steps',
      header: 'DAG Steps',
      width: '110px',
      render: (w) => {
        try {
          const stepCount = JSON.parse(w.dag_json).steps?.length || 0;
          return <span style={{ fontSize: '12px' }}>{stepCount} steps</span>;
        } catch {
          return <span style={{ fontSize: '12px', color: 'var(--red)' }}>Unreadable DAG</span>;
        }
      },
    },
    {
      key: 'status',
      header: 'Status',
      width: '100px',
      render: (w) => {
        const isActive = w.is_active === 1 || (w.is_active as any) === true;
        return <span className={`${styles.badge} ${isActive ? styles.badgeActive : styles.badgeInactive}`}>{isActive ? 'Active' : 'Disabled'}</span>;
      },
    },
    {
      key: 'actions',
      header: 'Actions',
      width: '180px',
      render: (w) => (
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button className="btn btn-ghost btn-sm" onClick={() => handleTrigger(w)}>
            Trigger
          </button>
          <Link to={`/app/workflows/${w.slug}`} className="btn btn-ghost btn-sm">
            Details →
          </Link>
        </div>
      ),
    },
  ];

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.titleGroup}>
          <h1>Workflow Orchestration & Pipelines</h1>
          <p className={styles.subtitle}>Multi-agent DAG executions, conditional branching, and human-in-the-loop approvals.</p>
        </div>
        <div className={styles.headerActions}>
          <button className="btn btn-accent" onClick={() => setIsCreating(true)}>
            + Create Workflow
          </button>
        </div>
      </header>

      {actionError && <div className="alert alert-err" role="alert">{actionError}</div>}
      {actionSuccess && <div className="alert alert-ok" role="status">{actionSuccess}</div>}

      {/* Metrics Grid */}
      <div className={styles.metricsGrid}>
        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>Total Pipelines</span>
          <span className={styles.metricValue}>{workflows.length}</span>
        </div>
        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>Active</span>
          <span className={styles.metricValue}>{activeCount}</span>
        </div>
        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>Pending Approvals</span>
          <span className={styles.metricValue} style={{ color: approvals.length > 0 ? 'var(--amber)' : undefined }}>
            {approvals.length}
          </span>
        </div>
      </div>

      {/* Pending Approvals Strip */}
      {approvals.length > 0 && (
        <div className={styles.approvalsSection}>
          <h3 className={styles.approvalsTitle}><Icon name="alert" /> Pending Workflow Approval Gates ({approvals.length})</h3>
          {approvals.map((appr) => (
            <div key={appr.id} className={styles.approvalCard}>
              <div>
                <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text)' }}>
                  Execution: <code style={{ fontFamily: 'var(--font-mono)' }}>{appr.execution_id}</code> · Step: <code>{appr.step_id}</code>
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text2)' }}>
                  Required Role: {appr.required_role} · Created: {new Date(appr.created_at).toLocaleTimeString()}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                <button className="btn btn-success btn-sm" onClick={() => handleDecideApproval(appr, 'approved')}>
                  Approve
                </button>
                <button className="btn btn-danger btn-sm" onClick={() => handleDecideApproval(appr, 'rejected')}>
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Main Table */}
      {workflowsState.status !== 'success' ? (
        <AsyncState status={workflowsState.status === 'loading' ? 'loading' : 'error'} error={workflowsState.error} />
      ) : (
        <DataTable
          columns={columns}
          data={workflows}
          keyExtractor={(w) => w.id}
          emptyMessage="No workflows configured yet."
          ariaLabel="Workflows list table"
        />
      )}

      {/* Create Workflow Modal */}
      {isCreating && (
        <div className={styles.modalBackdrop} role="dialog" aria-modal="true" aria-labelledby="create-workflow-title">
          <div className={styles.modal}>
            <h2 className={styles.modalTitle} id="create-workflow-title">Create Workflow Definition</h2>
            <form className={styles.modalForm} onSubmit={handleCreateWorkflow}>
              <div className={styles.formField}>
                <label className={styles.formLabel} htmlFor="wf-name-input">Workflow Name *</label>
                <input
                  id="wf-name-input"
                  type="text"
                  required
                  className={styles.input}
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (!slug) setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
                  }}
                  placeholder="e.g. Inbound Lead Qualification & CRM Sync"
                />
              </div>

              <div className={styles.formField}>
                <label className={styles.formLabel} htmlFor="wf-slug-input">Slug *</label>
                <input
                  id="wf-slug-input"
                  type="text"
                  required
                  className={styles.input}
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  placeholder="e.g. inbound-lead-qualification"
                />
              </div>

              <div className={styles.formField}>
                <label className={styles.formLabel} htmlFor="wf-desc-input">Description *</label>
                <input
                  id="wf-desc-input"
                  type="text"
                  required
                  className={styles.input}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="e.g. End-to-end pipeline from lead ingestion to CRM record"
                />
              </div>

              <div className={styles.formField}>
                <label className={styles.formLabel} htmlFor="wf-trigger-select">Trigger Type</label>
                <select
                  id="wf-trigger-select"
                  className={styles.select}
                  value={triggerType}
                  onChange={(e) => setTriggerType(e.target.value as any)}
                >
                  <option value="manual">Manual Trigger</option>
                  <option value="webhook">Inbound Webhook</option>
                  <option value="event">Event Bus Stream</option>
                  <option value="schedule">Scheduled Cron</option>
                </select>
              </div>

              <div className={styles.modalActions}>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setIsCreating(false)}
                  disabled={isSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-accent"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'Creating...' : 'Create Workflow'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
