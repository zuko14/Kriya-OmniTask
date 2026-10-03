import React from 'react';

export interface PanelProps {
  title?: string;
  eyebrow?: string;
  actions?: React.ReactNode;
  density?: 'default' | 'compact';
  footer?: React.ReactNode;
  children: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
}

export function Panel({
  title,
  eyebrow,
  actions,
  density = 'default',
  footer,
  children,
  style = {},
  className = '',
}: PanelProps) {
  return (
    <section
      className={`card${density === 'compact' ? ' card-compact' : ''}${className ? ` ${className}` : ''}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-4)',
        ...style,
      }}
    >
      {(title || eyebrow || actions) && (
        <header
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 'var(--space-3)',
            borderBottom: 'var(--border-width) solid var(--border)',
            paddingBottom: density === 'compact' ? 'var(--space-2)' : 'var(--space-3)',
          }}
        >
          <div>
            {eyebrow && (
              <div className="eyebrow" style={{ marginBottom: 'var(--space-1)' }}>
                {eyebrow}
              </div>
            )}
            {title && (
              <h2
                style={{
                  fontSize: '1rem',
                  fontWeight: 600,
                  letterSpacing: '-0.018em',
                  color: 'var(--text-strong)',
                  margin: 0,
                  lineHeight: 1.4,
                }}
              >
                {title}
              </h2>
            )}
          </div>
          {actions && <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>{actions}</div>}
        </header>
      )}

      <div style={{ flex: 1 }}>{children}</div>

      {footer && (
        <footer
          style={{
            borderTop: 'var(--border-width) solid var(--border)',
            paddingTop: density === 'compact' ? 'var(--space-2)' : 'var(--space-3)',
            marginTop: 'auto',
          }}
        >
          {footer}
        </footer>
      )}
    </section>
  );
}
