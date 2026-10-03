import React from 'react';
import { TrustTier } from './MetricBlock';

export interface EvidenceLinkProps {
  text: string;
  source: string;
  trustTier?: TrustTier;
  onClick?: () => void;
  href?: string;
  style?: React.CSSProperties;
}

export function EvidenceLink({
  text,
  source,
  trustTier = 'A',
  onClick,
  href,
  style = {},
}: EvidenceLinkProps) {
  const isExternal = trustTier === 'C' || trustTier === 'D';

  const content = (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--space-1)',
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--text-xs)',
        color: isExternal ? 'var(--cyan)' : 'var(--accent)',
        textDecoration: 'underline',
        cursor: 'pointer',
        ...style,
      }}
      onClick={onClick}
    >
      {isExternal && (
        <span
          style={{ fontWeight: 700, textDecoration: 'none' }}
          title="External / Untrusted data source"
        >
          ◇
        </span>
      )}
      <span>{text}</span>
      <span style={{ color: 'var(--text3)', textDecoration: 'none' }}>({source})</span>
    </span>
  );

  if (href) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
        {content}
      </a>
    );
  }

  return content;
}
