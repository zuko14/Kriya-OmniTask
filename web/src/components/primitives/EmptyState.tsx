import React from 'react';

export interface EmptyStateProps {
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  style?: React.CSSProperties;
}

export function EmptyState({
  title,
  message,
  actionLabel,
  onAction,
  style = {},
}: EmptyStateProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--space-8) var(--space-4)',
        textAlign: 'center',
        background: 'var(--surface2)',
        border: 'var(--border-width) dashed var(--border2)',
        borderRadius: 'var(--radius-lg)',
        gap: 'var(--space-3)',
        ...style,
      }}
    >
      <div
        style={{
          fontSize: '1rem',
          fontWeight: 600,
          color: 'var(--text-strong)',
        }}
      >
        {title}
      </div>
      <div
        style={{
          fontFamily: 'var(--font-body)',
          fontSize: 'var(--text-sm)',
          color: 'var(--text2)',
          maxWidth: 'var(--reading-max)',
          lineHeight: 1.5,
        }}
      >
        {message}
      </div>
      {actionLabel && onAction && (
        <button
          onClick={onAction}
          className="btn btn-ghost btn-sm"
          style={{ marginTop: 'var(--space-2)' }}
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
