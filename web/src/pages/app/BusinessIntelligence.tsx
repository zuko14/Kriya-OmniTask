import { useState, useCallback } from 'react';
import { apiFetch, ApiError } from '../../lib/apiClient';
import { useAsync } from '../../lib/useAsync';
import { AsyncState } from '../../components/AsyncState';
import styles from './BusinessIntelligence.module.css';

export interface ExecutiveBriefing {
  id: string;
  tenant_id: string;
  briefing_date: string;
  title: string;
  summary_markdown: string;
  status: string;
  created_at: string;
}

export function BusinessIntelligence() {
  const [refreshTrigger, setRefreshTrigger] = useState<number>(0);
  const [selectedBriefingId, setSelectedBriefingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);

  // Delivery Modal
  const [showDeliverModal, setShowDeliverModal] = useState<boolean>(false);
  const [phoneNumber, setPhoneNumber] = useState<string>('');
  const [isDelivering, setIsDelivering] = useState<boolean>(false);

  const fetchBriefings = useCallback(() => {
    return apiFetch<{ briefings: ExecutiveBriefing[]; count: number }>('/api/v1/bi/briefings');
  }, [refreshTrigger]);

  const briefingsState = useAsync(fetchBriefings, [fetchBriefings]);

  const handleGenerate = async () => {
    try {
      setIsGenerating(true);
      setActionError(null);
      setActionSuccess(null);
      const res = await apiFetch<ExecutiveBriefing>('/api/v1/bi/briefings/generate', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setActionSuccess(`Generated briefing '${res.title}' successfully.`);
      setSelectedBriefingId(res.id);
      setRefreshTrigger((prev) => prev + 1);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Failed to generate briefing');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDeliver = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBriefingId || !phoneNumber) return;
    try {
      setIsDelivering(true);
      setActionError(null);
      await apiFetch(`/api/v1/bi/briefings/${selectedBriefingId}/deliver`, {
        method: 'POST',
        body: JSON.stringify({ recipientPhoneNumber: phoneNumber }),
      });
      setActionSuccess(`Briefing queued for outbound delivery to ${phoneNumber}.`);
      setShowDeliverModal(false);
      setPhoneNumber('');
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Failed to queue delivery');
    } finally {
      setIsDelivering(false);
    }
  };

  const briefings = briefingsState.status === 'success' ? briefingsState.data.briefings : [];
  const selectedBriefing = briefings.find((b) => b.id === selectedBriefingId) || briefings[0] || null;

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.titleGroup}>
          <h1>Business Intelligence & Executive Briefings</h1>
          <p className={styles.subtitle}>Daily multi-agent executive synthesis, cross-department metrics, and outbound broadcast.</p>
        </div>
        <div className={styles.headerActions}>
          <button className={styles.btnPrimary} onClick={handleGenerate} disabled={isGenerating}>
            {isGenerating ? 'Synthesizing...' : '⚡ Generate Today’s Briefing'}
          </button>
        </div>
      </header>

      {actionError && <div className={styles.errorBanner}>⚠️ {actionError}</div>}
      {actionSuccess && <div className={styles.successBanner}>✓ {actionSuccess}</div>}

      {briefingsState.status !== 'success' ? (
        <AsyncState status={briefingsState.status === 'loading' ? 'loading' : 'error'} error={briefingsState.error} />
      ) : briefings.length === 0 ? (
        <div style={{ background: 'var(--color-surface)', padding: 'var(--space-6)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', textAlign: 'center' }}>
          <p style={{ color: 'var(--color-ink-muted)', fontSize: '14px', margin: '0 0 var(--space-4) 0' }}>
            No executive daily briefings have been generated yet for your organization.
          </p>
          <button className={styles.btnPrimary} onClick={handleGenerate} disabled={isGenerating}>
            {isGenerating ? 'Synthesizing...' : 'Generate First Briefing'}
          </button>
        </div>
      ) : (
        <div className={styles.layoutGrid}>
          {/* Briefings History List */}
          <aside className={styles.sidebarList}>
            <h3 className={styles.sidebarTitle}>Past Briefings ({briefings.length})</h3>
            {briefings.map((b) => {
              const isSelected = selectedBriefing?.id === b.id;
              return (
                <div
                  key={b.id}
                  className={`${styles.briefingItem} ${isSelected ? styles.briefingItemActive : ''}`}
                  onClick={() => setSelectedBriefingId(b.id)}
                  role="button"
                  tabIndex={0}
                >
                  <div className={styles.briefingItemTitle}>{b.title}</div>
                  <div className={styles.briefingItemDate}>
                    Date: {b.briefing_date || new Date(b.created_at).toLocaleDateString()}
                  </div>
                </div>
              );
            })}
          </aside>

          {/* Briefing Viewer Card */}
          {selectedBriefing && (
            <main className={styles.viewerCard}>
              <div className={styles.viewerHeader}>
                <div>
                  <h2>{selectedBriefing.title}</h2>
                  <div style={{ display: 'flex', gap: 'var(--space-3)', fontSize: '12px', color: 'var(--color-ink-muted)', marginTop: '4px' }}>
                    <span>Date: <strong>{selectedBriefing.briefing_date || new Date(selectedBriefing.created_at).toLocaleDateString()}</strong></span>
                    <span>Status: <span className={`${styles.badge} ${styles.badgeGenerated}`}>{selectedBriefing.status}</span></span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                  <button className={styles.btnSecondary} onClick={() => setShowDeliverModal(true)}>
                    📲 Deliver via WhatsApp
                  </button>
                </div>
              </div>

              <div className={styles.markdownBody}>
                {selectedBriefing.summary_markdown || 'No summary content recorded.'}
              </div>
            </main>
          )}
        </div>
      )}

      {/* Deliver Modal */}
      {showDeliverModal && (
        <div className={styles.modalBackdrop} role="dialog" aria-modal="true" aria-labelledby="deliver-modal-title">
          <div className={styles.modal}>
            <h2 className={styles.modalTitle} id="deliver-modal-title">Deliver Briefing via WhatsApp</h2>
            <p style={{ fontSize: '13px', color: 'var(--color-ink-muted)', margin: 0 }}>
              Queue outbound broadcast of '{selectedBriefing?.title}' to a verified executive phone number.
            </p>
            <form onSubmit={handleDeliver} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              <div className={styles.formField}>
                <label className={styles.formLabel} htmlFor="phone-input">Recipient Phone Number (E.164) *</label>
                <input
                  id="phone-input"
                  type="tel"
                  required
                  className={styles.input}
                  placeholder="+14155552671"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                />
              </div>

              <div className={styles.modalActions}>
                <button type="button" className={styles.btnSecondary} onClick={() => setShowDeliverModal(false)}>
                  Cancel
                </button>
                <button type="submit" className={styles.btnPrimary} disabled={isDelivering}>
                  {isDelivering ? 'Queueing...' : 'Send Broadcast'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
