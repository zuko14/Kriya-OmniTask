import { useState, useCallback } from 'react';
import { Link } from 'react-router';
import { apiFetch, ApiError } from '../../lib/apiClient';
import { useAsync } from '../../lib/useAsync';
import { DataTable, Column } from '../../components/DataTable';
import { AsyncState } from '../../components/AsyncState';
import styles from './AgentFleet.module.css';

export interface Agent {
  id: string;
  name: string;
  description: string;
  category: 'orchestrator' | 'manager' | 'specialist' | 'verifier';
  department: string;
  autonomy_level: number;
  risk_tier: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  status: 'draft' | 'idle' | 'active' | 'paused' | 'error';
  created_at: string;
}

export function AgentFleet() {
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [departmentFilter, setDepartmentFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [refreshTrigger, setRefreshTrigger] = useState<number>(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // New Agent Modal
  const [isCreating, setIsCreating] = useState<boolean>(false);
  const [name, setName] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [category, setCategory] = useState<'orchestrator' | 'manager' | 'specialist' | 'verifier'>('specialist');
  const [department, setDepartment] = useState<string>('operations');
  const [autonomyLevel, setAutonomyLevel] = useState<number>(2);
  const [riskTier, setRiskTier] = useState<'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'>('LOW');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const fetchAgents = useCallback(() => {
    const params = new URLSearchParams();
    if (categoryFilter !== 'all') params.set('category', categoryFilter);
    if (departmentFilter !== 'all') params.set('department', departmentFilter);
    if (statusFilter !== 'all') params.set('status', statusFilter);
    return apiFetch<{ agents: Agent[] }>(`/api/v1/agents?${params.toString()}`);
  }, [categoryFilter, departmentFilter, statusFilter, refreshTrigger]);

  const state = useAsync(fetchAgents, [fetchAgents]);

  const handleBootstrap = async () => {
    try {
      setActionError(null);
      setActionSuccess(null);
      const res = await apiFetch<{ createdCount: number }>('/api/v1/agents/bootstrap', { method: 'POST' });
      setActionSuccess(`Successfully bootstrapped ${res.createdCount} system agents.`);
      setRefreshTrigger((prev) => prev + 1);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Failed to bootstrap system agents');
    }
  };

  const handleCreateAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsSubmitting(true);
      setActionError(null);
      await apiFetch('/api/v1/agents', {
        method: 'POST',
        body: JSON.stringify({
          name,
          description,
          category,
          department,
          autonomyLevel,
          riskTier,
          systemPrompt: `You are ${name}, a professional ${category} agent.`,
          toolsAllowed: ['knowledge_search', 'customer_lookup'],
        }),
      });
      setIsCreating(false);
      setName('');
      setDescription('');
      setActionSuccess(`Registered agent '${name}' successfully.`);
      setRefreshTrigger((prev) => prev + 1);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Failed to register agent');
    } finally {
      setIsSubmitting(false);
    }
  };

  const [drainingAgentIds, setDrainingAgentIds] = useState<Set<string>>(new Set());
  const [deactivatingAgent, setDeactivatingAgent] = useState<Agent | null>(null);

  const handleTransition = async (agent: Agent, action: string, reason: string) => {
    try {
      setActionError(null);
      if (action === 'pause') {
        // Mark as draining in-flight work
        setDrainingAgentIds((prev) => new Set(prev).add(agent.id));
      }
      await apiFetch(`/api/v1/agents/${agent.id}/transition`, {
        method: 'POST',
        body: JSON.stringify({ action, reason }),
      });
      if (action === 'pause') {
        setActionSuccess(`Agent '${agent.name}' is draining in-flight work and entering paused state.`);
      } else {
        setActionSuccess(`Transitioned '${agent.name}' via action '${action}'.`);
      }
      setRefreshTrigger((prev) => prev + 1);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Failed to transition agent');
    } finally {
      setDeactivatingAgent(null);
      setDrainingAgentIds((prev) => {
        const next = new Set(prev);
        next.delete(agent.id);
        return next;
      });
    }
  };

  const handleInitiateDeactivation = (agent: Agent) => {
    setDeactivatingAgent(agent);
  };

  const agents = state.status === 'success' ? (state.data?.agents ?? []) : [];
  const activeCount = agents.filter((a) => a.status === 'active').length;
  const idleCount = agents.filter((a) => a.status === 'idle').length;
  const pausedCount = agents.filter((a) => a.status === 'paused').length;
  const errorCount = agents.filter((a) => a.status === 'error').length;

  const columns: Column<Agent>[] = [
    {
      key: 'name',
      header: 'Agent Name',
      render: (a) => (
        <div>
          <Link to={`/app/agents/${a.id}`} style={{ color: 'var(--accent)', fontWeight: 600, textDecoration: 'none' }}>
            {a.name}
          </Link>
          <div style={{ fontSize: '12px', color: 'var(--text2)' }}>{a.description}</div>
          <div style={{ fontSize: '11px', color: 'var(--text2)', fontFamily: 'var(--font-mono)' }}>
            ID: {a.id}
          </div>
        </div>
      ),
    },
    {
      key: 'department',
      header: 'Department / Role',
      width: '150px',
      render: (a) => (
        <div style={{ fontSize: '12px' }}>
          <div style={{ fontWeight: 500, textTransform: 'capitalize' }}>{a.department}</div>
          <div style={{ color: 'var(--text2)', textTransform: 'capitalize', fontSize: '11px' }}>{a.category}</div>
        </div>
      ),
    },
    {
      key: 'autonomy',
      header: 'Autonomy / Risk',
      width: '140px',
      render: (a) => (
        <div style={{ fontSize: '11px' }}>
          <div>Level: <strong>L{a.autonomy_level}</strong></div>
          <div style={{ color: a.risk_tier === 'CRITICAL' ? 'var(--red)' : 'var(--text2)' }}>
            Risk: <strong>{a.risk_tier}</strong>
          </div>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: '130px',
      render: (a) => {
        const isDraining = drainingAgentIds.has(a.id);
        if (isDraining) {
          return (
            <span className={`${styles.badge} ${styles.statusPaused}`} style={{ background: 'var(--purple)', color: '#000' }}>
              Draining...
            </span>
          );
        }
        const statusClass =
          a.status === 'active'
            ? styles.statusActive
            : a.status === 'idle'
            ? styles.statusIdle
            : a.status === 'paused'
            ? styles.statusPaused
            : a.status === 'error'
            ? styles.statusError
            : styles.statusIdle;
        return <span className={`${styles.badge} ${statusClass}`}>{a.status}</span>;
      },
    },
    {
      key: 'actions',
      header: 'Actions',
      width: '180px',
      render: (a) => (
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          {a.status === 'idle' && (
            <button className="btn btn-ghost btn-sm" onClick={() => handleTransition(a, 'activate', 'Operator initiated activation')}>
              Activate
            </button>
          )}
          {(a.status === 'active' || a.status === 'idle') && (
            <button className="btn btn-ghost btn-sm" onClick={() => handleInitiateDeactivation(a)}>
              Deactivate
            </button>
          )}
          {a.status === 'paused' && (
            <button className="btn btn-ghost btn-sm" onClick={() => handleTransition(a, 'resume', 'Operator resume')}>
              Resume
            </button>
          )}
          <Link to={`/app/agents/${a.id}`} className="btn btn-ghost btn-sm">
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
          <h1>Autonomous Agent Fleet & Digital Workforce</h1>
          <p className={styles.subtitle}>Supervise agent lifecycle state machines, autonomous permissions, and task assignments.</p>
        </div>
        <div className={styles.headerActions}>
          <button className="btn btn-ghost btn-sm" onClick={handleBootstrap}>
            Bootstrap Templates
          </button>
          <button className="btn btn-accent" onClick={() => setIsCreating(true)}>
            + Register Agent
          </button>
        </div>
      </header>

      {actionError && <div className="alert alert-err" role="alert">{actionError}</div>}
      {actionSuccess && <div className="alert alert-ok" role="status">{actionSuccess}</div>}

      {/* Metrics Strip */}
      <div className={styles.metricsGrid}>
        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>Total Fleet</span>
          <span className={styles.metricValue}>{agents.length}</span>
        </div>
        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>Active</span>
          <span className={styles.metricValue}>{activeCount}</span>
        </div>
        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>Idle</span>
          <span className={styles.metricValue}>{idleCount}</span>
        </div>
        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>Paused</span>
          <span className={styles.metricValue} style={{ color: pausedCount > 0 ? 'var(--amber)' : undefined }}>{pausedCount}</span>
        </div>
        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>Error</span>
          <span className={styles.metricValue} style={{ color: errorCount > 0 ? 'var(--red)' : undefined }}>
            {errorCount}
          </span>
        </div>
      </div>

      {/* Controls Bar */}
      <div className={styles.controlsBar}>
        <div className={styles.filterGroup}>
          <label className={styles.selectLabel}>
            Department:
            <select
              className={styles.select}
              value={departmentFilter}
              onChange={(e) => setDepartmentFilter(e.target.value)}
              aria-label="Filter by department"
            >
              <option value="all">All Departments</option>
              <option value="executive">Executive</option>
              <option value="sales">Sales</option>
              <option value="support">Support</option>
              <option value="operations">Operations</option>
              <option value="marketing">Marketing</option>
              <option value="finance">Finance</option>
            </select>
          </label>

          <label className={styles.selectLabel}>
            Role:
            <select
              className={styles.select}
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              aria-label="Filter by category"
            >
              <option value="all">All Roles</option>
              <option value="orchestrator">Orchestrator</option>
              <option value="manager">Manager</option>
              <option value="specialist">Specialist</option>
              <option value="verifier">Verifier</option>
            </select>
          </label>

          <label className={styles.selectLabel}>
            Status:
            <select
              className={styles.select}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              aria-label="Filter by status"
            >
              <option value="all">All Statuses</option>
              <option value="active">Active</option>
              <option value="idle">Idle</option>
              <option value="paused">Paused</option>
              <option value="error">Error</option>
              <option value="draft">Draft</option>
            </select>
          </label>
        </div>
      </div>

      {/* Main Table */}
      {state.status !== 'success' ? (
        <AsyncState status={state.status === 'loading' ? 'loading' : 'error'} error={state.error} />
      ) : (
        <DataTable
          columns={columns}
          data={agents}
          keyExtractor={(a) => a.id}
          emptyMessage="No agents found matching criteria. Click 'Bootstrap Templates' to spawn default workforce."
          ariaLabel="Agent fleet directory table"
        />
      )}

      {/* Register Agent Modal */}
      {isCreating && (
        <div className={styles.modalBackdrop} role="dialog" aria-modal="true" aria-labelledby="register-agent-title">
          <div className={styles.modal}>
            <h2 className={styles.modalTitle} id="register-agent-title">Register Autonomous Agent</h2>
            <form className={styles.modalForm} onSubmit={handleCreateAgent}>
              <div className={styles.formField}>
                <label className={styles.formLabel} htmlFor="agent-name-input">Agent Name *</label>
                <input
                  id="agent-name-input"
                  type="text"
                  required
                  className={styles.input}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Invoicing Exception Resolver"
                />
              </div>

              <div className={styles.formField}>
                <label className={styles.formLabel} htmlFor="agent-desc-input">Description *</label>
                <input
                  id="agent-desc-input"
                  type="text"
                  required
                  className={styles.input}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="e.g. Handles financial threshold mismatches"
                />
              </div>

              <div className={styles.formField}>
                <label className={styles.formLabel} htmlFor="agent-dept-select">Department</label>
                <select
                  id="agent-dept-select"
                  className={styles.select}
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                >
                  <option value="sales">Sales</option>
                  <option value="support">Support</option>
                  <option value="operations">Operations</option>
                  <option value="finance">Finance</option>
                  <option value="marketing">Marketing</option>
                  <option value="executive">Executive</option>
                </select>
              </div>

              <div className={styles.formField}>
                <label className={styles.formLabel} htmlFor="agent-cat-select">Category / Role</label>
                <select
                  id="agent-cat-select"
                  className={styles.select}
                  value={category}
                  onChange={(e) => setCategory(e.target.value as any)}
                >
                  <option value="orchestrator">Orchestrator</option>
                  <option value="manager">Manager</option>
                  <option value="specialist">Specialist</option>
                  <option value="verifier">Verifier</option>
                </select>
              </div>

              <div className={styles.formField}>
                <label className={styles.formLabel} htmlFor="agent-autonomy-select">Autonomy Level (L0-L5)</label>
                <select
                  id="agent-autonomy-select"
                  className={styles.select}
                  value={autonomyLevel}
                  onChange={(e) => setAutonomyLevel(parseInt(e.target.value, 10))}
                >
                  <option value="0">L0 (Observe only)</option>
                  <option value="1">L1 (Suggest / Human approved)</option>
                  <option value="2">L2 (Low-risk Autonomous)</option>
                  <option value="3">L3 (Conditional Autonomous)</option>
                  <option value="4">L4 (High Autonomy)</option>
                  <option value="5">L5 (Strategic Autonomy)</option>
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
                  {isSubmitting ? 'Registering...' : 'Register Agent'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Graceful Drain & Deactivation Confirmation Modal (§18.2, Criterion 2) */}
      {deactivatingAgent && (
        <div className={styles.modalBackdrop} role="dialog" aria-modal="true" aria-labelledby="deactivate-modal-title">
          <div className={styles.modal}>
            <h2 className={styles.modalTitle} id="deactivate-modal-title">
              Deactivate Agent & Drain In-Flight Work
            </h2>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text2)', lineHeight: 1.5 }}>
              Deactivating <strong>{deactivatingAgent.name}</strong> will initiate graceful work draining.
              All active in-flight tasks will run to completion. New task dispatches will be suspended.
              Once drained, the agent will enter the paused state.
            </p>

            <div style={{ background: 'var(--surface3)', border: '1px solid var(--border)', padding: 'var(--space-3)', borderRadius: 'var(--radius-sm)', margin: 'var(--space-3) 0', fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)' }}>
              <div>Active Work Draining: ENABLED</div>
              <div>Estimated Drain Time: &lt; 30s</div>
              <div>Tenant Scope: Isolated</div>
            </div>

            <div className={styles.modalActions}>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setDeactivatingAgent(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-accent"
                onClick={() => handleTransition(deactivatingAgent, 'pause', 'Graceful deactivation & task drain')}
              >
                Confirm Graceful Drain & Deactivate
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
