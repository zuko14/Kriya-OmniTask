import { useAuth } from '../lib/authContext';
import { getBranding } from '../lib/branding';
import type { Theme } from '../lib/theme';
import { KriyaMark } from '../components/brand/KriyaMark';
import { Icon } from '../components/brand/Icon';

export interface TopBarProps {
  onOpenCommandPalette?: () => void;
  onToggleMobileNav?: () => void;
  /** Tenant console only; omitted on the dark-only platform console. */
  theme?: Theme;
  onToggleTheme?: () => void;
}

export function TopBar({ onOpenCommandPalette, onToggleMobileNav, theme, onToggleTheme }: TopBarProps) {
  const { auth, logout } = useAuth();
  const branding = getBranding();

  return (
    <header
      style={{
        height: 'var(--header-height)',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 var(--space-4)',
        borderBottom: 'var(--border-width) solid var(--border)',
        background: 'var(--surface)',
        gap: 'var(--space-3)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
        {/* Mobile menu toggle */}
        <button
          onClick={onToggleMobileNav}
          className="shell-hamburger"
          style={{
            alignItems: 'center',
            justifyContent: 'center',
            background: 'none',
            border: 'var(--border-width) solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            padding: 'var(--space-1) var(--space-2)',
            color: 'var(--text)',
            cursor: 'pointer',
            fontSize: 'var(--text-md)',
          }}
          aria-label="Toggle navigation menu"
          aria-controls="main-sidebar"
        >
          <Icon name="menu" />
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontWeight: 700, fontSize: 'var(--text-md)', whiteSpace: 'nowrap', color: 'var(--text-strong)' }}>
          <KriyaMark size={24} />
          <span>{branding.companyName}</span>
          <span style={{ fontWeight: 500, color: 'var(--text2)' }}>{branding.shortName}</span>
          {auth && (
            <span className="shell-hide-mobile" style={{ marginLeft: 'var(--space-2)', fontFamily: 'var(--font-body)', fontWeight: 400, fontSize: 'var(--text-sm)', color: 'var(--text2)' }}>
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
            background: 'var(--surface2)',
            border: 'var(--border-width) solid var(--border)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-1) var(--space-3)',
            color: 'var(--text2)',
            fontSize: 'var(--text-sm)',
            cursor: 'pointer',
            justifyContent: 'space-between',
          }}
          aria-label="Open Command Palette"
          className="shell-search"
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
            <Icon name="search" />
            <span className="shell-hide-mobile">Search {branding.shortName}...</span>
          </span>
          <kbd
            className="shell-hide-mobile"
            style={{
              background: 'var(--surface)',
              border: 'var(--border-width) solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              padding: '1px var(--space-1)',
              fontSize: 'var(--text-2xs)',
              fontFamily: 'var(--font-mono)',
              color: 'var(--text3)',
            }}
          >
            ⌘K
          </kbd>
        </button>
      </div>

      {onToggleTheme && (
        <button
          onClick={onToggleTheme}
          aria-pressed={theme === 'light'}
          style={{
            marginLeft: 'auto',
            background: 'none',
            border: 'var(--border-width) solid var(--border)',
            color: 'var(--text2)',
            borderRadius: 'var(--radius-sm)',
            padding: 'var(--space-1) var(--space-2)',
            fontSize: 'var(--text-sm)',
            cursor: 'pointer',
          }}
        >
          Light theme
        </button>
      )}

      {auth && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', fontSize: 'var(--text-sm)' }}>
          <span className="shell-hide-mobile" style={{ color: 'var(--text2)' }}>{auth.user.fullName}</span>
          <button
            onClick={logout}
            style={{
              background: 'none',
              border: 'var(--border-width) solid var(--border)',
              color: 'var(--text)',
              borderRadius: 'var(--radius-sm)',
              padding: 'var(--space-1) var(--space-2)',
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
