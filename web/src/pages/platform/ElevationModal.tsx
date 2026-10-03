import { useState } from 'react';
import { apiFetch, ApiError } from '../../lib/apiClient';
import { Icon } from '../../components/brand/Icon';

export interface ElevationModalProps {
  isOpen: boolean;
  tenant: { id: string; name: string } | null;
  onClose: () => void;
  onElevated: (data: { token: string; tenant: any }) => void;
}

export function ElevationModal({ isOpen, tenant, onClose, onElevated }: ElevationModalProps) {
  const [reason, setReason] = useState('');
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen || !tenant) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (reason.trim().length < 5) {
      setError('A valid maintenance reason (minimum 5 characters) is required for elevation.');
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);
      const res = await apiFetch<{ token: string; tenant: any }>(
        `/api/v1/admin/tenants/${tenant.id}/elevate`,
        {
          method: 'POST',
          body: JSON.stringify({
            reason: reason.trim(),
            durationMinutes,
          }),
        }
      );
      onElevated(res);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to elevate into tenant workspace.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(10, 16, 23, 0.85)',
        backdropFilter: 'blur(2px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: 'var(--space-4)',
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="elevation-modal-title"
    >
      <div
        style={{
          background: 'var(--surface)',
          border: 'var(--border-width) solid var(--amber)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--elev-3)',
          width: '100%',
          maxWidth: '540px',
          padding: 'var(--space-5)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-4)',
        }}
      >
        <header>
          <div
            style={{
              fontFamily: 'var(--font-body)',
              fontSize: 'var(--text-2xs)',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: 'var(--amber)',
              marginBottom: 'var(--space-1)',
              fontWeight: 600,
            }}
          >
            <Icon name="alert" /> Operator Elevation Protocol (§17.6)
          </div>
          <h2
            id="elevation-modal-title"
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'var(--text-xl)',
              fontWeight: 600,
              color: 'var(--text)',
              margin: 0,
            }}
          >
            Elevate into {tenant.name}
          </h2>
          <p
            style={{
              fontSize: 'var(--text-xs)',
              color: 'var(--text3)',
              margin: 'var(--space-1) 0 0 0',
            }}
          >
            Elevation is time-boxed, reason-tagged, and logged permanently to the tenant&apos;s security audit trail.
          </p>
        </header>

        {error && (
          <div
            style={{
              background: 'var(--red-bg)',
              border: 'var(--border-width) solid var(--red)',
              color: 'var(--red)',
              padding: 'var(--space-2) var(--space-3)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--text-xs)',
            }}
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            <label style={{ fontSize: 'var(--text-xs)', color: 'var(--text2)', fontWeight: 500 }}>
              Elevation Reason (Audited) *
            </label>
            <textarea
              required
              rows={3}
              placeholder="e.g. Investigating escalation ticket #4812 regarding failed booking webhooks"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              style={{
                background: 'var(--surface3)',
                border: 'var(--border-width) solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                padding: 'var(--space-2)',
                color: 'var(--text)',
                fontFamily: 'var(--font-body)',
                fontSize: 'var(--text-sm)',
                resize: 'vertical',
              }}
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            <label style={{ fontSize: 'var(--text-xs)', color: 'var(--text2)', fontWeight: 500 }}>
              Session Duration *
            </label>
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              {[15, 30, 60, 120].map((mins) => (
                <button
                  key={mins}
                  type="button"
                  onClick={() => setDurationMinutes(mins)}
                  style={{
                    flex: 1,
                    background: durationMinutes === mins ? 'var(--surface2)' : 'var(--surface3)',
                    border: `var(--border-width) solid ${durationMinutes === mins ? 'var(--amber)' : 'var(--border)'}`,
                    color: durationMinutes === mins ? 'var(--amber)' : 'var(--text2)',
                    padding: 'var(--space-2)',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: 'var(--text-xs)',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {mins} mins
                </button>
              ))}
            </div>
          </div>

          <footer
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 'var(--space-3)',
              marginTop: 'var(--space-2)',
              borderTop: 'var(--border-width) solid var(--border)',
              paddingTop: 'var(--space-3)',
            }}
          >
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              style={{
                background: 'var(--surface2)',
                border: 'var(--border-width) solid var(--border)',
                borderRadius: 'var(--radius-md)',
                padding: 'var(--space-2) var(--space-4)',
                color: 'var(--text)',
                fontSize: 'var(--text-sm)',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              style={{
                background: 'var(--amber)',
                border: 'none',
                borderRadius: 'var(--radius-md)',
                padding: 'var(--space-2) var(--space-4)',
                color: '#0E141B',
                fontSize: 'var(--text-sm)',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {isSubmitting ? 'Elevating...' : 'Authorize & Enter Workspace'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
