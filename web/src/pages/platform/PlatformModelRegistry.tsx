import React, { useState, useEffect } from 'react';
import { MetricBlock } from '../../components/primitives/MetricBlock';
import { AsyncState } from '../../components/AsyncState';
import { apiFetch } from '../../lib/apiClient';
import styles from './PlatformModelRegistry.module.css';

interface ModelCertification {
  id: string;
  model_id: string;
  model_version: string;
  provider: string;
  upstream_provider: string;
  tier: 'T1' | 'T2' | 'T3' | 'T4';
  language: string;
  status: 'certified' | 'uncertified' | 'expired' | 'stale' | 'failed';
  pass_rate: number;
  latency_p95_ms: number;
  cost_per_task_usd: number;
  certified_at?: string;
  expires_at?: string;
}

export const PlatformModelRegistry: React.FC = () => {
  const [certifications, setCertifications] = useState<ModelCertification[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [readAt, setReadAt] = useState<string | null>(null);
  const [runningCheck, setRunningCheck] = useState(false);
  const [checkError, setCheckError] = useState<unknown>(null);
  // No default model: the operator names exactly what to certify (provider is OpenRouter, decision D2).
  const [modelId, setModelId] = useState('');
  const [modelVersion, setModelVersion] = useState('');
  const [reportCard, setReportCard] = useState<any>(null);

  useEffect(() => {
    fetchCertifications();
  }, []);

  // Only what the API returns is shown; on failure the matrix is empty with an error (never sample rows, S51).
  const fetchCertifications = async () => {
    setLoading(true);
    try {
      const data = await apiFetch<{ certifications?: ModelCertification[] }>('/api/v1/models/certifications');
      setCertifications(data.certifications ?? []);
      setLoadError(null);
      setReadAt(new Date().toLocaleTimeString());
    } catch (e) {
      setCertifications([]);
      setLoadError(e);
    } finally {
      setLoading(false);
    }
  };

  const handleRunAlignmentCheck = async () => {
    setRunningCheck(true);
    setCheckError(null);
    setReportCard(null);
    try {
      const data = await apiFetch<{ reportCard: any }>('/api/v1/models/alignment-check', {
        method: 'POST',
        body: JSON.stringify({
          modelId: modelId.trim(),
          modelVersion: modelVersion.trim(),
          provider: 'openrouter',
          tiers: ['T1', 'T2', 'T3', 'T4'],
          languages: ['en', 'hi', 'te'],
        }),
      });
      setReportCard(data.reportCard);
      await fetchCertifications();
    } catch (e) {
      setCheckError(e);
    } finally {
      setRunningCheck(false);
    }
  };

  const certifiedCount = certifications.filter((c) => c.status === 'certified').length;
  const uniqueModels = Array.from(new Set(certifications.map((c) => c.model_id))).length;

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.titleGroup}>
          <h1>Model Registry & Certification Matrix (§9, §17.3)</h1>
          <p className={styles.subtitle}>
            Platform-governed capability tiers & multi-language certification records. Models are routed dynamically by capability floor.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8rem', color: 'var(--text2)' }}>
            Model ID (OpenRouter)
            <input className="search-input" style={{ padding: '9px 12px' }} value={modelId} onChange={(e) => setModelId(e.target.value)} placeholder="vendor/model" />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8rem', color: 'var(--text2)' }}>
            Version
            <input className="search-input" style={{ padding: '9px 12px', width: 140 }} value={modelVersion} onChange={(e) => setModelVersion(e.target.value)} />
          </label>
          <button
            className="btn btn-accent"
            onClick={handleRunAlignmentCheck}
            disabled={runningCheck || !modelId.trim() || !modelVersion.trim()}
          >
            {runningCheck ? 'Running 7-Stage Check...' : 'Run Alignment Check (§9.7)'}
          </button>
        </div>
      </header>

      {checkError !== null && <AsyncState status="error" error={checkError} />}

      {/* Advisory suitability disclaimer (§9.6) */}
      <div className={styles.advisoryBanner}>
        <strong>Advisory Only:</strong> Advisory model guidance is based on general model characteristics. Run the alignment check to evaluate real-time capability tier conformance on your actual workforce. Certification always overrules advisory guidance.
      </div>

      <div className={styles.metricsGrid}>
        {readAt && (
          <>
            <MetricBlock label="Models with certification records" value={uniqueModels.toString()} source="model_certifications" timestamp={`read ${readAt}`} />
            <MetricBlock label="Certified tier × language cells" value={certifiedCount.toString()} source="model_certifications" timestamp={`read ${readAt}`} />
          </>
        )}
      </div>

      {reportCard && (
        <div className={styles.reportCard}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0, fontSize: '15px', color: 'var(--text)' }}>
              Alignment Check Report Card: {reportCard.modelId} ({reportCard.modelVersion})
            </h3>
            <span className={`${styles.statusBadge} ${reportCard.overallPassed ? styles.statusCertified : styles.statusStale}`}>
              {reportCard.overallPassed ? 'Passed' : 'Failed'}
            </span>
          </div>
          <p style={{ margin: 0, fontSize: '12px', color: 'var(--text2)' }}>
            Certified Tiers: <strong>{reportCard.certifiedTiers.join(', ')}</strong> | Languages: <strong>{reportCard.certifiedLanguages.join(', ')}</strong> | Estimated Cost: ${reportCard.costEstimateUsd}
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '8px', marginTop: '8px' }}>
            {Object.keys(reportCard.stages).map((key) => {
              const stage = reportCard.stages[key];
              return (
                <div key={key} style={{ padding: '8px', background: 'var(--surface)', borderRadius: '4px', border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text)' }}>{stage.name}</div>
                  <div style={{ fontSize: '11px', color: stage.passed ? 'var(--green)' : 'var(--red)' }}>
                    {stage.passed ? 'Passed' : 'Failed'} ({stage.latencyMs.toFixed(0)}ms)
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className={styles.sectionCard}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 className={styles.sectionTitle}>Model Certification Matrix (§9.2, §17.3)</h2>
          <span style={{ fontSize: '12px', color: 'var(--text2)' }}>
            Results stored strictly per tier × per language
          </span>
        </div>

        {loading && <AsyncState status="loading" />}
        {!loading && loadError !== null && <AsyncState status="error" error={loadError} />}
        {!loading && loadError === null && certifications.length === 0 && (
          <AsyncState status="empty" emptyMessage="No certification records yet. Run an alignment check to certify a model." />
        )}
        <div className={styles.tableWrapper}>
          <table className={styles.matrixTable}>
            <thead>
              <tr>
                <th>Model Identifier</th>
                <th>Provider / Upstream</th>
                <th>Capability Tier</th>
                <th>Language</th>
                <th>Pass Rate</th>
                <th>P95 Latency</th>
                <th>Cost / Task</th>
                <th>Certification Status</th>
              </tr>
            </thead>
            <tbody>
              {certifications.map((cert) => (
                <tr key={cert.id}>
                  <td>
                    <strong>{cert.model_id}</strong>
                    <span style={{ fontSize: '11px', color: 'var(--text2)', marginLeft: '6px' }}>
                      v{cert.model_version}
                    </span>
                    {cert.upstream_provider === 'openrouter' && <span className={styles.shadowPill}>Router</span>}
                  </td>
                  <td>{cert.provider} ({cert.upstream_provider})</td>
                  <td>
                    <span className={`${styles.tierBadge} ${styles[`tier${cert.tier}`]}`}>
                      {cert.tier}
                    </span>
                  </td>
                  <td>
                    <code style={{ fontSize: '12px', fontWeight: 600 }}>{cert.language.toUpperCase()}</code>
                  </td>
                  <td>{(cert.pass_rate * 100).toFixed(1)}%</td>
                  <td>{cert.latency_p95_ms}ms</td>
                  <td>${cert.cost_per_task_usd.toFixed(4)}</td>
                  <td>
                    <span
                      className={`${styles.statusBadge} ${
                        cert.status === 'certified'
                          ? styles.statusCertified
                          : cert.status === 'expired'
                          ? styles.statusExpired
                          : cert.status === 'stale'
                          ? styles.statusStale
                          : styles.statusUncertified
                      }`}
                    >
                      {cert.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
