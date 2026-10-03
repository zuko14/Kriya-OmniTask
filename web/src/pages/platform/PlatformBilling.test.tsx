import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router';
import { PlatformBilling } from './PlatformBilling';

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

const mockTenants = {
  count: 2,
  tenants: [
    {
      id: 'tenant_acme_1',
      name: 'Acme Enterprise',
      slug: 'acme-ent',
      status: 'active',
      plan_tier: 'enterprise',
      channel_plan: 'combined',
      created_at: new Date().toISOString(),
    },
    {
      id: 'tenant_beta_2',
      name: 'Beta Starter',
      slug: 'beta-start',
      status: 'active',
      plan_tier: 'starter',
      channel_plan: 'single_channel',
      created_at: new Date().toISOString(),
    },
  ],
};

const mockPlans = {
  count: 2,
  plans: [
    {
      id: 'plan_starter',
      name: 'Starter',
      tier: 'starter',
      priceMonthlyUsd: 199,
      features: ['5 agents'],
      maxAgents: 5,
      maxMonthlyWorkflows: 10000,
    },
    {
      id: 'plan_enterprise',
      name: 'Enterprise',
      tier: 'enterprise',
      priceMonthlyUsd: 1499,
      features: ['Unlimited agents'],
      maxAgents: 100,
      maxMonthlyWorkflows: 500000,
    },
  ],
};

const mockInvoices = {
  count: 1,
  invoices: [
    {
      id: 'inv_plat_01',
      tenant_id: 'tenant_acme_1',
      period_start: '2026-08-01',
      period_end: '2026-08-31',
      total_cents: 149900,
      status: 'paid',
    },
  ],
};

describe('PlatformBilling Page', () => {
  beforeEach(() => {
    sessionStorage.clear();
    sessionStorage.setItem('kriya_access_token', 'test_platform_token');
    vi.restoreAllMocks();
  });

  it('renders platform financial KPIs, tenant subscriptions, and plan catalog', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.includes('/api/v1/admin/tenants')) {
          return Promise.resolve(jsonResponse(mockTenants));
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
        <PlatformBilling />
      </BrowserRouter>
    );

    expect(await screen.findByText('Platform Revenue, Subscriptions & Monetization')).toBeInTheDocument();
    expect(await screen.findByText('Acme Enterprise')).toBeInTheDocument();
    expect(await screen.findByText('Beta Starter')).toBeInTheDocument();
    expect(await screen.findByText('$1,698')).toBeInTheDocument(); // 1499 + 199 = 1698 MRR
    expect(await screen.findByText('$20,376')).toBeInTheDocument(); // 1698 * 12 = 20376 ARR
    expect(await screen.findByText('inv_plat_01')).toBeInTheDocument();
  });
});
