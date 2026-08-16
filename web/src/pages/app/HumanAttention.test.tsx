import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { HumanAttention } from './HumanAttention';

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

describe('HumanAttention Page', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('renders metrics and queue items when API calls succeed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.includes('/api/v1/attention/metrics')) {
          return Promise.resolve(
            jsonResponse({
              totalItems: 12,
              pendingCount: 4,
              claimedCount: 2,
              resolvedCount: 6,
              slaBreachCount: 1,
              activeTakeoversCount: 0,
              avgResolutionMinutes: 8.5,
            })
          );
        }
        if (url.includes('/api/v1/attention/items')) {
          return Promise.resolve(
            jsonResponse({
              items: [
                {
                  id: 'item_1',
                  organization_id: 'default',
                  correlation_id: 'corr_1',
                  customer_id: 'cust_alpha',
                  channel: 'whatsapp',
                  source_agent_id: 'billing_specialist',
                  title: 'High-Value Invoice Anomaly',
                  description: 'Payment verification threshold triggered for $50k transaction',
                  reason_category: 'financial_threshold',
                  priority: 'P0_CRITICAL',
                  status: 'pending',
                  sla_expires_at: new Date(Date.now() + 600000).toISOString(),
                  created_at: new Date().toISOString(),
                },
              ],
              count: 1,
            })
          );
        }
        return Promise.resolve(jsonResponse({}, false, 404));
      })
    );

    render(<HumanAttention />);

    expect(await screen.findByText('Human Attention Center')).toBeInTheDocument();
    expect(await screen.findByText('High-Value Invoice Anomaly')).toBeInTheDocument();
    expect(await screen.findByText('P0 CRITICAL')).toBeInTheDocument();
    expect(await screen.findByText('Pending Items')).toBeInTheDocument();
    expect(await screen.findByText('4')).toBeInTheDocument();
  });

  it('allows claiming and opening resolution modal', async () => {
    const fetchMock = vi.fn((url: string, opts?: RequestInit) => {
      if (url.includes('/api/v1/attention/metrics')) {
        return Promise.resolve(
          jsonResponse({
            totalItems: 1,
            pendingCount: 1,
            claimedCount: 0,
            resolvedCount: 0,
            slaBreachCount: 0,
            activeTakeoversCount: 0,
            avgResolutionMinutes: 0,
          })
        );
      }
      if (url.includes('/api/v1/attention/items/item_1/claim')) {
        return Promise.resolve(jsonResponse({ id: 'item_1', status: 'claimed' }));
      }
      if (url.includes('/api/v1/attention/items/item_1/resolve')) {
        return Promise.resolve(jsonResponse({ id: 'item_1', status: 'resolved' }));
      }
      if (url.includes('/api/v1/attention/items')) {
        return Promise.resolve(
          jsonResponse({
            items: [
              {
                id: 'item_1',
                organization_id: 'default',
                correlation_id: 'corr_1',
                customer_id: 'cust_alpha',
                channel: 'whatsapp',
                source_agent_id: 'billing_specialist',
                title: 'High-Value Invoice Anomaly',
                description: 'Payment verification threshold triggered',
                reason_category: 'financial_threshold',
                priority: 'P0_CRITICAL',
                status: 'pending',
                sla_expires_at: new Date(Date.now() + 600000).toISOString(),
                created_at: new Date().toISOString(),
              },
            ],
            count: 1,
          })
        );
      }
      return Promise.resolve(jsonResponse({}, false, 404));
    });

    vi.stubGlobal('fetch', fetchMock);

    render(<HumanAttention />);

    const claimBtn = await screen.findByRole('button', { name: /Claim/i });
    fireEvent.click(claimBtn);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/attention/items/item_1/claim'),
        expect.objectContaining({ method: 'POST' })
      );
    });

    const resolveBtns = await screen.findAllByRole('button', { name: /^Resolve$/i });
    fireEvent.click(resolveBtns[0]);

    expect(await screen.findByRole('heading', { name: /Resolve Attention Item/i })).toBeInTheDocument();

    const submitBtn = screen.getByRole('button', { name: /Submit Resolution/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/attention/items/item_1/resolve'),
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  it('renders error state when items endpoint fails with 403', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.includes('/api/v1/attention/metrics')) {
          return Promise.resolve(
            jsonResponse({ error: { code: 'FORBIDDEN', message: 'Missing permission', statusCode: 403 } }, false, 403)
          );
        }
        return Promise.resolve(
          jsonResponse({ error: { code: 'FORBIDDEN', message: 'Missing permission', statusCode: 403 } }, false, 403)
        );
      })
    );

    render(<HumanAttention />);

    expect(await screen.findByText(/Access denied/i)).toBeInTheDocument();
  });
});
