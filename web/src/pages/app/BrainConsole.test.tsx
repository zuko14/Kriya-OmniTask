import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router';
import { BrainConsole } from './BrainConsole';
import { apiFetch } from '../../lib/apiClient';

vi.mock('../../lib/apiClient', () => ({
  apiFetch: vi.fn(),
  ApiError: class extends Error {},
}));

describe('BrainConsole Component (§18.6)', () => {
  const mockOverviewResponse = {
    success: true,
    config: {
      brainSupply: 'byo',
      monthlyBudgetUsd: 100,
      dailyBudgetUsd: 10,
      currentMonthSpendUsd: 45,
      currentDaySpendUsd: 3.5,
      status: 'active',
    },
    activeBrains: [
      {
        id: 'brain_1',
        provider: 'anthropic',
        modelId: 'claude-3-5-sonnet-20241022',
        modelVersion: '20241022',
        keyLastFour: '7f2a',
        status: 'certified',
        healthStatus: 'healthy',
        certifiedTiers: ['T1', 'T2', 'T3', 'T4'],
        certifiedLanguages: ['en', 'hi', 'te'],
        assignedAgents: ['lead_qualification_specialist', 'customer_support_specialist'],
        currentMonthSpendUsd: 45,
        expiresAt: '2026-09-20T00:00:00Z',
      },
    ],
    spendStatus: {
      monthlyBudgetUsd: 100,
      currentMonthSpendUsd: 45,
      utilizationPercentage: 45,
      dailyAverageSpendUsd: 3.5,
      thresholdTier: 'normal',
      actionTaken: 'none',
      anomalyWatchActive: true,
      anomalyDetected: false,
    },
    coverage: {
      allCovered: true,
      totalAgentsCount: 2,
      coveredAgentsCount: 2,
      uncoveredAgentsCount: 0,
      statusHeadline: 'Every agent in your workforce has a certified brain.',
      isHealthy: true,
    },
  };

  const mockCatalogueResponse = {
    success: true,
    catalogue: [
      {
        id: 'cat_sonnet',
        provider: 'anthropic',
        modelId: 'claude-3-5-sonnet-20241022',
        displayName: 'Claude 3.5 Sonnet',
        contextWindow: 200000,
        indicativeCostPerMillionInr: 250,
        suitabilityState: 'RECOMMENDED',
        isSelectable: true,
        advisoryNotice: 'Advisory only — based on general model characteristics.',
      },
      {
        id: 'cat_llama_unsuitable',
        provider: 'openrouter',
        modelId: 'meta-llama/llama-3-8b-instruct:free',
        displayName: 'Llama 3 8B Instruct (Free)',
        contextWindow: 8000,
        indicativeCostPerMillionInr: 0,
        suitabilityState: 'UNSUITABLE',
        failedHardRequirement: 'Fails hard requirements: structured output and minimum 32k context window (has 8k)',
        isSelectable: false,
        advisoryNotice: 'Advisory only — based on general model characteristics.',
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders overview with BYO supply badge, active brains, and spend bar', async () => {
    (apiFetch as any).mockResolvedValueOnce(mockOverviewResponse);

    render(
      <BrowserRouter>
        <BrainConsole />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('BRAIN')).toBeDefined();
      expect(screen.getByTestId('supply-mode-badge').textContent).toContain('Supply: BYO · your key, your bill');
      expect(screen.getByText('claude-3-5-sonnet-20241022')).toBeDefined();
      expect(screen.getByText('T1')).toBeDefined();
      expect(screen.getByText('T4')).toBeDefined();
      expect(screen.getByText('EN')).toBeDefined();
      expect(screen.getByText('HI')).toBeDefined();
      expect(screen.getAllByRole('img', { name: 'certified' }).length).toBeGreaterThanOrEqual(4);
      expect(screen.getByTestId('workforce-coverage-row').textContent).toContain(
        'Every agent in your workforce has a certified brain.'
      );
    });
  });

  it('renders managed mode banner when supply is managed', async () => {
    (apiFetch as any).mockResolvedValueOnce({
      ...mockOverviewResponse,
      config: {
        ...mockOverviewResponse.config,
        brainSupply: 'managed',
      },
    });

    render(
      <BrowserRouter>
        <BrainConsole />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('supply-mode-badge').textContent).toContain(
        'Supply: Managed · Supplied by Kriya under your managed plan'
      );
    });
  });

  it('handles Add Brain wizard flow end-to-end', async () => {
    (apiFetch as any).mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/v1/brain/overview') return Promise.resolve(mockOverviewResponse);
      if (url === '/api/v1/brain/catalogue') return Promise.resolve(mockCatalogueResponse);
      if (url === '/api/v1/brain/validate-key') {
        return Promise.resolve({ success: true, validation: { valid: true, keyLastFour: '7f2a' } });
      }
      if (url === '/api/v1/brain/estimate-check') {
        return Promise.resolve({
          success: true,
          estimate: {
            estimatedTokens: 125000,
            estimatedCostInr: 34,
            estimatedCostUsd: 0.40,
            disclosureText: 'The alignment check will use approximately 125,000 tokens (≈₹34 est.) from your account.',
          },
        });
      }
      if (url === '/api/v1/brain/alignment-check') {
        return Promise.resolve({ success: true, runId: 'run_123' });
      }
      if (url.startsWith('/api/v1/brain/alignment-check/')) {
        return Promise.resolve({
          success: true,
          run: {
            id: 'run_123',
            status: 'completed',
            currentStage: 6,
            reportCard: {
              runId: 'run_123',
              modelId: 'claude-3-5-sonnet-20241022',
              modelVersion: '20241022',
              provider: 'anthropic',
              overallStatus: 'CERTIFIED',
              tierLanguageMatrix: {
                matrix: [
                  {
                    language: 'en',
                    nativeLabel: 'English',
                    scores: [{ tier: 'T1', score: 0.98, passed: true }],
                  },
                ],
              },
              workforceImpact: {
                canRun: ['Lead Qualification', 'Booking Specialist'],
                limited: [],
                cannot: [],
              },
              certifiedTiers: ['T1', 'T2', 'T3', 'T4'],
              certifiedLanguages: ['en', 'hi', 'te'],
            },
          },
        });
      }
      if (url === '/api/v1/brain/assign') {
        return Promise.resolve({ success: true, assignedBrain: { id: 'brain_new' } });
      }
      return Promise.resolve({ success: true });
    });

    render(
      <BrowserRouter>
        <BrainConsole />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('add-brain-btn')).toBeDefined();
    });

    // 1. Click Add Brain
    fireEvent.click(screen.getByTestId('add-brain-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('add-brain-modal')).toBeDefined();
      expect(screen.getByText('Step 1 · Provider & API Key')).toBeDefined();
    });

    // Enter key and blur
    const keyInput = screen.getByTestId('api-key-input');
    fireEvent.change(keyInput, { target: { value: 'sk-ant-test-live-key-7f2a' } });
    fireEvent.blur(keyInput);

    await waitFor(() => {
      expect(screen.getByTestId('key-valid-badge')).toBeDefined();
    });

    // 2. Click Next to go to Step 2
    fireEvent.click(screen.getByTestId('step1-next-btn'));

    await waitFor(() => {
      expect(screen.getByText('Step 2 · Select Model')).toBeDefined();
      expect(screen.getByTestId('advisory-banner')).toBeDefined();
      expect(screen.getByText('RECOMMENDED')).toBeDefined();
      expect(screen.getByText('UNSUITABLE')).toBeDefined();
    });

    // Click recommended model to go to Step 3
    fireEvent.click(screen.getByTestId('catalogue-card-claude-3-5-sonnet-20241022'));

    await waitFor(() => {
      expect(screen.getByText('Step 3 · Alignment Estimate')).toBeDefined();
      expect(screen.getByTestId('estimate-disclosure-box').textContent).toContain('≈₹34 est.');
    });

    // Click Confirm & Run
    fireEvent.click(screen.getByTestId('confirm-run-check-btn'));

    // Step 5: Report Card View
    await waitFor(() => {
      expect(screen.getByTestId('report-card-view')).toBeDefined();
      expect(screen.getByTestId('tier-language-matrix')).toBeDefined();
      expect(screen.getByTestId('workforce-impact-box').textContent).toContain('Lead Qualification');
    });

    // Assign as proposed
    fireEvent.click(screen.getByTestId('assign-proposed-btn'));

    await waitFor(() => {
      expect(screen.queryByTestId('add-brain-modal')).toBeNull();
    });
  });

  it('S54: a failed alignment-check start is shown as an error, with no pre-filled stage results or spend', async () => {
    (apiFetch as any).mockImplementation((url: string) => {
      if (url === '/api/v1/brain/overview') return Promise.resolve(mockOverviewResponse);
      if (url === '/api/v1/brain/catalogue') return Promise.resolve(mockCatalogueResponse);
      if (url === '/api/v1/brain/validate-key') return Promise.resolve({ success: true, validation: { valid: true, keyLastFour: '7f2a' } });
      if (url === '/api/v1/brain/estimate-check') {
        return Promise.resolve({ success: true, estimate: { estimatedTokens: 1, estimatedCostInr: null, estimatedCostUsd: null, disclosureText: 'estimate' } });
      }
      if (url === '/api/v1/brain/alignment-check') return Promise.reject(new Error('Provider quota exceeded'));
      return Promise.resolve({ success: true });
    });

    render(
      <BrowserRouter>
        <BrainConsole />
      </BrowserRouter>
    );
    fireEvent.click(await screen.findByTestId('add-brain-btn'));
    const keyInput = await screen.findByTestId('api-key-input');
    fireEvent.change(keyInput, { target: { value: 'sk-test-7f2a' } });
    fireEvent.blur(keyInput);
    await screen.findByTestId('key-valid-badge');
    fireEvent.click(screen.getByTestId('step1-next-btn'));
    fireEvent.click(await screen.findByTestId('catalogue-card-claude-3-5-sonnet-20241022'));
    fireEvent.click(await screen.findByTestId('confirm-run-check-btn'));

    expect((await screen.findByRole('alert')).textContent).toContain('Provider quota exceeded');
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/40\/40|20\/20|quota ok|Spend so far/);
  });
});
