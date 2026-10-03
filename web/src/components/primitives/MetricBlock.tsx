import React from 'react';

export type TrustTier = 'A' | 'B' | 'C' | 'D' | 'E';

export interface MetricBlockProps {
  value: string | number;
  label: string;
  delta?: string;
  deltaDirection?: 'positive' | 'negative' | 'neutral';
  source: string;
  timestamp: string;
  trustTier?: TrustTier;
  onDrill?: () => void;
  isPrimary?: boolean;
  style?: React.CSSProperties;
  className?: string;
}

export function MetricBlock({
  value,
  label,
  delta,
  deltaDirection = 'neutral',
  source,
  timestamp,
  trustTier,
  onDrill,
  isPrimary = false,
  style = {},
  className = '',
}: MetricBlockProps) {
  // Hard Rule from CLAUDE1.md §14.3 & v1 §8:
  // A MetricBlock without source and timestamp MUST NOT render. Throw in development.
  if (!source || !timestamp) {
    const errorMsg = `[MetricBlock] Critical governance violation: Metric '${label}' rendered without required 'source' and 'timestamp' provenance.`;
    if (process.env.NODE_ENV !== 'production') {
      throw new Error(errorMsg);
    }
    // eslint-disable-next-line no-console
    console.error(errorMsg);
    return null;
  }

  const deltaColor =
    deltaDirection === 'positive'
      ? 'var(--green)'
      : deltaDirection === 'negative'
        ? 'var(--red)'
        : 'var(--text2)';

  const deltaArrow = deltaDirection === 'positive' ? '▲' : deltaDirection === 'negative' ? '▼' : '';

  const isExternal = trustTier === 'C' || trustTier === 'D';

  return (
    <div
      className={`stat${className ? ` ${className}` : ''}`}
      style={{
        gap: 'var(--space-2)',
        justifyContent: 'flex-start',
        ...style,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span className="stat-label">{label}</span>
        {onDrill && (
          <button
            onClick={onDrill}
            className="btn btn-link"
            style={{ padding: '2px 6px' }}
            aria-label={`View evidence for ${label}`}
          >
            Evidence ›
          </button>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-2)' }}>
        <span
          style={{
            fontSize: isPrimary ? 'var(--text-4xl)' : 'var(--text-3xl)',
            fontWeight: 600,
            color: 'var(--text-strong)',
            lineHeight: 1,
            letterSpacing: '-0.03em',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {value}
        </span>

        {delta && (
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-xs)',
              color: deltaColor,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '2px',
              fontWeight: 500,
            }}
          >
            {deltaArrow} {delta}
          </span>
        )}
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-1)',
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-2xs)',
          color: 'var(--text3)',
          marginTop: 'auto',
          paddingTop: 'var(--space-2)',
          borderTop: 'var(--border-width) solid var(--border)',
        }}
      >
        {isExternal && (
          <span
            style={{
              color: 'var(--cyan)',
              marginRight: '2px',
              fontWeight: 700,
            }}
            title="External / Untrusted data provenance"
          >
            ◇
          </span>
        )}
        <span>src: {source}</span>
        <span>·</span>
        <span>{timestamp}</span>
      </div>
    </div>
  );
}
