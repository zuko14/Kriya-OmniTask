import { Icon } from '../brand/Icon';

export interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  actionName: string;
  consequence: string;
  isHighRisk?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  isOpen,
  title,
  actionName,
  consequence,
  isHighRisk = false,
  confirmLabel = 'Confirm Action',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!isOpen) return null;

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
    >
      <div
        className="modal"
        style={{
          borderColor: isHighRisk ? 'var(--red-border-strong)' : undefined,
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-4)',
        }}
      >
        <header>
          <div
            className="eyebrow"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-1)',
              color: isHighRisk ? 'var(--red)' : 'var(--amber)',
              marginBottom: 'var(--space-2)',
              fontWeight: 600,
            }}
          >
            {isHighRisk && <Icon name="alert" />}
            {isHighRisk ? 'High-Risk Action Confirmation' : 'Action Confirmation'}
          </div>
          <h2
            id="confirm-dialog-title"
            className="modal-title"
          >
            {title}
          </h2>
        </header>

        <div
          style={{
            background: 'var(--surface2)',
            border: 'var(--border-width) solid var(--border)',
            borderRadius: 'var(--radius-control)',
            padding: 'var(--space-3)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-2)',
            fontSize: 'var(--text-sm)',
          }}
        >
          <div>
            <strong style={{ color: 'var(--text)' }}>Target Action: </strong>
            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text2)' }}>{actionName}</span>
          </div>
          <div>
            <strong style={{ color: isHighRisk ? 'var(--red)' : 'var(--amber)' }}>Consequence: </strong>
            <span style={{ color: 'var(--text2)' }}>{consequence}</span>
          </div>
        </div>

        <footer style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)', marginTop: 'var(--space-2)' }}>
          <button onClick={onCancel} className="btn btn-ghost">
            {cancelLabel}
          </button>
          <button onClick={onConfirm} className={isHighRisk ? 'btn btn-danger' : 'btn btn-accent'}>
            {confirmLabel}
          </button>
        </footer>
      </div>
    </div>
  );
}
