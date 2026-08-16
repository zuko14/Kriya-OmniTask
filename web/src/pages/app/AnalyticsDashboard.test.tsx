import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router';
import { AnalyticsDashboard } from './AnalyticsDashboard';

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

const mockSpendSummary = {
  totalCostUsd: 145.82,
  byCategory: {
    llm_generation: 98.45,
    tool_api_calls: 32.1,
    vector_search: 15.27,
  },
  byProvider: {
    openai: 80.5,
    anthropic: 50.05,
    google: 15.27,
  },
  period: 'August 2026',
};

const mockEconomics = {
  economics: [
    {
      outcomeType: 'lead_qualified',
      totalCount: 420,
      totalValueUsd: 2100.0,
      totalCostUsd: 42.0,
      roiMultiplier: 50.0,
      costPerOutcomeUsd: 0.1,
    },
  ],
};

const mockBudget = {
  monthlyBudgetLimitUsd: 500.0,
  currentMonthSpendUsd: 145.82,
  isCircuitBreakerTripped: false,
  alertThresholdPct: 80,
};

describe('AnalyticsDashboard Page', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('renders cost intelligence metrics, spend breakdown charts, and unit economics', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.includes('/api/v1/cost/summary')) {
          return Promise.resolve(jsonResponse(mockSpendSummary));
        }
        if (url.includes('/api/v1/cost/outcomes/unit-economics')) {
          return Promise.resolve(jsonResponse(mockEconomics));
        }
        if (url.includes('/api/v1/cost/budget')) {
          return Promise.resolve(jsonResponse(mockBudget));
        }
        return Promise.resolve(jsonResponse({}, false, 404));
      })
    );

    render(
      <BrowserRouter>
        <AnalyticsDashboard />
      </BrowserRouter>
    );

    expect(await screen.findByText('Cost Intelligence & Business Outcome Analytics')).toBeInTheDocument();
    const spendMatches = await screen.findAllByText(/145\.82/);
    expect(spendMatches.length).toBeGreaterThanOrEqual(1);
    const valMatches = await screen.findAllByText(/2100\.00/);
    expect(valMatches.length).toBeGreaterThanOrEqual(1);
    expect(await screen.findByText('Spend by Cost Category')).toBeInTheDocument();
    expect(await screen.findByText('Spend by Model Provider')).toBeInTheDocument();
    expect(await screen.findByText(/lead qualified/i)).toBeInTheDocument();
    expect(await screen.findByText('50.0x')).toBeInTheDocument();
  });
});
