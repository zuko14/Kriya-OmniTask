import { useState, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router';
import { apiFetch, ApiError } from '../../lib/apiClient';
import { useAsync } from '../../lib/useAsync';
import { AsyncState } from '../../components/AsyncState';
import styles from './CustomerDetail.module.css';
import { Icon } from '../../components/brand/Icon';

export interface CustomerProfile {
  id: string;
  full_name: string;
  primary_email?: string;
  primary_phone?: string;
  external_crm_id?: string;
  preferred_language: string;
  preferred_channel: string;
  lifecycle_stage: string;
  sentiment_score: number;
  churn_risk_score: number;
  attributes_json?: string;
  status: string;
  created_at: string;
}

export interface CustomerIdentity {
  id: string;
  identity_type: string;
  identity_val: string;
  is_primary: boolean | number;
  verified: boolean | number;
  created_at: string;
}

export interface TimelineEvent {
  id: string;
  channel: string;
  event_type: string;
  summary: string;
  details_json?: string;
  sentiment_score?: number;
  lifecycle_stage?: string;
  actor_type: string;
  actor_id?: string;
  occurred_at: string;
}

export interface CustomerConsent {
  id: string;
  consent_type: string;
  status: 'granted' | 'revoked' | 'pending';
  source: string;
  granted_at?: string;
  revoked_at?: string;
}

export interface Customer360View {
  profile: CustomerProfile;
  identities: CustomerIdentity[];
  timeline: TimelineEvent[];
  consents: CustomerConsent[];
  signals: {
    sentiment: number;
    churnRisk: number;
    lifecycleStage: string;
    totalInteractions: number;
    preferredChannel: string;
    preferredLanguage: string;
  };
}

export function CustomerDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<'timeline' | 'identities' | 'consent' | 'governance'>('timeline');
  const [refreshTrigger, setRefreshTrigger] = useState<number>(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [showConfirmDelete, setShowConfirmDelete] = useState<boolean>(false);

  const fetchCustomer = useCallback(() => {
    if (!id) throw new Error('No customer ID provided');
    return apiFetch<Customer360View>(`/api/v1/customers/${id}`);
  }, [id, refreshTrigger]);

  const state = useAsync(fetchCustomer, [fetchCustomer]);

  const handleToggleConsent = async (consentType: string, currentStatus: string) => {
    if (!id) return;
    try {
      setActionError(null);
      const nextStatus = currentStatus === 'granted' ? 'revoked' : 'granted';
      await apiFetch(`/api/v1/customers/${id}/consent`, {
        method: 'POST',
        body: JSON.stringify({
          consentType,
          status: nextStatus,
          source: 'admin_portal_toggle',
        }),
      });
      setActionSuccess(`Updated ${consentType} consent to ${nextStatus}.`);
      setRefreshTrigger((prev) => prev + 1);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Failed to update consent');
    }
  };

  const handleExportData = async () => {
    if (!id) return;
    try {
      setActionError(null);
      const exportData = await apiFetch(`/api/v1/customers/${id}/export`);
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `customer-360-export-${id}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setActionSuccess('Export package generated and downloaded successfully.');
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Failed to export customer data');
    }
  };

  const handleDeleteCustomer = async () => {
    if (!id) return;
    try {
      setIsDeleting(true);
      setActionError(null);
      await apiFetch(`/api/v1/customers/${id}`, { method: 'DELETE' });
      navigate('/admin/customers');
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Failed to anonymize/delete customer');
      setIsDeleting(false);
      setShowConfirmDelete(false);
    }
  };

  if (state.status !== 'success') {
    return (
      <div className={styles.container}>
        <Link to="/admin/customers" className={styles.backLink}>← Back to Customer Directory</Link>
        <AsyncState status={state.status === 'loading' ? 'loading' : 'error'} error={state.error} />
      </div>
    );
  }

  const { profile, identities, timeline, consents, signals } = state.data;

  return (
    <div className={styles.container}>
      <Link to="/admin/customers" className={styles.backLink}>← Back to Customer Directory</Link>

      {actionError && <div className="alert alert-err" role="alert">{actionError}</div>}
      {actionSuccess && <div className="alert alert-ok" role="status">{actionSuccess}</div>}

      {/* Header Profile Card */}
      <div className={styles.headerCard}>
        <div className={styles.profileInfo}>
          <h1>{profile.full_name}</h1>
          <div className={styles.profileMeta}>
            <span>ID: <strong style={{ fontFamily: 'var(--font-mono)' }}>{profile.id}</strong></span>
            {profile.external_crm_id && <span>CRM ID: <strong style={{ fontFamily: 'var(--font-mono)' }}>{profile.external_crm_id}</strong></span>}
            <span>Email: <strong>{profile.primary_email || '—'}</strong></span>
            <span>Phone: <strong>{profile.primary_phone || '—'}</strong></span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
          <span className={`${styles.badge} ${styles.badgeSuccess}`}>
            {profile.lifecycle_stage}
          </span>
          <span className={styles.badge} style={{ background: 'var(--surface2)', color: 'var(--text2)' }}>
            {profile.preferred_channel} ({profile.preferred_language.toUpperCase()})
          </span>
        </div>
      </div>

      {/* Signals Bar */}
      <div className={styles.signalsGrid}>
        <div className={styles.signalCard}>
          <span className={styles.signalLabel}>Sentiment</span>
          <span className={styles.signalValue} style={{ color: signals.sentiment >= 0 ? 'var(--green)' : 'var(--red)' }}>
            {signals.sentiment.toFixed(1)}
          </span>
        </div>
        <div className={styles.signalCard}>
          <span className={styles.signalLabel}>Churn Risk</span>
          <span className={styles.signalValue} style={{ color: signals.churnRisk > 0.5 ? 'var(--red)' : 'var(--text)' }}>
            {(signals.churnRisk * 100).toFixed(0)}%
          </span>
        </div>
        <div className={styles.signalCard}>
          <span className={styles.signalLabel}>Total Interactions</span>
          <span className={styles.signalValue}>{signals.totalInteractions}</span>
        </div>
        <div className={styles.signalCard}>
          <span className={styles.signalLabel}>Lifecycle</span>
          <span className={styles.signalValue} style={{ fontSize: '18px', textTransform: 'capitalize' }}>
            {signals.lifecycleStage}
          </span>
        </div>
      </div>

      {/* Tabs */}
      <nav className={styles.tabsNav} aria-label="Customer 360 navigation tabs">
        <button
          className={`${styles.tabBtn} ${activeTab === 'timeline' ? styles.tabBtnActive : ''}`}
          onClick={() => setActiveTab('timeline')}
        >
          Timeline & Interactions ({timeline.length})
        </button>
        <button
          className={`${styles.tabBtn} ${activeTab === 'identities' ? styles.tabBtnActive : ''}`}
          onClick={() => setActiveTab('identities')}
        >
          Identities ({identities.length})
        </button>
        <button
          className={`${styles.tabBtn} ${activeTab === 'consent' ? styles.tabBtnActive : ''}`}
          onClick={() => setActiveTab('consent')}
        >
          Consent & Privacy ({consents.length})
        </button>
        <button
          className={`${styles.tabBtn} ${activeTab === 'governance' ? styles.tabBtnActive : ''}`}
          onClick={() => setActiveTab('governance')}
        >
          GDPR / Governance
        </button>
      </nav>

      {/* Tab Panels */}
      <div className={styles.tabContent}>
        {activeTab === 'timeline' && (
          <div>
            {timeline.length === 0 ? (
              <div style={{ color: 'var(--text2)', fontSize: '13px', textAlign: 'center', padding: 'var(--space-4)' }}>
                No interaction events recorded for this customer yet.
              </div>
            ) : (
              <div className={styles.timelineList}>
                {timeline.map((event) => (
                  <div key={event.id} className={styles.timelineItem}>
                    <div className={styles.timelineDot} />
                    <div className={styles.timelineBody}>
                      <div className={styles.timelineMeta}>
                        <span>
                          <strong>{event.actor_type.toUpperCase()}</strong> ({event.channel}) · {event.event_type}
                        </span>
                        <span>{new Date(event.occurred_at).toLocaleString()}</span>
                      </div>
                      <div style={{ fontSize: '13px', color: 'var(--text)' }}>{event.summary}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'identities' && (
          <div>
            {identities.length === 0 ? (
              <div style={{ color: 'var(--text2)', fontSize: '13px', textAlign: 'center', padding: 'var(--space-4)' }}>
                No alternate resolved identities linked.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                {identities.map((ident) => (
                  <div key={ident.id} style={{ display: 'flex', justifyContent: 'space-between', padding: 'var(--space-3)', background: 'var(--surface2)', borderRadius: 'var(--radius-sm)' }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text)' }}>{ident.identity_val}</div>
                      <div style={{ fontSize: '11px', color: 'var(--text2)' }}>Type: {ident.identity_type} {ident.is_primary ? '· (Primary)' : ''}</div>
                    </div>
                    <div>
                      <span className={`${styles.badge} ${ident.verified ? styles.badgeSuccess : styles.badgeWarning}`}>
                        {ident.verified ? 'Verified' : 'Unverified'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'consent' && (
          <div>
            <div style={{ fontSize: '13px', color: 'var(--text2)', marginBottom: 'var(--space-4)' }}>
              Regulatory consent tracking under GDPR / DPDP Article 6 & 7 compliance.
            </div>
            {consents.length === 0 ? (
              <div style={{ color: 'var(--text2)', fontSize: '13px', textAlign: 'center', padding: 'var(--space-4)' }}>
                No explicit consent records registered.
              </div>
            ) : (
              <div>
                {consents.map((c) => (
                  <div key={c.id} className={styles.consentRow}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--text)' }}>{c.consent_type.replace('_', ' ').toUpperCase()}</div>
                      <div style={{ fontSize: '11px', color: 'var(--text2)' }}>Source: {c.source}</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                      <span className={`${styles.badge} ${c.status === 'granted' ? styles.badgeSuccess : styles.badgeDanger}`}>
                        {c.status}
                      </span>
                      <button className="btn btn-ghost btn-sm" onClick={() => handleToggleConsent(c.consent_type, c.status)}>
                        Toggle
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'governance' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
            <div>
              <h3 style={{ fontSize: '14px', margin: '0 0 var(--space-2) 0', color: 'var(--text)' }}>Data Portability (GDPR Article 20 / DPDP)</h3>
              <p style={{ fontSize: '13px', color: 'var(--text2)', margin: '0 0 var(--space-3) 0' }}>
                Generate a machine-readable JSON package containing all profile, identity, timeline, and consent records for this individual.
              </p>
              <button className="btn btn-accent" onClick={handleExportData}>
                Export Customer 360 Package (JSON)
              </button>
            </div>

            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 'var(--space-4)' }}>
              <h3 style={{ fontSize: '14px', margin: '0 0 var(--space-2) 0', color: 'var(--red)' }}>Right to Erasure / Anonymization (GDPR Article 17)</h3>
              <p style={{ fontSize: '13px', color: 'var(--text2)', margin: '0 0 var(--space-3) 0' }}>
                Irreversibly anonymize customer PII (email, phone, name, attributes) and set status to forgotten.
              </p>
              {!showConfirmDelete ? (
                <button className="btn btn-danger btn-sm" onClick={() => setShowConfirmDelete(true)}>
                  Request Erasure / Anonymize Customer
                </button>
              ) : (
                <div style={{ background: 'rgba(216, 87, 75, 0.1)', padding: 'var(--space-4)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--red)' }}>
                  <p style={{ fontSize: '13px', color: 'var(--red)', margin: '0 0 var(--space-3) 0', fontWeight: 600 }}>
                    <Icon name="alert" /> Are you sure you want to permanently anonymize {profile.full_name}? This action is irreversible.
                  </p>
                  <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                    <button className="btn btn-danger btn-sm" onClick={handleDeleteCustomer} disabled={isDeleting}>
                      {isDeleting ? 'Anonymizing...' : 'Yes, Permanently Anonymize'}
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setShowConfirmDelete(false)}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
