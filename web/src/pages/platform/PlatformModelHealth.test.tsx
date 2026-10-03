import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router';
import { PlatformModelHealth } from './PlatformModelHealth';

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

const mockModels = {
  count: 2,
  models: [
    {
      id: 'model_google_gemini_2_flash',
      provider: 'google',
      modelIdentifier: 'gemini-2.0-flash',
      displayName: 'Gemini 2.0 Flash',
      status: 'active',
      contextWindowTokens: 1000000,
      inputCostPer1k: 0.00015,
      outputCostPer1k: 0.0006,
      capabilities: ['fast_classification', 'standard_reasoning'],
    },
    {
      id: 'model_anthropic_claude_35_sonnet',
      provider: 'anthropic',
      modelIdentifier: 'claude-3-5-sonnet-latest',
      displayName: 'Claude 3.5 Sonnet',
      status: 'active',
      contextWindowTokens: 200000,
      inputCostPer1k: 0.003,
      outputCostPer1k: 0.015,
      capabilities: ['complex_orchestration', 'code_generation'],
    },
  ],
};

const mockDecisions = {
  count: 1,
  decisions: [
    {
      id: 'dec_1',
      taskId: 'task_refund_987',
      taskType: 'customer_support',
      selectedModelId: 'gemini-2.0-flash',
      selectedProvider: 'google',
      fallbackOccurred: false,
      fallbackChain: [],
      latencyMs: 340,
    },
  ],
};

describe('PlatformModelHealth Page', () => {
  beforeEach(() => {
    sessionStorage.clear();
    sessionStorage.setItem('kriya_access_token', 'test_platform_token');
    vi.restoreAllMocks();
  });

  it('renders model registry and resilience routing decision logs', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.includes('/api/v1/model-resilience/models')) {
          return Promise.resolve(jsonResponse(mockModels));
        }
        if (url.includes('/api/v1/model-resilience/decisions')) {
          return Promise.resolve(jsonResponse(mockDecisions));
        }
        return Promise.resolve(jsonResponse({}, false, 404));
      })
    );

    render(
      <BrowserRouter>
        <PlatformModelHealth />
      </BrowserRouter>
    );

    expect(await screen.findByText('Model Provider Registry & Resilience Routing')).toBeInTheDocument();
    expect(await screen.findByText('Gemini 2.0 Flash')).toBeInTheDocument();
    expect(await screen.findByText('Claude 3.5 Sonnet')).toBeInTheDocument();
    expect(await screen.findByText('task_refund_987')).toBeInTheDocument();
    expect(await screen.findByText('Primary Selected')).toBeInTheDocument();
  });

  it('allows registering an approved AI model', async () => {
    const fetchMock = vi.fn((url: string, opts?: RequestInit) => {
      if (url.includes('/api/v1/model-resilience/models') && opts?.method === 'POST') {
        return Promise.resolve(
          jsonResponse(
            {
              id: 'model_deepseek_r1',
              provider: 'deepseek',
              modelIdentifier: 'deepseek-r1',
              displayName: 'DeepSeek R1',
              status: 'active',
              contextWindowTokens: 128000,
              inputCostPer1k: 0.00055,
              outputCostPer1k: 0.00219,
              capabilities: ['reasoning_chain'],
            },
            true,
            201
          )
        );
      }
      if (url.includes('/api/v1/model-resilience/models')) {
        return Promise.resolve(jsonResponse(mockModels));
      }
      if (url.includes('/api/v1/model-resilience/decisions')) {
        return Promise.resolve(jsonResponse(mockDecisions));
      }
      return Promise.resolve(jsonResponse({}, false, 404));
    });

    vi.stubGlobal('fetch', fetchMock);

    render(
      <BrowserRouter>
        <PlatformModelHealth />
      </BrowserRouter>
    );

    const openRegisterBtns = await screen.findAllByRole('button', { name: /Register Approved Model/i });
    fireEvent.click(openRegisterBtns[0]);

    const nameInput = screen.getByLabelText(/Display Name \*/i);
    const identifierInput = screen.getByLabelText(/Model API Identifier \*/i);

    fireEvent.change(nameInput, { target: { value: 'DeepSeek R1' } });
    fireEvent.change(identifierInput, { target: { value: 'deepseek-r1' } });

    const submitBtns = screen.getAllByRole('button', { name: /Register Model/i });
    fireEvent.click(submitBtns[0]);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/model-resilience/models'),
        expect.objectContaining({ method: 'POST' })
      );
    });

    expect(await screen.findByText(/Model 'DeepSeek R1' \(deepseek-r1\) registered successfully/i)).toBeInTheDocument();
  });
});
