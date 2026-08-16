import { useState, useCallback } from 'react';
import { apiFetch, ApiError } from '../../lib/apiClient';
import { useAsync } from '../../lib/useAsync';
import { DataTable, Column } from '../../components/DataTable';
import { AsyncState } from '../../components/AsyncState';
import styles from './PlatformSecurity.module.css';

export interface SecurityComplianceReport {
  status: 'COMPLIANT' | 'VULNERABILITY_DETECTED';
  totalChecks: number;
  passedChecks: number;
  findings: Array<{
    severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
    category: string;
    description: string;
    remediation: string;
  }>;
  scanTimestamp: string;
}

export interface AuditLedgerVerificationReport {
  isValid: boolean;
  totalEventsChecked: number;
  tamperedEventsCount: number;
  lastValidSequence: number;
  brokenHashAtSequence?: number;
  details: string[];
}

export interface SecretRotationRecord {
  id: string;
  secret_name: string;
  secret_version: number;
  status: 'active' | 'grace_period' | 'revoked';
  rotated_at: string;
}

export function PlatformSecurity() {
  const [refreshTrigger, setRefreshTrigger] = useState<number>(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Rotate Secret Modal
  const [isRotating, setIsRotating] = useState<boolean>(false);
  const [secretName, setSecretName] = useState<string>('JWT_SIGNING_KEY');
  const [newSecretValue, setNewSecretValue] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const fetchScan = useCallback(() => {
    return apiFetch<SecurityComplianceReport>('/api/v1/security/scan', { method: 'POST', body: '{}' });
  }, [refreshTrigger]);

  const fetchLedgerVerification = useCallback(() => {
    return apiFetch<AuditLedgerVerificationReport>('/api/v1/security/audit/verify');
  }, [refreshTrigger]);

  const fetchSecrets = useCallback(() => {
    return apiFetch<{ secrets: SecretRotationRecord[]; count: number }>('/api/v1/security/secrets');
  }, [refreshTrigger]);

  const scanState = useAsync(fetchScan, [fetchScan]);
  const ledgerState = useAsync(fetchLedgerVerification, [fetchLedgerVerification]);
  const secretsState = useAsync(fetchSecrets, [fetchSecrets]);

  const handleRotate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsSubmitting(true);
      setActionError(null);
      await apiFetch('/api/v1/security/secrets/rotate', {
        method: 'POST',
        body: JSON.stringify({
          secretName,
          newSecretValue: newSecretValue || `sec_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
        }),
      });
      setActionSuccess(`Secret '${secretName}' rotated successfully.`);
      setIsRotating(false);
      setNewSecretValue('');
      setRefreshTrigger((prev) => prev + 1);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Failed to rotate secret');
    } finally {
      setIsSubmitting(false);
    }
  };

  const scan = scanState.status === 'success' ? scanState.data : null;
  const ledger = ledgerState.status === 'success' ? ledgerState.data : null;
  const secrets = secretsState.status === 'success' ? secretsState.data.secrets : [];

  const findingColumns: Column<SecurityComplianceReport['findings'][0]>[] = [
    {
      key: 'severity',
      header: 'Severity',
      width: '110px',
      render: (f) => (
        <span
          className={styles.badge}
          style={{
            background: f.severity === 'CRITICAL' || f.severity === 'HIGH' ? 'rgba(216, 87, 75, 0.15)' : 'rgba(217, 151, 62, 0.15)',
            color: f.severity === 'CRITICAL' || f.severity === 'HIGH' ? 'var(--color-critical)' : 'var(--color-caution)',
          }}
        >
          {f.severity}
        </span>
      ),
    },
    {
      key: 'description',
      header: 'Finding Description',
      render: (f) => <strong>{f.description}</strong>,
    },
    {
      key: 'category',
      header: 'Threat Category',
      render: (f) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px' }}>{f.category}</span>,
    },
    {
      key: 'remediation',
      header: 'Remediation Step',
      render: (f) => <span style={{ fontSize: '12px', color: 'var(--color-ink-muted)' }}>{f.remediation}</span>,
    },
  ];

  const secretColumns: Column<SecretRotationRecord>[] = [
    {
      key: 'secret_name',
      header: 'Secret Name',
      render: (s) => <strong style={{ fontFamily: 'var(--font-mono)' }}>{s.secret_name}</strong>,
    },
    {
      key: 'secret_version',
      header: 'Version',
      width: '90px',
      render: (s) => <span style={{ fontFamily: 'var(--font-mono)' }}>v{s.secret_version}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      width: '110px',
      render: (s) => (
        <span className={`${styles.badge} ${s.status === 'active' ? styles.badgePass : styles.badgeFail}`}>
          {s.status}
        </span>
      ),
    },
    {
      key: 'rotated_at',
      header: 'Rotated At',
      width: '150px',
      render: (s) => <span style={{ fontSize: '11px', color: 'var(--color-ink-muted)' }}>{new Date(s.rotated_at).toLocaleString()}</span>,
    },
  ];

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.titleGroup}>
          <h1>Security Center & Zero-Trust Verification</h1>
          <p className={styles.subtitle}>Cryptographic audit hash-chain ledger, automated compliance checks, and zero-trust key rotation.</p>
        </div>
        <div className={styles.headerActions}>
          <button className={styles.btnSecondary} onClick={() => setRefreshTrigger((prev) => prev + 1)}>
            Run Scan Now
          </button>
          <button className={styles.btnPrimary} onClick={() => setIsRotating(true)}>
            + Rotate Secret Key
          </button>
        </div>
      </header>

      {actionError && <div style={{ color: 'var(--color-critical)', background: 'rgba(216,87,75,0.1)', padding: 'var(--space-3)', borderRadius: 'var(--radius-sm)' }}>⚠️ {actionError}</div>}
      {actionSuccess && <div style={{ color: 'var(--color-verify)', background: 'rgba(63,166,107,0.1)', padding: 'var(--space-3)', borderRadius: 'var(--radius-sm)' }}>✓ {actionSuccess}</div>}

      {/* Cryptographic Ledger & Compliance Score */}
      <div className={styles.gridTwo}>
        <div className={styles.sectionCard}>
          <h2 className={styles.sectionTitle}>Cryptographic Audit Hash-Chain Integrity</h2>
          {ledgerState.status !== 'success' ? (
            <AsyncState status={ledgerState.status === 'loading' ? 'loading' : 'error'} error={ledgerState.error} />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Ledger State:</span>
                <span className={`${styles.badge} ${ledger?.isValid ? styles.badgePass : styles.badgeFail}`}>
                  {ledger?.isValid ? 'VERIFIED (IMMUTABLE)' : 'INTEGRITY BREACH'}
                </span>
              </div>
              <div style={{ fontSize: '13px', color: 'var(--color-ink-muted)' }}>
                Total Verified Events: <strong>{ledger?.totalEventsChecked}</strong> | Sequence: <strong>{ledger?.lastValidSequence}</strong>
              </div>
            </div>
          )}
        </div>

        <div className={styles.sectionCard}>
          <h2 className={styles.sectionTitle}>Zero-Trust Compliance Posture</h2>
          {scanState.status !== 'success' ? (
            <AsyncState status={scanState.status === 'loading' ? 'loading' : 'error'} error={scanState.error} />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Posture Status:</span>
                <span className={`${styles.badge} ${scan?.status === 'COMPLIANT' ? styles.badgePass : styles.badgeFail}`}>
                  {scan?.status}
                </span>
              </div>
              <div style={{ fontSize: '13px', color: 'var(--color-ink-muted)' }}>
                Passed Checks: <strong>{scan?.passedChecks} / {scan?.totalChecks}</strong>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Compliance Findings */}
      <div className={styles.sectionCard}>
        <h2 className={styles.sectionTitle}>Security Scan Findings ({scan?.findings?.length ?? 0})</h2>
        <DataTable
          columns={findingColumns}
          data={scan?.findings || []}
          keyExtractor={(f) => `${f.category}_${f.description}`}
          emptyMessage="No security vulnerabilities or compliance issues detected."
          ariaLabel="Security findings table"
        />
      </div>

      {/* Secret Rotation Registry */}
      <div className={styles.sectionCard}>
        <h2 className={styles.sectionTitle}>Zero-Trust Secrets & Cryptographic Key Versions ({secrets.length})</h2>
        {secretsState.status !== 'success' ? (
          <AsyncState status={secretsState.status === 'loading' ? 'loading' : 'error'} error={secretsState.error} />
        ) : (
          <DataTable
            columns={secretColumns}
            data={secrets}
            keyExtractor={(s) => s.id}
            emptyMessage="No rotated secret keys registered in vault."
            ariaLabel="Secret keys table"
          />
        )}
      </div>

      {/* Rotate Secret Modal */}
      {isRotating && (
        <div className={styles.modalBackdrop} role="dialog" aria-modal="true" aria-labelledby="rotate-secret-title">
          <div className={styles.modal}>
            <h2 className={styles.modalTitle} id="rotate-secret-title">Rotate Security Secret Key</h2>
            <form onSubmit={handleRotate} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              <div className={styles.formField}>
                <label className={styles.formLabel} htmlFor="secret-name-select">Secret Key Identifier *</label>
                <select
                  id="secret-name-select"
                  className={styles.select}
                  value={secretName}
                  onChange={(e) => setSecretName(e.target.value)}
                >
                  <option value="JWT_SIGNING_KEY">JWT_SIGNING_KEY (Authentication Token Secret)</option>
                  <option value="DATABASE_ENCRYPTION_KEY">DATABASE_ENCRYPTION_KEY (At-Rest Cipher Key)</option>
                  <option value="WEBHOOK_HMAC_SECRET">WEBHOOK_HMAC_SECRET (Outbound Signature Secret)</option>
                  <option value="AGENT_VAULT_MASTER_KEY">AGENT_VAULT_MASTER_KEY (Credential Storage Master Key)</option>
                </select>
              </div>

              <div className={styles.formField}>
                <label className={styles.formLabel} htmlFor="secret-value-input">New Secret Value (optional, auto-generated if blank)</label>
                <input
                  id="secret-value-input"
                  type="password"
                  className={styles.input}
                  placeholder="Leave empty to securely generate"
                  value={newSecretValue}
                  onChange={(e) => setNewSecretValue(e.target.value)}
                />
              </div>

              <div className={styles.modalActions}>
                <button type="button" className={styles.btnSecondary} onClick={() => setIsRotating(false)} disabled={isSubmitting}>
                  Cancel
                </button>
                <button type="submit" className={styles.btnPrimary} disabled={isSubmitting}>
                  {isSubmitting ? 'Rotating...' : 'Rotate & Re-encrypt'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
