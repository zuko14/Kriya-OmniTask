import { useState, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router';
import { apiFetch, ApiError } from '../../lib/apiClient';
import { useAsync } from '../../lib/useAsync';
import { DataTable, Column } from '../../components/DataTable';
import { AsyncState } from '../../components/AsyncState';
import styles from './AgentDetail.module.css';

export interface AgentDetailRecord {
  id: string;
  name: string;
  description: string;
  category: 'orchestrator' | 'manager' | 'specialist' | 'verifier';
  department: string;
  autonomy_level: number;
  risk_tier: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  status: 'draft' | 'idle' | 'active' | 'paused' | 'error';
  system_prompt?: string;
  model_policy_json?: string;
  tools_allowed_json?: string;
  escalation_rules_json?: string;
  created_at: string;
}

export interface TransitionHistoryItem {
  id: string;
  agent_id: string;
  from_state: string;
  to_state: string;
  action: string;
  reason: string;
  actor_type: string;
  created_at: string;
}

export function AgentDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [refreshTrigger, setRefreshTrigger] = useState<number>(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [showConfirmDelete, setShowConfirmDelete] = useState<boolean>(false);

  const fetchAgent = useCallback(() => {
    if (!id) throw new Error('No agent ID provided');
    return apiFetch<{ agent: AgentDetailRecord }>(`/api/v1/agents/${id}`);
  }, [id, refreshTrigger]);

  const fetchHistory = useCallback(() => {
    if (!id) throw new Error('No agent ID provided');
    return apiFetch<{ history: TransitionHistoryItem[] }>(`/api/v1/agents/${id}/history`);
  }, [id, refreshTrigger]);

  const agentState = useAsync(fetchAgent, [fetchAgent]);
  const historyState = useAsync(fetchHistory, [fetchHistory]);

  const handleTransition = async (action: string, reason: string) => {
    if (!id) return;
    try {
      setActionError(null);
      await apiFetch(`/api/v1/agents/${id}/transition`, {
        method: 'POST',
        body: JSON.stringify({ action, reason }),
      });
      setActionSuccess(`Successfully applied state machine action '${action}'.`);
      setRefreshTrigger((prev) => prev + 1);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Failed to execute transition');
    }
  };

  const handleDelete = async () => {
    if (!id) return;
    try {
      setIsDeleting(true);
      setActionError(null);
      await apiFetch(`/api/v1/agents/${id}`, { method: 'DELETE' });
      navigate('/app/agents');
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Failed to delete agent');
      setIsDeleting(false);
      setShowConfirmDelete(false);
    }
  };

  if (agentState.status !== 'success') {
    return (
      <div className={styles.container}>
        <Link to="/app/agents" className={styles.backLink}>← Back to Fleet Directory</Link>
        <AsyncState status={agentState.status === 'loading' ? 'loading' : 'error'} error={agentState.error} />
      </div>
    );
  }

  const agent = agentState.data.agent;
  const history = historyState.status === 'success' ? historyState.data.history : [];

  let modelPolicy = { primaryModel: 'gemini-2.5-pro', temperature: 0.2, maxTokens: 4096 };
  try {
    if (agent.model_policy_json) {
      modelPolicy = JSON.parse(agent.model_policy_json);
    }
  } catch {
    // fallback default
  }

  let toolsAllowed: string[] = [];
  try {
    if (agent.tools_allowed_json) {
      toolsAllowed = JSON.parse(agent.tools_allowed_json);
    }
  } catch {
    // fallback default
  }

  const historyColumns: Column<TransitionHistoryItem>[] = [
    {
      key: 'action',
      header: 'Action',
      width: '120px',
      render: (h) => <strong>{h.action}</strong>,
    },
    {
      key: 'transition',
      header: 'State Shift',
      width: '180px',
      render: (h) => (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px' }}>
          {h.from_state} → {h.to_state}
        </span>
      ),
    },
    {
      key: 'reason',
      header: 'Reason',
      render: (h) => (
        <div style={{ fontSize: '12px' }}>
          <div>{h.reason}</div>
          <div style={{ fontSize: '11px', color: 'var(--color-ink-muted)' }}>Actor: {h.actor_type}</div>
        </div>
      ),
    },
    {
      key: 'timestamp',
      header: 'Timestamp',
      width: '160px',
      render: (h) => <span style={{ fontSize: '11px', color: 'var(--color-ink-muted)' }}>{new Date(h.created_at).toLocaleString()}</span>,
    },
  ];

  return (
    <div className={styles.container}>
      <Link to="/app/agents" className={styles.backLink}>← Back to Fleet Directory</Link>

      {actionError && <div className={styles.errorBanner}>⚠️ {actionError}</div>}
      {actionSuccess && <div className={styles.successBanner}>✓ {actionSuccess}</div>}

      {/* Header Card */}
      <div className={styles.headerCard}>
        <div className={styles.headerInfo}>
          <h1>{agent.name}</h1>
          <p style={{ fontSize: '13px', color: 'var(--color-ink-muted)', margin: '4px 0 8px 0' }}>{agent.description}</p>
          <div className={styles.headerMeta}>
            <span>ID: <strong style={{ fontFamily: 'var(--font-mono)' }}>{agent.id}</strong></span>
            <span>Department: <strong>{agent.department.toUpperCase()}</strong></span>
            <span>Role: <strong>{agent.category.toUpperCase()}</strong></span>
          </div>
        </div>

        <div className={styles.headerActions}>
          <span className={`${styles.badge} ${agent.status === 'active' ? styles.statusActive : agent.status === 'paused' ? styles.statusPaused : styles.statusIdle}`}>
            {agent.status}
          </span>
          {agent.status === 'draft' && (
            <button className={styles.btnPrimary} onClick={() => handleTransition('publish', 'Operator publish to idle')}>
              Publish
            </button>
          )}
          {agent.status === 'idle' && (
            <button className={styles.btnPrimary} onClick={() => handleTransition('activate', 'Operator activation')}>
              Activate
            </button>
          )}
          {(agent.status === 'active' || agent.status === 'idle') && (
            <button className={styles.btnSecondary} onClick={() => handleTransition('pause', 'Operator manual pause')}>
              Pause
            </button>
          )}
          {agent.status === 'paused' && (
            <button className={styles.btnPrimary} onClick={() => handleTransition('resume', 'Operator manual resume')}>
              Resume
            </button>
          )}
          {agent.status === 'error' && (
            <button className={styles.btnPrimary} onClick={() => handleTransition('recover', 'Operator recovery reset')}>
              Recover
            </button>
          )}
        </div>
      </div>

      {/* Specs Grid */}
      <div className={styles.specsGrid}>
        <div className={styles.specCard}>
          <span className={styles.specLabel}>Autonomy Level</span>
          <span className={styles.specValue}>Level {agent.autonomy_level}</span>
        </div>
        <div className={styles.specCard}>
          <span className={styles.specLabel}>Risk Governance</span>
          <span className={styles.specValue} style={{ color: agent.risk_tier === 'CRITICAL' ? 'var(--color-critical)' : 'var(--color-ink)' }}>
            {agent.risk_tier}
          </span>
        </div>
        <div className={styles.specCard}>
          <span className={styles.specLabel}>Primary Model</span>
          <span className={styles.specValue} style={{ fontFamily: 'var(--font-mono)', fontSize: '13px' }}>
            {modelPolicy.primaryModel}
          </span>
        </div>
        <div className={styles.specCard}>
          <span className={styles.specLabel}>Allowed Tools</span>
          <span className={styles.specValue} style={{ fontSize: '12px' }}>
            {toolsAllowed.length > 0 ? toolsAllowed.join(', ') : 'None'}
          </span>
        </div>
      </div>

      {/* System Prompt / Specification */}
      {agent.system_prompt && (
        <div className={styles.sectionCard}>
          <h2 className={styles.sectionTitle}>System Prompt & Directives</h2>
          <pre style={{ background: 'var(--color-surface-raised)', padding: 'var(--space-3)', borderRadius: 'var(--radius-sm)', fontSize: '12px', whiteSpace: 'pre-wrap', color: 'var(--color-ink)', margin: 0 }}>
            {agent.system_prompt}
          </pre>
        </div>
      )}

      {/* Lifecycle Transition History */}
      <div className={styles.sectionCard}>
        <h2 className={styles.sectionTitle}>Lifecycle State Transition History</h2>
        <DataTable
          columns={historyColumns}
          data={history}
          keyExtractor={(h) => h.id}
          emptyMessage="No historical lifecycle transitions logged for this agent."
          ariaLabel="Agent lifecycle transition table"
        />
      </div>

      {/* Delete / Deregister Zone */}
      <div className={styles.sectionCard} style={{ borderTop: '1px solid var(--color-border)' }}>
        <h2 className={styles.sectionTitle} style={{ color: 'var(--color-critical)' }}>Deregister Agent</h2>
        <p style={{ fontSize: '13px', color: 'var(--color-ink-muted)', margin: 0 }}>
          Permanently remove this agent specification from the tenant registry. Active tasks will be cancelled.
        </p>
        {!showConfirmDelete ? (
          <button className={styles.btnDanger} onClick={() => setShowConfirmDelete(true)} style={{ alignSelf: 'flex-start' }}>
            Deregister Agent
          </button>
        ) : (
          <div style={{ background: 'rgba(216, 87, 75, 0.1)', padding: 'var(--space-4)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-critical)' }}>
            <p style={{ fontSize: '13px', color: 'var(--color-critical)', margin: '0 0 var(--space-3) 0', fontWeight: 600 }}>
              ⚠️ Are you sure you want to permanently delete {agent.name}?
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
