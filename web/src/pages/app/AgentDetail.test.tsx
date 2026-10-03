import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { AgentDetail } from './AgentDetail';

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

const mockAgent = {
  agent: {
    id: 'agent_support_triage',
    name: 'Customer Support Triage',
    description: 'Classifies support requests and triggers automated resolution workflows',
    category: 'manager',
    department: 'support',
    autonomy_level: 2,
    risk_tier: 'MEDIUM',
    status: 'idle',
    system_prompt: 'You are an intelligent support manager.',
    model_policy_json: JSON.stringify({ primaryModel: 'gemini-2.5-pro', temperature: 0.1 }),
    tools_allowed_json: JSON.stringify(['ticket_search', 'escalate_human']),
    created_at: new Date().toISOString(),
  },
};

const mockHistory = {
  history: [
    {
      id: 'trans_1',
      agent_id: 'agent_support_triage',
      from_state: 'draft',
      to_state: 'idle',
      action: 'publish',
      reason: 'Initial system deployment',
      actor_type: 'system',
      created_at: new Date().toISOString(),
    },
  ],
};

describe('AgentDetail Page', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('renders agent details, specs, directives, and lifecycle history', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.includes('/api/v1/agents/agent_support_triage/history')) {
          return Promise.resolve(jsonResponse(mockHistory));
        }
        if (url.includes('/api/v1/agents/agent_support_triage')) {
          return Promise.resolve(jsonResponse(mockAgent));
        }
        return Promise.resolve(jsonResponse({}, false, 404));
      })
    );

    render(
      <MemoryRouter initialEntries={['/admin/agents/agent_support_triage']}>
        <Routes>
          <Route path="/admin/agents/:id" element={<AgentDetail />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText('Customer Support Triage')).toBeInTheDocument();
    expect(await screen.findByText('Level 2')).toBeInTheDocument();
    expect(await screen.findByText('gemini-2.5-pro')).toBeInTheDocument();
    expect(await screen.findByText('ticket_search, escalate_human')).toBeInTheDocument();
    expect(await screen.findByText('Initial system deployment')).toBeInTheDocument();
  });

  it('allows triggering state transition action like Activate', async () => {
    const fetchMock = vi.fn((url: string, opts?: RequestInit) => {
      if (url.includes('/api/v1/agents/agent_support_triage/transition') && opts?.method === 'POST') {
        return Promise.resolve(
          jsonResponse({
            status: 'transitioned',
            agent: { ...mockAgent.agent, status: 'active' },
            event: { id: 'evt_1', action: 'activate' },
          })
        );
      }
      if (url.includes('/api/v1/agents/agent_support_triage/history')) {
        return Promise.resolve(jsonResponse(mockHistory));
      }
      if (url.includes('/api/v1/agents/agent_support_triage')) {
        return Promise.resolve(jsonResponse(mockAgent));
      }
      return Promise.resolve(jsonResponse({}, false, 404));
    });

    vi.stubGlobal('fetch', fetchMock);

    render(
      <MemoryRouter initialEntries={['/admin/agents/agent_support_triage']}>
        <Routes>
          <Route path="/admin/agents/:id" element={<AgentDetail />} />
        </Routes>
      </MemoryRouter>
    );

    const activateBtns = await screen.findAllByRole('button', { name: /^Activate$/i });
    fireEvent.click(activateBtns[0]);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/agents/agent_support_triage/transition'),
        expect.objectContaining({ method: 'POST' })
      );
    });

    expect(await screen.findByText(/Successfully applied state machine action 'activate'/i)).toBeInTheDocument();
  });
});
