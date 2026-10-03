/**
 * WP-7.6 accessibility floor (KRIYA_AI_DESIGN_SYSTEM.md §10–§11, 04_UI_UX_KRIYA_DESIGN.md §6).
 * Renders the real app on each main route (network mocked) and checks that interactive controls are
 * named, the skip link leads, and the CSS keeps the focus/motion/scheme/breakpoint rules.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { App } from '../App';

const css = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');

const ROUTES = [
  '/app/overview', '/app/attention', '/app/customers', '/app/conversations', '/app/agents', '/app/workflows',
  '/app/analytics', '/app/bi', '/app/knowledge', '/app/billing', '/app/brain', '/app/settings',
  '/app/traces', '/app/proof', '/app/mandates', '/app/cost', '/app/verification',
  '/platform/overview', '/platform/tenants', '/platform/fleet', '/platform/models', '/platform/models/registry',
  '/platform/skills', '/platform/security',
];
const ROLES = ['button', 'link', 'textbox', 'combobox', 'checkbox', 'searchbox'] as const;

describe('Accessibility floor across the console (WP-7.6)', () => {
  beforeEach(() => {
    sessionStorage.setItem('kriya_access_token', 'a11y');
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      const body = String(url).includes('/auth/me')
        ? { user: { id: 'u1', email: 'o@acme.test', fullName: 'Asha Owner', roles: ['owner'] }, tenant: { id: 't1', name: 'Acme', slug: 'acme', planTier: 'enterprise', channelPlan: 'combined' } }
        : {};
      return Promise.resolve({ ok: true, status: 200, json: async () => body });
    }));
    vi.stubGlobal('EventSource', class { close() {} addEventListener() {} });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  it.each(ROUTES)('%s: every interactive control has an accessible name', async (route) => {
    window.history.pushState({}, '', route);
    render(<App />);
    await screen.findByRole('main');
    await waitFor(() => expect(screen.queryByText(/^Loading/)).toBeNull(), { timeout: 3000 }).catch(() => undefined);
    const unnamed: string[] = [];
    for (const role of ROLES) {
      const all = screen.queryAllByRole(role);
      const named = new Set(screen.queryAllByRole(role, { name: /\S/ }));
      for (const el of all) if (!named.has(el)) unnamed.push(`${role}: ${el.outerHTML.slice(0, 120)}`);
    }
    expect(unnamed).toEqual([]);
  });

  it('the skip link is the first focusable element and targets a focusable main', async () => {
    window.history.pushState({}, '', '/app/overview');
    const { container } = render(<App />);
    const main = await screen.findByRole('main');
    const first = container.querySelector('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])');
    expect(first?.textContent).toBe('Skip to main content');
    expect(first?.getAttribute('href')).toBe('#main-content');
    expect(main.id).toBe('main-content');
    expect(main.getAttribute('tabindex')).toBe('-1');
  });
});

describe('CSS accessibility & responsive rules (DS §10, §11)', () => {
  const global = css('../styles/global.css');
  const tokens = css('../styles/tokens.css');
  const sidebar = css('./Sidebar.module.css');

  it('visible focus ring in the accent colour', () => {
    expect(global).toMatch(/:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--accent\)/);
  });

  it('reduced motion stops animations and transitions', () => {
    expect(global).toMatch(/prefers-reduced-motion: reduce[\s\S]*animation-duration: 0\.001ms !important[\s\S]*transition-duration: 0\.001ms !important/);
  });

  it('colour-scheme is declared for both themes', () => {
    expect(tokens).toMatch(/:root\s*\{[^}]*color-scheme: dark/);
    expect(tokens).toMatch(/\[data-theme="light"\]\s*\{[^}]*color-scheme: light/);
  });

  it('disabled controls are dimmed and unclickable; checkbox borders meet 3:1', () => {
    expect(global).toMatch(/:disabled[\s\S]*opacity: 0\.45[\s\S]*cursor: not-allowed/);
    expect(global).toMatch(/input\[type="checkbox"\][\s\S]*border: 1\.5px solid var\(--text3\)/);
  });

  it('DS breakpoints: drawer + hamburger at 768px, tighter padding at 1024px, content capped', () => {
    expect(sidebar).toContain('@media (max-width: 768px)');
    expect(sidebar).not.toContain('900px');
    expect(global).toMatch(/@media \(max-width: 768px\)\s*\{[\s\S]*\.shell-hamburger\s*\{\s*display: inline-flex/);
    expect(global).toMatch(/@media \(max-width: 1024px\)\s*\{\s*\.shell-main/);
    expect(global).toMatch(/\.shell-main > \*\s*\{[^}]*max-width: var\(--main-max\)/);
  });
});
