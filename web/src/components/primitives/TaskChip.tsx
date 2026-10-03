import React from 'react';
import { StateDot, SignalState } from './StateDot';

export interface TaskChipProps {
  taskType: string;
  state: SignalState;
  elapsed?: string;
  label?: string;
  onClick?: () => void;
  style?: React.CSSProperties;
}

export function TaskChip({
  taskType,
  state,
  elapsed,
  label,
  onClick,
  style = {},
}: TaskChipProps) {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        padding: 'var(--space-1) var(--space-2)',
        background: 'var(--surface2)',
        border: 'var(--border-width) solid var(--border)',
        borderRadius: 'var(--radius-sm)',
        fontSize: 'var(--text-xs)',
        fontFamily: 'var(--font-body)',
        cursor: onClick ? 'pointer' : 'default',
        ...style,
      }}
    >
      <StateDot state={state} size="sm" pulse={state === 'live'} />
      <span style={{ fontWeight: 600, color: 'var(--text)' }}>{taskType}</span>
      {label && <span style={{ color: 'var(--text2)' }}>· {label}</span>}
      {elapsed && (
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-2xs)',
            color: 'var(--text3)',
            marginLeft: 'auto',
          }}
        >
          {elapsed}
        </span>
      )}
    </div>
  );
}
