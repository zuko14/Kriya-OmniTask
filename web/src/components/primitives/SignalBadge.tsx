import React from 'react';
import { StateDot, SignalState, STATE_LABELS } from './StateDot';

export interface SignalBadgeProps {
  state: SignalState;
  label?: string;
  size?: 'sm' | 'md';
  pulse?: boolean;
  style?: React.CSSProperties;
}

const BADGE_COLOR: Record<SignalState, string> = {
  live: 'green',
  halt: 'red',
  attention: 'amber',
  info: 'blue',
  learning: 'purple',
  external: 'cyan',
  idle: 'muted',
};

export function SignalBadge({
  state,
  label,
  size = 'md',
  pulse = false,
  style = {},
}: SignalBadgeProps) {
  const displayLabel = label || STATE_LABELS[state] || state;
  const isSm = size === 'sm';

  // DS §7.5 pill badge; the StateDot (with its accessible label) replaces the CSS dot.
  return (
    <span className={`badge badge-nodot badge-${BADGE_COLOR[state]}${isSm ? ' badge-sm' : ''}`} style={style}>
      <StateDot state={state} size={isSm ? 'sm' : 'md'} pulse={pulse} />
      <span>{displayLabel}</span>
    </span>
  );
}
