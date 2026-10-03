import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router';
import { PlatformModelRegistry } from './PlatformModelRegistry';

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

describe('PlatformModelRegistry Page (§9, §17.3)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders model certification matrix and advisory suitability disclaimer', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async (url: any) => {
      if (String(url).includes('/api/v1/models/certifications')) {
        return jsonResponse({
          success: true,
          certifications: [
            {
              id: 'cert_gemini_t1_en',
              model_id: 'gemini-2.5-pro',
              model_version: '2026.08',
              provider: 'google',
              upstream_provider: 'direct',
              tier: 'T1',
              language: 'en',
              status: 'certified',
              pass_rate: 0.99,
              latency_p95_ms: 220,
              cost_per_task_usd: 0.0008,
            },
          ],
        }) as any;
      }
      return jsonResponse({}) as any;
    });

    render(
      <BrowserRouter>
        <PlatformModelRegistry />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Model Registry & Certification Matrix/i)).toBeInTheDocument();
      expect(screen.getByText(/Advisory Only:/i)).toBeInTheDocument();
      expect(screen.getByText(/gemini-2.5-pro/i)).toBeInTheDocument();
    });
  });

  it('allows launching the 7-stage alignment check and renders report card', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async (url: any, opts: any) => {
      if (String(url).includes('/api/v1/models/alignment-check')) {
        return jsonResponse({
          success: true,
          reportCard: {
            checkId: 'chk_123',
            modelId: 'gemini-2.5-pro',
            modelVersion: '2026.08',
            overallPassed: true,
            certifiedTiers: ['T1', 'T2', 'T3', 'T4'],
            certifiedLanguages: ['en', 'hi', 'te'],
            costEstimateUsd: 0.0036,
            stages: {
              stage0_handshake: { name: 'Handshake & Region Verification', passed: true, latencyMs: 12 },
              stage6_live_fire_simulation: { name: 'Live-Fire Simulation Dry Run', passed: true, latencyMs: 45 },
            },
          },
        }) as any;
      }
      return jsonResponse({ success: true, certifications: [] }) as any;
    });

    render(
      <BrowserRouter>
        <PlatformModelRegistry />
      </BrowserRouter>
    );

    const runBtn = screen.getAllByRole('button', { name: /Run Alignment Check/i })[0];
    expect(runBtn).toBeDisabled(); // no default model is assumed
    fireEvent.change(screen.getByLabelText(/Model ID/i), { target: { value: 'gemini-2.5-pro' } });
    fireEvent.change(screen.getByLabelText(/Version/i), { target: { value: '2026.08' } });
    fireEvent.click(runBtn);

    await waitFor(() => {
      expect(screen.getByText(/Alignment Check Report Card: gemini-2.5-pro/i)).toBeInTheDocument();
      expect(screen.getByText(/Handshake & Region Verification/i)).toBeInTheDocument();
    });
  });

  it('S51: an API failure shows an error and no invented certification rows; no version-bump simulation control', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () => jsonResponse({ error: { code: 'UNAUTHORIZED', message: 'Sign in required', statusCode: 401 } }, false, 401) as any);
    render(
      <BrowserRouter>
        <PlatformModelRegistry />
      </BrowserRouter>
    );
    expect(await screen.findByText('Sign in required')).toBeInTheDocument();
    expect(screen.queryByText(/gemini-2.5-pro|gpt-4o|claude-3-5-sonnet/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Trigger Version Bump/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/T1–T4|7 Stages/)).not.toBeInTheDocument();
  });
});
