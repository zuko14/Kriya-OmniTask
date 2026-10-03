import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { ApiError } from '../../lib/apiClient';

/**
 * Honest-testing note (WP-7.4, S40): the previous tests asserted hardcoded numbers ("8,421", "3,281"),
 * invented customer names and fake "ledger cryptographic proof" hashes that no backend produced.
 * The screen now shows only what the tenant-scoped APIs return; these tests assert that contract.
 */
const api = vi.hoisted(() => ({ handler: (_path: string): Promise<unknown> => Promise.resolve({}) }));
vi.mock('../../lib/apiClient', async (orig) => ({
  ...(await orig<typeof import('../../lib/apiClient')>()),
  apiFetch: (path: string) => api.handler(path),
}));
vi.mock('../../lib/authContext', () => ({ useAuth: () => ({ auth: { tenant: { id: 't_acme', name: 'Acme' } } }) }));
vi.mock('../../lib/useRealtimeStream', () => ({
  useRealtimeStream: () => ({ events: [], agentStates: {}, isConnected: true, isReconnecting: false, error: null, client: null }),
}));

import { ExecutiveOverview } from './ExecutiveOverview';

const RUNS = { totalTraces: 140, completedTraces: 120, failedTraces: 7, escalatedTraces: 5 };
const ATTN = { pendingCount: 4, claimedCount: 2, slaBreachCount: 1 };

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/app/overview']}>
      <Routes>
        <Route path="/app/overview" element={<ExecutiveOverview />} />
        <Route path="/app/attention" element={<div>attention page</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('ExecutiveOverview — only backend-sourced numbers (S40)', () => {
  beforeEach(() => {
    api.handler = (path) =>
      path === '/api/v1/observability/metrics' ? Promise.resolve(RUNS) : path === '/api/v1/attention/metrics' ? Promise.resolve(ATTN) : Promise.reject(new Error(`unexpected ${path}`));
  });
  afterEach(() => cleanup());

  it('shows the API values with source and read time, and the theatre for the authenticated tenant', async () => {
    renderPage();
    expect(screen.getByRole('heading', { name: /Today.*Executive Overview/i })).toBeInTheDocument();
    expect(screen.getByTestId('live-agent-activity-theatre')).toBeInTheDocument();
    expect(await screen.findByText('120')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument(); // 7 failed + 5 escalated
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText(/execution_traces · 140 total · all time/)).toBeInTheDocument();
    expect(screen.getAllByText(/read \d/).length).toBe(4);
  });

  it('contains none of the former hardcoded figures or fake proofs', async () => {
    renderPage();
    await screen.findByText('120');
    const text = document.body.textContent ?? '';
    for (const fake of ['8,421', '3,281', 'Priya', 'sha256-', 'Verified Audit Records', '91%', '1.2s', 'default-tenant']) {
      expect(text).not.toContain(fake);
    }
  });

  it('says plainly that funnel/bookings/trend have no data source yet', async () => {
    renderPage();
    expect(screen.getByText(/do not exist yet/)).toBeInTheDocument();
  });

  it('attention metrics drill to the Attention Center', async () => {
    renderPage();
    const drills = await screen.findAllByRole('button', { name: /View evidence for/i });
    fireEvent.click(drills[0]);
    expect(screen.getByText('attention page')).toBeInTheDocument();
  });

  it('a failed or forbidden endpoint shows an error for that block, never a number', async () => {
    api.handler = (path) =>
      path === '/api/v1/observability/metrics'
        ? Promise.reject(new ApiError({ code: 'FORBIDDEN', message: 'Missing permission', statusCode: 403 }))
        : Promise.reject(new ApiError({ code: 'X', message: 'Attention service unavailable', statusCode: 500 }));
    renderPage();
    expect(await screen.findByText(/Access denied/)).toBeInTheDocument();
    expect(await screen.findByText('Attention service unavailable')).toBeInTheDocument();
    expect(screen.queryByText('Completed runs')).not.toBeInTheDocument();
  });
});
