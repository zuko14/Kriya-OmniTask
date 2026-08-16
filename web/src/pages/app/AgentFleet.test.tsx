import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router';
import { AgentFleet } from './AgentFleet';

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

describe('AgentFleet Page', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('renders agent directory and metrics when API calls resolve', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.includes('/api/v1/agents')) {
          return Promise.resolve(
            jsonResponse({
              agents: [
                {
                  id: 'agent_lead_qualifier',
                  name: 'Inbound Lead Qualifier',
                  description: 'Engages inbound leads across WhatsApp and Web',
                  category: 'specialist',
                  department: 'sales',
                  autonomy_level: 3,
                  risk_tier: 'LOW',
                  status: 'active',
                  created_at: new Date().toISOString(),
                },
              ],
            })
          );
        }
        return Promise.resolve(jsonResponse({}, false, 404));
      })
    );

    render(
      <BrowserRouter>
        <AgentFleet />
      </BrowserRouter>
    );

    expect(await screen.findByText('Autonomous Agent Fleet & Digital Workforce')).toBeInTheDocument();
    expect(await screen.findByText('Inbound Lead Qualifier')).toBeInTheDocument();
    expect(await screen.findByText('L3')).toBeInTheDocument();
    expect(await screen.findByText('Total Fleet')).toBeInTheDocument();
    const countOnes = await screen.findAllByText('1');
    expect(countOnes.length).toBeGreaterThan(0);
  });

  it('allows bootstrapping system agent templates', async () => {
    const fetchMock = vi.fn((url: string, opts?: RequestInit) => {
      if (url.includes('/api/v1/agents/bootstrap') && opts?.method === 'POST') {
        return Promise.resolve(jsonResponse({ status: 'bootstrapped', createdCount: 8 }));
      }
      if (url.includes('/api/v1/agents')) {
        return Promise.resolve(jsonResponse({ agents: [] }));
      }
      return Promise.resolve(jsonResponse({}, false, 404));
    });

    vi.stubGlobal('fetch', fetchMock);

    render(
      <BrowserRouter>
        <AgentFleet />
      </BrowserRouter>
    );

    const bootstrapBtns = await screen.findAllByRole('button', { name: /Bootstrap Templates/i });
    fireEvent.click(bootstrapBtns[0]);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/agents/bootstrap'),
        expect.objectContaining({ method: 'POST' })
      );
    });

    expect(await screen.findByText(/Successfully bootstrapped 8 system agents/i)).toBeInTheDocument();
  });
});
