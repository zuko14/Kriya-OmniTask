import React from 'react';

export interface DrillButtonProps {
  label?: string;
  onDrill?: () => void;
  style?: React.CSSProperties;
}

export function DrillButton({
  label = 'View evidence',
  onDrill,
  style = {},
}: DrillButtonProps) {
  return (
    <button
      onClick={onDrill}
      className="btn btn-link"
      style={style}
      aria-label={label}
    >
      <span>{label}</span>
      <span aria-hidden="true">›</span>
    </button>
  );
}
