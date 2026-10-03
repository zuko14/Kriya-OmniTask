import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { apiFetch } from '../../lib/apiClient';
import styles from './BrainConsole.module.css';
import { Icon } from '../../components/brand/Icon';

interface TenantBrainRecord {
  id: string;
  provider: string;
  modelId: string;
  modelVersion: string;
  keyLastFour: string;
  status: 'certified' | 'stale' | 'unhealthy' | 'revoked' | 'unassigned';
  healthStatus: 'healthy' | 'degraded' | 'unhealthy' | 'halted';
  certifiedTiers: string[];
  certifiedLanguages: string[];
  assignedAgents: string[];
  currentMonthSpendUsd: number;
  expiresAt?: string | null;
}

interface TenantBrainConfig {
  brainSupply: 'byo' | 'managed';
  monthlyBudgetUsd: number;
  dailyBudgetUsd: number;
  currentMonthSpendUsd: number;
  currentDaySpendUsd: number;
  status: string;
}

interface SpendStatus {
  monthlyBudgetUsd: number;
  currentMonthSpendUsd: number;
  utilizationPercentage: number;
  dailyAverageSpendUsd: number;
  thresholdTier: string;
  actionTaken: string;
  anomalyWatchActive: boolean;
  anomalyDetected: boolean;
}

interface WorkforceCoverage {
  allCovered: boolean;
  totalAgentsCount: number;
  coveredAgentsCount: number;
  uncoveredAgentsCount: number;
  statusHeadline: string;
  isHealthy: boolean;
}

interface CatalogueModel {
  id: string;
  provider: string;
  modelId: string;
  displayName: string;
  contextWindow: number;
  indicativeCostPerMillionInr: number;
  suitabilityState: 'RECOMMENDED' | 'SUPPORTED' | 'MARGINAL' | 'UNSUITABLE';
  namedLimitation?: string;
  failedHardRequirement?: string;
  isSelectable: boolean;
  advisoryNotice: string;
}

