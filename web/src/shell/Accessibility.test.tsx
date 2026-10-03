import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { BrowserRouter } from 'react-router';
import { AppShell } from './AppShell';
import { AuthProvider } from '../lib/authContext';
import { applyTheme, getStoredTheme, saveTheme } from '../lib/theme';

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

describe('Accessibility & Responsive Navigation (WCAG 2.1 AA)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    sessionStorage.setItem('kriya_access_token', 'test_token');
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.includes('/api/v1/auth/me')) {
          return Promise.resolve(
            jsonResponse({
              user: { id: 'usr_1', email: 'admin@acme.com', fullName: 'Alice Admin', roles: ['owner'] },
              tenant: { id: 't_acme', name: 'Acme Global', slug: 'acme-global', planTier: 'enterprise', channelPlan: 'combined' },
            })
          );
        }
        return Promise.resolve(jsonResponse({}, false, 404));
      })
    );
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders standard landmark roles (header, main, nav) with accessible labels', async () => {
    render(
      <AuthProvider>
        <BrowserRouter>
          <AppShell plane="client" />
        </BrowserRouter>
      </AuthProvider>
    );

    expect(screen.getByRole('banner')).toBeInTheDocument(); // header
    expect(screen.getByRole('main')).toBeInTheDocument(); // main
    expect(screen.getByRole('navigation', { name: /Main navigation/i })).toBeInTheDocument(); // nav
  });

  it('provides accessible buttons for mobile navigation toggle, search trigger, and logout', async () => {
    render(
      <AuthProvider>
        <BrowserRouter>
          <AppShell plane="client" />
        </BrowserRouter>
      </AuthProvider>
    );

    expect(screen.getByRole('button', { name: /Toggle navigation menu/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Open Command Palette/i })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /Log out of session/i })).toBeInTheDocument();
  });

  it('toggles mobile drawer on hamburger button click and closes on close button', () => {
    render(
      <AuthProvider>
        <BrowserRouter>
          <AppShell plane="client" />
        </BrowserRouter>
      </AuthProvider>
    );

    const toggleBtn = screen.getByRole('button', { name: /Toggle navigation menu/i });
    fireEvent.click(toggleBtn);

    const closeBtn = screen.getByRole('button', { name: /Close navigation drawer/i });
    expect(closeBtn).toBeInTheDocument();

    const backdrop = screen.getByTestId('sidebar-mobile-backdrop');
    expect(backdrop).toBeInTheDocument();

    fireEvent.click(closeBtn);
    expect(screen.queryByTestId('sidebar-mobile-backdrop')).not.toBeInTheDocument();
  });

  it('supports keyboard shortcut Cmd+K to open accessible command palette dialog', () => {
    render(
      <AuthProvider>
        <BrowserRouter>
          <AppShell plane="client" />
        </BrowserRouter>
      </AuthProvider>
    );

    fireEvent.keyDown(window, { key: 'k', metaKey: true });

    const dialog = screen.getByRole('dialog', { name: /Command Palette/i });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });
});

describe('Kriya theme (DS §2.2, §12.1, §12.3)', () => {
  const renderShell = (plane: 'client' | 'platform') =>
    render(
      <AuthProvider>
        <BrowserRouter>
          <AppShell plane={plane} />
        </BrowserRouter>
      </AuthProvider>
    );
  const root = () => document.documentElement;

  beforeEach(() => {
    localStorage.clear();
    root().removeAttribute('data-theme');
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse({}, false, 401))));
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('tenant console defaults to dark and toggles to light, persisting the choice', () => {
    renderShell('client');
    expect(root().hasAttribute('data-theme')).toBe(false);

    const toggle = screen.getByRole('button', { name: /Light theme/i });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(toggle);

    expect(root().getAttribute('data-theme')).toBe('light');
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(localStorage.getItem('kriya-theme')).toBe('light');

    fireEvent.click(toggle);
    expect(root().hasAttribute('data-theme')).toBe(false);
    expect(localStorage.getItem('kriya-theme')).toBe('dark');
  });

  it('restores a saved light preference on the tenant console', () => {
    localStorage.setItem('kriya-theme', 'light');
    renderShell('client');
    expect(root().getAttribute('data-theme')).toBe('light');
  });

  it('platform console is dark only: no toggle, saved light preference ignored', () => {
    localStorage.setItem('kriya-theme', 'light');
    renderShell('platform');
    expect(root().hasAttribute('data-theme')).toBe(false);
    expect(screen.queryByRole('button', { name: /Light theme/i })).not.toBeInTheDocument();
  });

  it('leaving the shell (e.g. to login) restores dark', () => {
    localStorage.setItem('kriya-theme', 'light');
    const { unmount } = renderShell('client');
    expect(root().getAttribute('data-theme')).toBe('light');
    unmount();
    expect(root().hasAttribute('data-theme')).toBe(false);
  });

  it('theme helpers never throw when storage is unavailable (falls back to dark, applies without persisting)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(getStoredTheme()).toBe('dark');
    expect(() => saveTheme('light')).not.toThrow();
    applyTheme('light');
    expect(root().getAttribute('data-theme')).toBe('light');
  });
});
