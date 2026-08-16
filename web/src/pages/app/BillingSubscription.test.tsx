import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router';
import { BillingSubscription } from './BillingSubscription';

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

const mockSub = {
  id: 'sub_123',
  tenantId: 'tenant_abc',
  planTier: 'growth',
  channelPlan: 'combined',
  status: 'active',
  currentPeriodStart: '2026-08-01',
  currentPeriodEnd: '2026-09-01',
};

const mockPlans = {
  count: 2,
  plans: [
    {
      id: 'plan_starter',
      name: 'Starter',
      tier: 'starter',
      priceMonthlyUsd: 199,
      features: ['Up to 5 agents', '10,000 runs'],
      maxAgents: 5,
      maxMonthlyWorkflows: 10000,
    },
    {
      id: 'plan_growth',
      name: 'Growth',
      tier: 'growth',
      priceMonthlyUsd: 499,
      features: ['Up to 20 agents', '50,000 runs'],
      maxAgents: 20,
      maxMonthlyWorkflows: 50000,
    },
  ],
};

const mockInvoices = {
  count: 1,
  invoices: [
    {
      id: 'inv_aug_2026',
      tenant_id: 'tenant_abc',
      period_start: '2026-08-01',
      period_end: '2026-08-31',
      subtotal_cents: 49900,
      tax_cents: 0,
      total_cents: 49900,
      status: 'paid',
      created_at: new Date().toISOString(),
    },
  ],
};

describe('BillingSubscription Page', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('renders active subscription, plan tiers, and invoices table', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.includes('/api/v1/billing/subscription')) {
          return Promise.resolve(jsonResponse(mockSub));
        }
        if (url.includes('/api/v1/billing/plans')) {
          return Promise.resolve(jsonResponse(mockPlans));
        }
        if (url.includes('/api/v1/billing/invoices')) {
          return Promise.resolve(jsonResponse(mockInvoices));
        }
        return Promise.resolve(jsonResponse({}, false, 404));
      })
    );

    render(
      <BrowserRouter>
        <BillingSubscription />
      </BrowserRouter>
    );

    expect(await screen.findByText('Subscription, Invoices & Plan Billing')).toBeInTheDocument();
    expect(await screen.findByText(/Growth Tier/i)).toBeInTheDocument();
    expect(await screen.findByText('$499.00')).toBeInTheDocument();
    expect(await screen.findByText('inv_aug_2026')).toBeInTheDocument();
  });

  it('allows subscribing / upgrading tier', async () => {
    const fetchMock = vi.fn((url: string, opts?: RequestInit) => {
      if (url.includes('/api/v1/billing/subscription') && opts?.method === 'POST') {
        return Promise.resolve(jsonResponse({ ...mockSub, planTier: 'starter' }));
      }
      if (url.includes('/api/v1/billing/subscription')) {
        return Promise.resolve(jsonResponse(mockSub));
      }
      if (url.includes('/api/v1/billing/plans')) {
        return Promise.resolve(jsonResponse(mockPlans));
      }
      if (url.includes('/api/v1/billing/invoices')) {
        return Promise.resolve(jsonResponse(mockInvoices));
      }
      return Promise.resolve(jsonResponse({}, false, 404));
    });

    vi.stubGlobal('fetch', fetchMock);

    render(
      <BrowserRouter>
        <BillingSubscription />
      </BrowserRouter>
    );

    const upgradeBtns = await screen.findAllByRole('button', { name: /Upgrade to Starter/i });
    fireEvent.click(upgradeBtns[0]);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/billing/subscription'),
        expect.objectContaining({ method: 'POST' })
      );
    });

    expect(await screen.findByText(/Plan updated to 'STARTER'/i)).toBeInTheDocument();
  });
});
