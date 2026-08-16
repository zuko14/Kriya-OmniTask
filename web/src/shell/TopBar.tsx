import { useAuth } from '../lib/authContext';

export interface TopBarProps {
  onOpenCommandPalette?: () => void;
  onToggleMobileNav?: () => void;
}

export function TopBar({ onOpenCommandPalette, onToggleMobileNav }: TopBarProps) {
  const { auth, logout } = useAuth();

  return (
    <header
      style={{
        height: 56,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 var(--space-4)',
        borderBottom: '1px solid var(--color-border)',
        background: 'var(--color-surface)',
        gap: 'var(--space-3)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
        {/* Mobile menu toggle */}
        <button
          onClick={onToggleMobileNav}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'none',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-sm)',
            padding: '4px 8px',
            color: 'var(--color-ink)',
            cursor: 'pointer',
            fontSize: '16px',
          }}
          aria-label="Toggle navigation menu"
          aria-controls="main-sidebar"
        >
          ☰
        </button>

        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15, whiteSpace: 'nowrap' }}>
          XYLARC AI
          {auth && (
            <span style={{ marginLeft: 10, fontFamily: 'var(--font-body)', fontWeight: 400, fontSize: 13, color: 'var(--color-ink-muted)' }}>
              {auth.tenant.name}
            </span>
          )}
        </div>

        {/* Global Search Trigger */}
        <button
          onClick={onOpenCommandPalette}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            background: 'var(--color-surface-raised)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            padding: '5px 12px',
            color: 'var(--color-ink-muted)',
            fontSize: '13px',
            cursor: 'pointer',
            minWidth: '200px',
            justifyContent: 'space-between',
          }}
          aria-label="Open Command Palette"
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span>🔍</span>
            <span>Search Xylarc...</span>
          </span>
          <kbd
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              padding: '1px 5px',
              fontSize: '11px',
              fontFamily: 'var(--font-mono)',
            }}
          >
            ⌘K
          </kbd>
        </button>
      </div>

      {auth && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', fontSize: 13 }}>
          <span style={{ color: 'var(--color-ink-muted)' }}>{auth.user.fullName}</span>
          <button
            onClick={logout}
            style={{
              background: 'none',
              border: '1px solid var(--color-border)',
              color: 'var(--color-ink)',
              borderRadius: 'var(--radius-sm)',
              padding: '4px 10px',
              cursor: 'pointer',
            }}
            aria-label="Log out of session"
          >
            Log out
          </button>
        </div>
      )}
    </header>
  );
}
