import { useState, useCallback } from 'react';
import { apiFetch, ApiError } from '../../lib/apiClient';
import { useAsync } from '../../lib/useAsync';
import { DataTable, Column } from '../../components/DataTable';
import { AsyncState } from '../../components/AsyncState';
import styles from './PlatformModelHealth.module.css';

export interface ModelRegistryRecord {
  id: string;
  provider: 'google' | 'openai' | 'anthropic' | 'deepseek' | 'local';
  modelIdentifier: string;
  displayName: string;
  status: 'active' | 'deprecated' | 'disabled' | 'experimental';
  contextWindowTokens: number;
  inputCostPer1k: number;
  outputCostPer1k: number;
  capabilities: string[];
}

export interface ModelRoutingDecision {
  id: string;
  taskId: string;
  taskType: string;
  selectedModelId: string;
  selectedProvider: string;
  fallbackOccurred: boolean;
  fallbackChain: string[];
  latencyMs?: number;
  createdAt?: string;
}

export function PlatformModelHealth() {
  const [refreshTrigger, setRefreshTrigger] = useState<number>(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Register Model Modal
  const [isRegistering, setIsRegistering] = useState<boolean>(false);
  const [provider, setProvider] = useState<'google' | 'openai' | 'anthropic' | 'deepseek' | 'local'>('google');
  const [modelIdentifier, setModelIdentifier] = useState<string>('');
  const [displayName, setDisplayName] = useState<string>('');
  const [contextTokens, setContextTokens] = useState<number>(1000000);
  const [inputCost, setInputCost] = useState<number>(0.00015);
  const [outputCost, setOutputCost] = useState<number>(0.0006);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const fetchModels = useCallback(() => {
    return apiFetch<{ models: ModelRegistryRecord[]; count: number }>('/api/v1/model-resilience/models');
  }, [refreshTrigger]);

  const fetchDecisions = useCallback(() => {
    return apiFetch<{ decisions: ModelRoutingDecision[]; count: number }>('/api/v1/model-resilience/decisions?limit=50');
  }, [refreshTrigger]);

  const modelsState = useAsync(fetchModels, [fetchModels]);
  const decisionsState = useAsync(fetchDecisions, [fetchDecisions]);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsSubmitting(true);
      setActionError(null);
      const generatedId = `model_${provider}_${modelIdentifier.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
      await apiFetch('/api/v1/model-resilience/models', {
        method: 'POST',
        body: JSON.stringify({
          id: generatedId,
          provider,
          modelIdentifier,
          displayName,
          status: 'active',
          contextWindowTokens: Number(contextTokens),
          inputCostPer1k: Number(inputCost),
          outputCostPer1k: Number(outputCost),
          capabilities: ['standard_reasoning', 'fast_classification'],
          allowedDataClassifications: ['public', 'internal', 'confidential'],
        }),
      });
      setActionSuccess(`Model '${displayName}' (${modelIdentifier}) registered successfully.`);
      setIsRegistering(false);
      setModelIdentifier('');
      setDisplayName('');
      setRefreshTrigger((prev) => prev + 1);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Failed to register model');
    } finally {
      setIsSubmitting(false);
    }
  };

  const models = modelsState.status === 'success' ? (modelsState.data?.models ?? []) : [];
  const decisions = decisionsState.status === 'success' ? (decisionsState.data?.decisions ?? []) : [];

  const modelColumns: Column<ModelRegistryRecord>[] = [
    {
      key: 'displayName',
      header: 'Model Name',
      render: (m) => (
        <div>
          <strong>{m.displayName}</strong>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text2)' }}>{m.modelIdentifier}</div>
        </div>
      ),
    },
    {
      key: 'provider',
      header: 'Provider',
      render: (m) => <span style={{ textTransform: 'capitalize', fontSize: '12px' }}>{m.provider}</span>,
    },
    {
      key: 'contextWindowTokens',
      header: 'Context Window',
      render: (m) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px' }}>{m.contextWindowTokens.toLocaleString()} tokens</span>,
    },
    {
      key: 'costs',
      header: 'Cost (1k In / Out)',
      render: (m) => (
        <span style={{ fontSize: '12px' }}>
          ${m.inputCostPer1k.toFixed(4)} / ${m.outputCostPer1k.toFixed(4)}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: '110px',
      render: (m) => <span className={`${styles.badge} ${styles.badgeActive}`}>{m.status}</span>,
    },
  ];

  const decisionColumns: Column<ModelRoutingDecision>[] = [
    {
      key: 'taskId',
      header: 'Task ID',
      render: (d) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px' }}>{d.taskId}</span>,
    },
    {
      key: 'selectedModelId',
      header: 'Selected Model',
      render: (d) => <strong>{d.selectedModelId}</strong>,
    },
    {
      key: 'selectedProvider',
      header: 'Provider',
      render: (d) => <span style={{ textTransform: 'capitalize', fontSize: '12px' }}>{d.selectedProvider}</span>,
    },
    {
      key: 'fallbackOccurred',
      header: 'Resilience Status',
      width: '140px',
      render: (d) => (
        <span
          className={styles.badge}
          style={{
            background: d.fallbackOccurred ? 'rgba(217, 151, 62, 0.15)' : 'rgba(63, 166, 107, 0.15)',
            color: d.fallbackOccurred ? 'var(--amber)' : 'var(--green)',
          }}
        >
          {d.fallbackOccurred ? 'Fallback Triggered' : 'Primary Selected'}
        </span>
      ),
    },
    {
      key: 'latencyMs',
      header: 'Latency',
      width: '100px',
      render: (d) => <span>{d.latencyMs ? `${d.latencyMs}ms` : '—'}</span>,
    },
  ];

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.titleGroup}>
          <h1>Model Provider Registry & Resilience Routing</h1>
          <p className={styles.subtitle}>LLM providers, fallback circuit breakers, capability matching, and dynamic execution telemetry.</p>
        </div>
        <div className={styles.headerActions}>
          <button className="btn btn-accent" onClick={() => setIsRegistering(true)}>
            + Register Approved Model
          </button>
        </div>
      </header>

      {actionError && <div className="alert alert-err" role="alert">{actionError}</div>}
      {actionSuccess && <div className="alert alert-ok" role="status">{actionSuccess}</div>}

      {/* Model Providers Registry */}
      <div className={styles.sectionCard}>
        <h2 className={styles.sectionTitle}>Approved Model Registry ({models.length})</h2>
        {modelsState.status !== 'success' ? (
          <AsyncState status={modelsState.status === 'loading' ? 'loading' : 'error'} error={modelsState.error} />
        ) : (
          <DataTable
            columns={modelColumns}
            data={models}
            keyExtractor={(m) => m.id}
            emptyMessage="No AI models registered in the provider catalog."
            ariaLabel="Model provider catalog table"
          />
        )}
      </div>

      {/* Routing & Fallback Decision Audit */}
      <div className={styles.sectionCard}>
        <h2 className={styles.sectionTitle}>Resilience Routing & Fallback Decision Audits</h2>
        {decisionsState.status !== 'success' ? (
          <AsyncState status={decisionsState.status === 'loading' ? 'loading' : 'error'} error={decisionsState.error} />
        ) : (
          <DataTable
            columns={decisionColumns}
            data={decisions}
            keyExtractor={(d) => d.id}
            emptyMessage="No dynamic model routing decisions recorded recently."
            ariaLabel="Model routing decisions table"
          />
        )}
      </div>

      {/* Register Model Modal */}
      {isRegistering && (
        <div className={styles.modalBackdrop} role="dialog" aria-modal="true" aria-labelledby="register-model-title">
          <div className={styles.modal}>
            <h2 className={styles.modalTitle} id="register-model-title">Register Approved Model</h2>
            <form onSubmit={handleRegister} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              <div className={styles.formGrid}>
                <div className={styles.formField}>
                  <label className={styles.formLabel} htmlFor="model-provider-select">Provider *</label>
                  <select
                    id="model-provider-select"
                    className={styles.select}
                    value={provider}
                    onChange={(e) => setProvider(e.target.value as 'google' | 'openai' | 'anthropic' | 'deepseek' | 'local')}
                  >
                    <option value="google">Google Gemini</option>
                    <option value="openai">OpenAI</option>
                    <option value="anthropic">Anthropic</option>
                    <option value="deepseek">DeepSeek</option>
                    <option value="local">Local Ollama / vLLM</option>
                  </select>
                </div>

                <div className={styles.formField}>
                  <label className={styles.formLabel} htmlFor="model-display-input">Display Name *</label>
                  <input
                    id="model-display-input"
                    type="text"
                    required
                    className={styles.input}
                    placeholder="e.g. Gemini 2.0 Flash"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                  />
                </div>
              </div>

              <div className={styles.formField}>
                <label className={styles.formLabel} htmlFor="model-identifier-input">Model API Identifier *</label>
                <input
                  id="model-identifier-input"
                  type="text"
                  required
                  className={styles.input}
                  placeholder="e.g. gemini-2.0-flash-exp"
                  value={modelIdentifier}
                  onChange={(e) => setModelIdentifier(e.target.value)}
                />
              </div>

              <div className={styles.formGrid}>
                <div className={styles.formField}>
                  <label className={styles.formLabel} htmlFor="model-context-input">Context Window (tokens)</label>
                  <input
                    id="model-context-input"
                    type="number"
                    min={1000}
                    className={styles.input}
                    value={contextTokens}
                    onChange={(e) => setContextTokens(Number(e.target.value))}
                  />
                </div>

                <div className={styles.formField}>
                  <label className={styles.formLabel} htmlFor="model-cost-input">Input Cost / 1k ($)</label>
                  <input
                    id="model-cost-input"
                    type="number"
                    step="0.00001"
                    className={styles.input}
                    value={inputCost}
                    onChange={(e) => setInputCost(Number(e.target.value))}
                  />
                </div>
              </div>

              <div className={styles.modalActions}>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setIsRegistering(false)} disabled={isSubmitting}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-accent" disabled={isSubmitting}>
                  {isSubmitting ? 'Registering...' : 'Register Model'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
