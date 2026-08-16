import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ExecutiveOverview } from './ExecutiveOverview';

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

describe('ExecutiveOverview', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('renders real data once all endpoints resolve', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.includes('/attention/items')) {
          return Promise.resolve(
            jsonResponse({ items: [{ id: 'a1', title: 'Escalated refund', priority: 'HIGH', reason_category: 'policy_violation' }], count: 1 })
          );
        }
        if (url.includes('/cost/records')) {
          return Promise.resolve(
            jsonResponse({ records: [{ id: 'c1', agentId: 'agent_1', costCategory: 'model', totalCostUsd: 1.5 }], count: 1 })
          );
        }
        if (url.includes('/bi/briefings')) {
          return Promise.resolve(
            jsonResponse({ briefings: [{ id: 'b1', briefing_date: '2026-08-15', title: 'Daily Briefing', status: 'generated' }], count: 1 })
          );
        }
        return Promise.resolve(jsonResponse({}, false, 404));
      })
    );

    render(<ExecutiveOverview />);

    expect(await screen.findByText('Escalated refund')).toBeInTheDocument();
    expect(await screen.findByText('Daily Briefing')).toBeInTheDocument();
    expect(await screen.findByText('$1.50')).toBeInTheDocument();
  });

  it('renders an in-page Access Denied state for a 403, independent of other cards', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.includes('/bi/briefings')) {
          return Promise.resolve(
            jsonResponse({ error: { code: 'FORBIDDEN', message: 'Insufficient permissions', statusCode: 403 } }, false, 403)
          );
        }
        if (url.includes('/attention/items')) {
          return Promise.resolve(jsonResponse({ items: [], count: 0 }));
        }
        return Promise.resolve(jsonResponse({ records: [], count: 0 }));
      })
    );

    render(<ExecutiveOverview />);

    expect(await screen.findByText(/Access denied/i)).toBeInTheDocument();
    expect(await screen.findByText('Nothing needs human attention right now.')).toBeInTheDocument();
  });
});
