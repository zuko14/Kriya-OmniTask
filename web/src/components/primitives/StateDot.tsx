import React from 'react';

export type SignalState = 'live' | 'idle' | 'attention' | 'halt' | 'learning' | 'info' | 'external';

export interface StateDotProps {
  state: SignalState;
  size?: 'sm' | 'md' | 'lg';
  pulse?: boolean;
  showGlyph?: boolean;
  label?: string;
  className?: string;
  style?: React.CSSProperties;
}

export const STATE_GLYPHS: Record<SignalState, string> = {
  live: '●',
  idle: '○',
  attention: '▲',
  halt: '×',
  learning: '◐',
  info: '◆',
  external: '◇',
};

/** Kriya colour for each signal state (DS §2.1 semantic colours). */
export const SIGNAL_COLOR: Record<SignalState, string> = {
  live: 'var(--green)',
  halt: 'var(--red)',
  attention: 'var(--amber)',
  info: 'var(--accent)',
  learning: 'var(--purple)',
  external: 'var(--cyan)',
  idle: 'var(--text3)',
};

export const SIGNAL_BG: Record<SignalState, string> = {
  live: 'var(--green-bg)',
  halt: 'var(--red-bg)',
  attention: 'var(--amber-bg)',
  info: 'var(--blue-bg)',
  learning: 'var(--purple-bg)',
  external: 'var(--cyan-bg)',
  idle: 'var(--muted-bg)',
};

export const STATE_LABELS: Record<SignalState, string> = {
  live: 'Healthy / Active',
  idle: 'Idle / Paused',
  attention: 'Attention Required',
  halt: 'Halted / Failed',
  learning: 'Canary / Learning',
  info: 'Information',
  external: 'External Provenance',
};

const SIZE_MAP = {
  sm: '6px',
  md: '8px',
  lg: '10px',
};

export function StateDot({
  state,
  size = 'md',
  pulse = false,
  showGlyph = false,
  label,
  className = '',
  style = {},
}: StateDotProps) {
  const dotSize = SIZE_MAP[size] || SIZE_MAP.md;
  const glyph = STATE_GLYPHS[state] || '●';
  const displayLabel = label ?? state;

  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--space-1)',
        lineHeight: 1,
        ...style,
      }}
      title={displayLabel}
      aria-label={`${displayLabel} (${glyph})`}
    >
      <span
        style={{
          width: dotSize,
          height: dotSize,
          borderRadius: 'var(--radius-full)',
          backgroundColor: SIGNAL_COLOR[state],
          display: 'inline-block',
          flexShrink: 0,
          boxShadow: pulse ? `0 0 6px ${SIGNAL_COLOR[state]}` : 'none',
          animation: pulse ? 'pulse 2s infinite cubic-bezier(0.65, 0, 0.35, 1)' : 'none',
          transition: 'background-color var(--dur-instant) var(--ease-out)',
        }}
      />
      {showGlyph && (
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-xs)',
            color: SIGNAL_COLOR[state],
            userSelect: 'none',
          }}
          aria-hidden="true"
        >
          {glyph}
        </span>
      )}
      {label && (
        <span
          style={{
            fontSize: 'var(--text-xs)',
            color: 'var(--text)',
            fontFamily: 'var(--font-body)',
          }}
        >
          {label}
        </span>
      )}
    </span>
  );
}
