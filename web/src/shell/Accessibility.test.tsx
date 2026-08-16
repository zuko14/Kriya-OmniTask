import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { BrowserRouter } from 'react-router';
import { AppShell } from './AppShell';
import { AuthProvider } from '../lib/authContext';

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

describe('Accessibility & Responsive Navigation (WCAG 2.1 AA)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    sessionStorage.setItem('xylarc_access_token', 'test_token');
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
