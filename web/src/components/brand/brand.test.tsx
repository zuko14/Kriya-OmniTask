import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { MemoryRouter } from 'react-router';
import { KriyaMark } from './KriyaMark';
import { Icon, ICON_NAMES } from './Icon';
import { Login } from '../../pages/Login';
import { AuthProvider } from '../../lib/authContext';
import { getBranding } from '../../lib/branding';

const WEB = resolve(__dirname, '../../..');
const CANONICAL = [
  'M16 2.2 27.9 9v13.6L16 29.4 4.1 22.6V9z',
  'M11.2 7.6v16.8',
  'M22.9 7.6 14.2 16l8.7 8.4',
  'M14.2 13.3 16.9 16l-2.7 2.7L11.5 16z',
];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('KriyaMark (DS §1.1)', () => {
  it('draws exactly the canonical hexagon, stem, arm and diamond on a 32×32 viewBox', () => {
    const { container } = render(<KriyaMark size={36} />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('viewBox')).toBe('0 0 32 32');
    expect(svg.getAttribute('width')).toBe('36');
    expect([...svg.querySelectorAll('path')].map((p) => p.getAttribute('d'))).toEqual(CANONICAL);
  });

  it('gives each instance its own gradient ids, and every url() resolves to its own defs', () => {
    const { container } = render(<><KriyaMark /><KriyaMark /></>);
    const [a, b] = [...container.querySelectorAll('svg')];
    const ids = (svg: Element) => [...svg.querySelectorAll('linearGradient')].map((g) => g.id);
    expect(ids(a)).toHaveLength(3);
    expect(ids(a).filter((id) => ids(b).includes(id))).toEqual([]);
    for (const svg of [a, b]) {
      for (const p of svg.querySelectorAll('path[stroke]')) {
        const ref = p.getAttribute('stroke')!.match(/^url\(#(.+)\)$/)![1];
        expect(ids(svg)).toContain(ref);
      }
    }
  });

  it('is decorative by default and an image only when titled', () => {
    const { container, rerender } = render(<KriyaMark />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    rerender(<KriyaMark title="Kriya AI" />);
    expect(screen.getByRole('img', { name: 'Kriya AI' })).toBeInTheDocument();
  });

  it('favicon.svg uses the same canonical paths (no drift between the two copies)', () => {
    const favicon = readFileSync(join(WEB, 'public/favicon.svg'), 'utf8');
    for (const d of CANONICAL) expect(favicon).toContain(`d="${d}"`);
    expect(readFileSync(join(WEB, 'index.html'), 'utf8')).toContain('href="/favicon.svg"');
  });
});

describe('Icon (DS §8)', () => {
  it('covers the DS §8 set', () => {
    for (const n of ['activity', 'bell', 'building', 'card', 'close', 'download', 'eye', 'eye-off', 'list', 'lock',
      'megaphone', 'pencil', 'plus', 'refresh', 'search', 'send', 'settings', 'shuffle', 'trash', 'trending-up',
      'users', 'wallet', 'zap']) {
      expect(ICON_NAMES).toContain(n);
    }
  });

  it('every icon is a 24-grid, 1.75 stroke, currentColor, unfilled, decorative svg with paths', () => {
    const { container } = render(<>{ICON_NAMES.map((n) => <Icon key={n} name={n} />)}</>);
    const svgs = container.querySelectorAll('svg');
    expect(svgs).toHaveLength(ICON_NAMES.length);
    svgs.forEach((svg) => {
      expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
      expect(svg.getAttribute('stroke')).toBe('currentColor');
      expect(svg.getAttribute('stroke-width')).toBe('1.75');
      expect(svg.getAttribute('fill')).toBe('none');
      expect(svg.getAttribute('aria-hidden')).toBe('true');
      expect(svg.querySelectorAll('path').length).toBeGreaterThan(0);
    });
  });

  it('exposes a label when it stands alone', () => {
    render(<Icon name="alert" label="Warning" />);
    expect(screen.getByRole('img', { name: 'Warning' })).toBeInTheDocument();
  });
});

describe('No emoji anywhere in the console (DS §8.2 rule 1)', () => {
  it('no component or page source contains emoji / dingbat glyphs (tests excluded)', () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
        d.isDirectory() ? walk(join(dir, d.name)) : d.name.endsWith('.tsx') && !d.name.includes('.test.') ? [join(dir, d.name)] : []
      );
    const files = walk(join(WEB, 'src'));
    expect(files.length).toBeGreaterThan(50);
    const emoji = /[☀-➿]|[\u{1F300}-\u{1FAFF}]/u;
    for (const f of files) expect([f, emoji.test(readFileSync(f, 'utf8'))]).toEqual([f, false]);
  });
});

describe('Login screen (DS §6.1, §1.1)', () => {
  const renderLogin = () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 401, json: async () => ({ error: { message: 'Invalid credentials' } }) })));
    return render(
      <AuthProvider>
        <MemoryRouter>
          <Login />
        </MemoryRouter>
      </AuthProvider>
    );
  };

  it('shows the mark with the configured wordmark (branding layer, not hardcoded)', () => {
    const { container } = renderLogin();
    const b = getBranding();
    expect(container.querySelector('svg[viewBox="0 0 32 32"]')).toBeInTheDocument();
    expect(screen.getByText(b.companyName)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Admin Portal' })).toBeInTheDocument();
    expect(screen.getByLabelText('Workspace')).toBeInTheDocument();
  });

  it('owner variant asks only for email and password (platform workspace is implied server-side)', () => {
    render(
      <AuthProvider>
        <MemoryRouter>
          <Login variant="owner" />
        </MemoryRouter>
      </AuthProvider>
    );
    expect(screen.getByRole('heading', { name: 'Owner Console' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Workspace')).toBeNull();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
  });

  it('password reveal toggles the field type and its own pressed state', () => {
    renderLogin();
    const pw = screen.getByLabelText('Password');
    expect(pw).toHaveAttribute('type', 'password');
    fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(pw).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'Hide password' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('announces a failed sign-in as an alert and does not navigate', async () => {
    renderLogin();
    fireEvent.change(screen.getByLabelText('Workspace'), { target: { value: 'acme' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@acme.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });
});