export function BrainConsole() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<TenantBrainConfig | null>(null);
  const [activeBrains, setActiveBrains] = useState<TenantBrainRecord[]>([]);
  const [spendStatus, setSpendStatus] = useState<SpendStatus | null>(null);
  const [coverage, setCoverage] = useState<WorkforceCoverage | null>(null);

  // Add Brain Modal States (Steps 1-6)
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [step, setStep] = useState<number>(1);
  const [provider, setProvider] = useState('openrouter');
  const [apiKey, setApiKey] = useState('');
  const [keyValidated, setKeyValidated] = useState(false);
  const [keyValidating, setKeyValidating] = useState(false);
  const [keyValidationError, setKeyValidationError] = useState('');

  const [catalogue, setCatalogue] = useState<CatalogueModel[]>([]);
  const [selectedModel, setSelectedModel] = useState<CatalogueModel | null>(null);
  const [costEstimate, setCostEstimate] = useState<{ estimatedTokens: number; estimatedCostInr: number; disclosureText: string } | null>(null);

  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [currentStageIndex, setCurrentStageIndex] = useState(0);
  const [reportCard, setReportCard] = useState<any>(null);

  const loadOverview = async () => {
    try {
      setLoading(true);
      const res = await apiFetch<any>('/api/v1/brain/overview');
      if (res && res.success) {
        setConfig(res.config);
        setActiveBrains(res.activeBrains || []);
        setSpendStatus(res.spendStatus);
        setCoverage(res.coverage);
      }
    } catch (err) {
      console.error('Failed to load brain overview', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOverview();
  }, []);

  // Timer for alignment check
  useEffect(() => {
    let timer: any;
    if (step === 4 && activeRunId) {
      timer = setInterval(() => {
        setElapsedSeconds((prev) => prev + 1);
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [step, activeRunId]);

  // Load catalogue on opening modal
  const openAddModal = async () => {
    setIsAddModalOpen(true);
    setStep(1);
    setApiKey('');
    setKeyValidated(false);
    setKeyValidationError('');
    setSelectedModel(null);
    setReportCard(null);

    try {
      const res = await apiFetch<any>('/api/v1/brain/catalogue');
      if (res && res.success) {
        setCatalogue(res.catalogue);
      }
    } catch (err) {
      console.error('Failed to load model catalogue', err);
    }
  };

  // Step 1: Validate key on blur
  const handleKeyBlur = async () => {
    if (!apiKey.trim()) return;
    try {
      setKeyValidating(true);
      setKeyValidationError('');
      const res = await apiFetch<any>('/api/v1/brain/validate-key', {
        method: 'POST',
        body: JSON.stringify({
          provider,
          apiKey: apiKey.trim(),
        }),
      });
      if (res && res.success) {
        setKeyValidated(true);
      } else {
        setKeyValidated(false);
        setKeyValidationError(res.validation?.errorMessage || 'Invalid API Key');
      }
    } catch (err: any) {
      setKeyValidated(false);
      setKeyValidationError(err.message || 'Key validation handshake failed');
    } finally {
      setKeyValidating(false);
    }
  };

  // Step 2 -> Step 3: Select model and estimate check
  const handleSelectModel = async (model: CatalogueModel) => {
    if (!model.isSelectable) return;
    setSelectedModel(model);
    try {
      const res = await apiFetch<any>('/api/v1/brain/estimate-check', {
        method: 'POST',
        body: JSON.stringify({
          modelId: model.modelId,
        }),
      });
      if (res && res.success) {
        setCostEstimate(res.estimate);
        setStep(3); // Go to confirm estimate
      }
    } catch (err) {
      console.error('Failed to estimate check', err);
    }
  };

  // Step 3 -> Step 4: Run Alignment Check
  const startAlignmentCheck = async () => {
    if (!selectedModel) return;
    setStep(4);
    setElapsedSeconds(0);
    setCurrentStageIndex(0);
    setCheckError(null);

    try {
      const res = await apiFetch<any>('/api/v1/brain/alignment-check', {
        method: 'POST',
        body: JSON.stringify({
          provider: selectedModel.provider,
          modelId: selectedModel.modelId,
          apiKey: config?.brainSupply === 'byo' ? apiKey : undefined,
        }),
      });

      if (res && res.success) {
        setActiveRunId(res.runId);

        // Connect to SSE stream or poll for completion
        const pollInterval = setInterval(async () => {
          try {
            const checkRes = await apiFetch<any>(`/api/v1/brain/alignment-check/${res.runId}`);
            if (checkRes && checkRes.run) {
              setCurrentStageIndex(checkRes.run.currentStage);
              if (checkRes.run.status === 'completed') {
                clearInterval(pollInterval);
                setReportCard(checkRes.run.reportCard);
                setStep(5); // Show Report Card
              } else if (checkRes.run.status === 'failed' || checkRes.run.status === 'cancelled') {
                clearInterval(pollInterval);
                alert(`Alignment check ${checkRes.run.status}: ${checkRes.run.errorMessage}`);
                setIsAddModalOpen(false);
              }
            }
          } catch (e) {
            clearInterval(pollInterval);
            setCheckError(e instanceof Error ? `Lost contact with the check: ${e.message}` : 'Lost contact with the alignment check.');
          }
        }, 800);
      } else {
        setCheckError('The server did not start the alignment check.');
      }
    } catch (err) {
      setCheckError(err instanceof Error ? err.message : 'Failed to start the alignment check.');
    }
  };

  // Cancel running check
  const handleCancelCheck = async () => {
    if (!activeRunId) return;
    try {
      await apiFetch(`/api/v1/brain/alignment-check/${activeRunId}/cancel`, { method: 'POST' });
      setIsAddModalOpen(false);
    } catch (err) {
      console.error('Failed to cancel check', err);
    }
  };

  // Step 5: Assign as proposed
  const handleAssignProposed = async () => {
    if (!reportCard) return;
    try {
      await apiFetch('/api/v1/brain/assign', {
        method: 'POST',
        body: JSON.stringify({
          modelId: reportCard.modelId,
          modelVersion: reportCard.modelVersion || '20241022',
          provider: reportCard.provider,
          keyLastFour: apiKey ? apiKey.slice(-4) : '7f2a',
          certifiedTiers: reportCard.certifiedTiers,
          certifiedLanguages: reportCard.certifiedLanguages,
          approvedProposal: true,
        }),
      });
      setIsAddModalOpen(false);
      await loadOverview();
    } catch (err: any) {
      alert(`Assignment failed: ${err.message}`);
    }
  };

  // Actions
  const handleRevokeBrain = async (brainId: string) => {
    if (confirm('Revoke this brain? Routing will stop immediately and affected agents will degrade.')) {
      await apiFetch(`/api/v1/brain/${brainId}`, { method: 'DELETE' });
      await loadOverview();
    }
  };

  const handleRotateKey = async (brainId: string) => {
    const newKey = prompt('Enter new provider API key for zero-downtime rotation:');
    if (newKey) {
      try {
        await apiFetch('/api/v1/brain/rotate-key', {
          method: 'POST',
          body: JSON.stringify({ brainId, newApiKey: newKey }),
        });
        alert('Key rotated successfully with zero downtime.');
        await loadOverview();
      } catch (err: any) {
        alert(`Rotation failed: ${err.message}`);
      }
    }
  };

  const handleRecertify = async (brainId: string) => {
    await apiFetch(`/api/v1/brain/${brainId}/recertify`, {
      method: 'POST',
      body: JSON.stringify({ reason: 'manual_schedule' }),
    });
    alert('Re-certification triggered. Check running.');
    await loadOverview();
  };

  if (loading && !config) {
    return <div className={styles.container}>Loading Brain Console...</div>;
  }

  const isByo = config?.brainSupply === 'byo';
  const spendPct = spendStatus?.utilizationPercentage || 0;

  return (
    <div className={styles.container}>
      {/* 18.6.1 Header */}
      <div className={styles.header}>
        <div className={styles.titleGroup}>
          <h1 className={styles.title}>BRAIN</h1>
          <span
            className={`${styles.supplyModeBadge} ${isByo ? styles.supplyModeBadgeByo : ''}`}
            data-testid="supply-mode-badge"
          >
            {isByo
              ? 'Supply: BYO · your key, your bill'
              : 'Supply: Managed · Supplied by Kriya under your managed plan'}
          </span>
        </div>
      </div>

      {/* 18.6.1 Active Brains Roster */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <div className={styles.sectionTitle}>ACTIVE BRAINS</div>
        </div>

        <div className={styles.brainsList} data-testid="active-brains-list">
          {activeBrains.length === 0 ? (
            <div className={styles.metaRow}>No active brains configured. Add a brain to power your workforce.</div>
          ) : (
            activeBrains.map((brain) => (
              <div key={brain.id} className={styles.brainCard} data-testid={`brain-card-${brain.id}`}>
                <div className={styles.brainCardHeader}>
                  <div className={styles.modelIdentity}>
                    <span className={styles.modelName}>{brain.modelId}</span>
                    <span
                      className={`${styles.statusDot} ${
                        brain.status === 'certified'
                          ? styles.dotCertified
                          : brain.status === 'stale'
                          ? styles.dotStale
                          : styles.dotUnhealthy
                      }`}
                    >
                      ● {brain.status}
                    </span>
                  </div>

                  {/* Certified Tier & Language Badges */}
                  <div className={styles.badgesGroup}>
                    {['T1', 'T2', 'T3', 'T4'].map((tier) => {
                      const passed = brain.certifiedTiers.includes(tier);
                      return (
                        <span
                          key={tier}
                          className={`${styles.tierBadge} ${passed ? styles.badgePassed : styles.badgeFailed}`}
                        >
                          {tier} <Icon name={passed ? 'check' : 'close'} label={passed ? 'certified' : 'not certified'} />
                        </span>
                      );
                    })}
                    {['EN', 'HI', 'TE'].map((lang) => {
                      const langCode = lang.toLowerCase();
                      const passed = brain.certifiedLanguages.includes(langCode);
                      return (
                        <span
                          key={lang}
                          className={`${styles.langBadge} ${passed ? styles.badgePassed : styles.badgeWarning}`}
                        >
                          {lang} <Icon name={passed ? 'check' : 'alert'} label={passed ? 'certified' : 'not certified'} />
                        </span>
                      );
                    })}
                  </div>
                </div>

                {/* Subtext info row */}
                <div className={styles.metaRow}>
                  <span>
                    via {brain.provider} · key ····{brain.keyLastFour} ·{' '}
                    {brain.expiresAt ? `exp ${new Date(brain.expiresAt).toLocaleDateString()}` : 'active'} · ₹
                    {Math.round(brain.currentMonthSpendUsd * 85)} this month
                  </span>
                  {isByo && (
                    <div className={styles.brainActions}>
                      <button className={styles.actionBtn} onClick={() => handleRotateKey(brain.id)}>
                        Rotate key
                      </button>
                      <button className={styles.actionBtn} onClick={() => handleRecertify(brain.id)}>
                        Re-certify
                      </button>
                      <button
                        className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
                        onClick={() => handleRevokeBrain(brain.id)}
                      >
                        Revoke
                      </button>
                    </div>
                  )}
                </div>

                {/* Serving agents */}
                <div className={styles.servingRow}>
                  <span>
                    <span className={styles.servingLabel}>serving: </span>
                    {brain.assignedAgents.length > 0
                      ? brain.assignedAgents.map((a) => a.replace(/_/g, ' ')).join(' · ')
                      : 'Unassigned'}
                  </span>
                </div>
              </div>
            ))
          )}

          <button className={styles.addBrainBtn} onClick={openAddModal} data-testid="add-brain-btn">
            + Add a brain
          </button>
        </div>
      </div>

      {/* 18.6.1 Spend Progress & Anomaly Watch */}
      <div className={styles.spendSection}>
        <div className={styles.spendHeader}>
          <div className={styles.sectionTitle}>SPEND</div>
          <div className={styles.metaRow}>
            ₹{Math.round((spendStatus?.currentMonthSpendUsd || 0) * 85)} / ₹
            {Math.round((spendStatus?.monthlyBudgetUsd || 50) * 85)} monthly budget ({spendPct}%)
          </div>
        </div>

        <div className={styles.progressBarContainer}>
          <div
            className={`${styles.progressBarFill} ${
              spendPct >= 95 ? styles.fillDanger : spendPct >= 70 ? styles.fillWarn : ''
            }`}
            style={{ width: `${spendPct}%` }}
            data-testid="spend-progress-fill"
          />
        </div>

        <div className={styles.spendFooter}>
          <span>daily ₹{Math.round((spendStatus?.dailyAverageSpendUsd || 0) * 85)} avg</span>
          <span>anomaly watch active</span>
        </div>
      </div>

      {/* 18.6.1 The Coverage Row */}
      <div className={styles.coverageSection} data-testid="workforce-coverage-row">
        <div className={styles.coverageText}>
          <span
            className={coverage?.allCovered ? styles.coverageDotSuccess : styles.coverageDotWarning}
            data-testid="coverage-dot"
          >
            {coverage?.allCovered ? '●' : '▲'}
          </span>
          <span>
            {coverage?.statusHeadline || 'Evaluating workforce brain coverage...'}
          </span>
        </div>
        {!coverage?.allCovered && (
          <span
            className={styles.coverageLink}
            onClick={() => navigate('/app/agents')}
            data-testid="see-workforce-link"
          >
            → see Workforce
          </span>
        )}
      </div>

      {/* ========================================================================= */}
      {/* 18.6.2 Add Brain Modal Flow (Steps 1 to 6) */}
      {/* ========================================================================= */}
      {isAddModalOpen && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalContent} data-testid="add-brain-modal">
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>
                {step === 1 && 'Step 1 · Provider & API Key'}
                {step === 2 && 'Step 2 · Select Model'}
                {step === 3 && 'Step 3 · Alignment Estimate'}
                {step === 4 && 'Step 4 · Alignment Check Running'}
                {step === 5 && 'Step 5 · Alignment Report Card'}
              </h2>
              <button className={styles.closeBtn} onClick={() => setIsAddModalOpen(false)} aria-label="Close">
                <Icon name="close" />
              </button>
            </div>

            {/* Step 1: Provider & Key */}
            {step === 1 && (
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Provider</label>
                <select
                  className={styles.formInput}
                  value={provider}
                  onChange={(e) => setProvider(e.target.value)}
                  disabled={!isByo}
                >
                  <option value="openrouter">OpenRouter</option>
                  <option value="anthropic">Anthropic Direct</option>
                  <option value="openai">OpenAI Direct</option>
                </select>

                <label className={styles.formLabel} style={{ marginTop: '12px' }}>
                  API Key
                </label>
                <input
                  type="password"
                  className={styles.formInput}
                  placeholder={isByo ? 'sk-or-v1-...' : 'Supplied by Kriya under your managed plan'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  onBlur={handleKeyBlur}
                  readOnly={!isByo}
                  data-testid="api-key-input"
                />

                {keyValidating && <div className={styles.validationMsg}>Validating key with provider handshake...</div>}
                {keyValidated && (
                  <div className={`${styles.validationMsg} ${styles.validationSuccess}`} data-testid="key-valid-badge">
                    <Icon name="check" /> Handshake verified with provider
                  </div>
                )}
                {keyValidationError && (
                  <div className={`${styles.validationMsg} ${styles.validationError}`} data-testid="key-error-badge">
                    <Icon name="close" /> {keyValidationError}
                  </div>
                )}

                <div className={styles.modalFooter}>
                  <button
                    className="btn btn-accent"
                    disabled={isByo && !keyValidated}
                    onClick={() => setStep(2)}
                    data-testid="step1-next-btn"
                  >
                    Next: Select Model →
                  </button>
                </div>
              </div>
            )}

            {/* Step 2: Model Catalogue */}
            {step === 2 && (
              <div className={styles.formGroup}>
                <div className={styles.advisoryBanner} data-testid="advisory-banner">
                  Advisory only — based on general model characteristics. Run the alignment check to see how it performs on your actual workforce.
                </div>

                <div className={styles.catalogueGrid}>
                  {catalogue.map((model) => (
                    <div
                      key={model.id}
                      className={`${styles.catalogueCard} ${
                        !model.isSelectable ? styles.cardDisabled : ''
                      } ${selectedModel?.id === model.id ? styles.cardSelected : ''}`}
                      onClick={() => handleSelectModel(model)}
                      data-testid={`catalogue-card-${model.modelId}`}
                    >
                      <div className={styles.catalogueCardTop}>
                        <span className={styles.modelTitleMono}>
                          {model.displayName} ({model.contextWindow / 1000}k context)
                        </span>
                        <span
                          className={`${styles.suitabilityBadge} ${
                            model.suitabilityState === 'RECOMMENDED'
                              ? styles.badgeRecommended
                              : model.suitabilityState === 'SUPPORTED'
                              ? styles.badgeSupported
                              : model.suitabilityState === 'MARGINAL'
                              ? styles.badgeMarginal
                              : styles.badgeUnsuitable
                          }`}
                        >
                          {model.suitabilityState === 'RECOMMENDED' && 'RECOMMENDED'}
                          {model.suitabilityState === 'SUPPORTED' && 'SUPPORTED'}
                          {model.suitabilityState === 'MARGINAL' && 'MARGINAL'}
                          {model.suitabilityState === 'UNSUITABLE' && 'UNSUITABLE'}
                        </span>
                      </div>

                      {model.namedLimitation && (
                        <div className={styles.limitationNotice}>
                          <Icon name="alert" /> {model.namedLimitation}
                        </div>
                      )}
                      {model.failedHardRequirement && (
                        <div className={styles.unsuitableNotice}>
                          <Icon name="close" /> {model.failedHardRequirement}
                        </div>
                      )}

                      <div className={styles.metaRow}>
                        <span>Indicative cost: ≈₹{model.indicativeCostPerMillionInr} / 1M tokens</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Step 3: Estimate Confirmation */}
            {step === 3 && costEstimate && selectedModel && (
              <div className={styles.formGroup}>
                <div className={styles.advisoryBanner} data-testid="estimate-disclosure-box">
                  <p style={{ fontWeight: 600, margin: '0 0 8px 0' }}>Confirm Alignment Check Spend</p>
                  <p style={{ margin: 0 }}>{costEstimate.disclosureText}</p>
                </div>

                <div className={styles.metaRow} style={{ marginTop: '12px' }}>
                  <span>Model: {selectedModel.displayName}</span>
                  <span>Simulation sandbox dry-run included</span>
                </div>

                <div className={styles.modalFooter}>
                  <button className="btn btn-ghost btn-sm" onClick={() => setStep(2)}>
                    Back
                  </button>
                  <button
                    className="btn btn-accent"
                    onClick={startAlignmentCheck}
                    data-testid="confirm-run-check-btn"
                  >
                    Confirm & Run Alignment Check
                  </button>
                </div>
              </div>
            )}

            {/* Step 4: Live Staged Running */}
            {step === 4 && selectedModel && (
              <div className={styles.alignmentRunning} data-testid="alignment-running-view">
                {checkError && (
                  <div className="alert alert-err" role="alert">
                    {checkError}
                  </div>
                )}
                <div className={styles.sectionHeader}>
                  <span className={styles.sectionTitle}>
                    ALIGNMENT CHECK · {selectedModel.displayName}
                  </span>
                  <span className={styles.metaRow}>elapsed {elapsedSeconds}s</span>
                </div>

                <div className={styles.stagesList}>
                  {[
                    { id: 0, label: '0 HANDSHAKE', desc: 'key · reachability · quota · region' },
                    { id: 1, label: '1 PROTOCOL CONFORMANCE', desc: 'structured output · tool calls · bounds · format' },
                    { id: 2, label: '2 CAPABILITY TIERS', desc: 'T1 · T2 · T3 · T4' },
                    { id: 3, label: '3 LANGUAGE', desc: 'English · हिन्दी · తెలుగు' },
                    { id: 4, label: '4 SAFETY', desc: 'instruction-hierarchy · prompt-injection resistance' },
                    { id: 5, label: '5 PERFORMANCE & COST', desc: 'latency p95 · cost per task' },
                    { id: 6, label: '6 LIVE-FIRE DRY RUN', desc: 'simulation only, nothing real is touched' },
                  ].map((s) => {
                    const isPassed = currentStageIndex > s.id;
                    const isRunning = currentStageIndex === s.id;
                    return (
                      <div
                        key={s.id}
                        className={`${styles.stageRow} ${
                          isPassed
                            ? styles.stageRowPassed
                            : isRunning
                            ? styles.stageRowRunning
                            : ''
                        }`}
                      >
                        <span>{isPassed ? '●' : isRunning ? '◐' : '○'}</span>
                        <span style={{ fontWeight: 600 }}>{s.label}</span>
                        <span style={{ color: 'var(--text2)' }}>{s.desc}</span>
                      </div>
                    );
                  })}
                </div>

                <div className={styles.modalFooter} style={{ justifyContent: 'space-between' }}>
                  <span className={styles.metaRow}>Actual cost is shown on the report card when the check finishes.</span>
                  <button className="btn btn-ghost btn-sm" onClick={handleCancelCheck} data-testid="cancel-check-btn">
                    Cancel check
                  </button>
                </div>
              </div>
            )}

            {/* Step 5: Report Card */}
            {step === 5 && reportCard && (
              <div className={styles.formGroup} data-testid="report-card-view">
                <div className={styles.sectionHeader}>
                  <span className={styles.modelName}>{reportCard.modelId}</span>
                  <span className={styles.suitabilityBadge} style={{ background: 'rgba(241, 196, 15, 0.15)', color: 'var(--amber)' }}>
                    {reportCard.overallStatus}
                  </span>
                </div>

                {/* Tier × Language Matrix Table */}
                <table className={styles.matrixTable} data-testid="tier-language-matrix">
                  <thead>
                    <tr>
                      <th className={styles.matrixLangCell}>Language</th>
                      <th>T1 extract</th>
                      <th>T2 converse</th>
                      <th>T3 reason</th>
                      <th>T4 strategize</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reportCard.tierLanguageMatrix?.matrix?.map((row: any) => (
                      <tr key={row.language}>
                        <td className={styles.matrixLangCell}>
                          {row.nativeLabel} ({row.language.toUpperCase()})
                        </td>
                        {row.scores.map((s: any) => (
                          <td key={s.tier} style={{ color: s.passed ? 'var(--green)' : 'var(--red)' }}>
                            {s.passed ? 'pass' : 'fail'} {s.score.toFixed(2)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* Plain-Language Workforce Impact */}
                <div className={styles.workforceImpactBox} data-testid="workforce-impact-box">
                  <div className={styles.impactTitle}>WHAT THIS MEANS FOR YOUR WORKFORCE</div>
                  {reportCard.workforceImpact?.canRun?.length > 0 && (
                    <div style={{ color: 'var(--green)' }}>
                      <Icon name="check" /> Can run: {reportCard.workforceImpact.canRun.join(' · ')}
                    </div>
                  )}
                  {reportCard.workforceImpact?.limited?.length > 0 && (
                    <div style={{ color: 'var(--amber)' }}>
                      <Icon name="alert" /> Limited: {reportCard.workforceImpact.limited.map((l: any) => `${l.agentName} (${l.note})`).join(' · ')}
                    </div>
                  )}
                  {reportCard.workforceImpact?.cannot?.length > 0 && (
                    <div style={{ color: 'var(--red)' }}>
                      <Icon name="close" /> Cannot: {reportCard.workforceImpact.cannot.map((c: any) => `${c.agentName} (needs ${c.requiredTier}+ → ${c.fallbackPlan})`).join(' · ')}
                    </div>
                  )}
                </div>

                <div className={styles.modalFooter}>
                  <button className="btn btn-ghost btn-sm" onClick={() => setIsAddModalOpen(false)}>
                    Discard
                  </button>
                  <button
                    className="btn btn-accent"
                    onClick={handleAssignProposed}
                    data-testid="assign-proposed-btn"
                  >
                    Assign as proposed
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
