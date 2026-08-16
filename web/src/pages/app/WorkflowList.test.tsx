import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router';
import { WorkflowList } from './WorkflowList';

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

describe('WorkflowList Page', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('renders workflows list and pending approvals when API calls resolve', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.includes('/api/v1/workflows/approvals')) {
          return Promise.resolve(
            jsonResponse({
              total: 1,
              approvals: [
                {
                  id: 'appr_1',
                  execution_id: 'exec_abc',
                  step_id: 'human_review',
                  status: 'pending',
                  required_role: 'admin',
                  step_payload_json: '{}',
                  created_at: new Date().toISOString(),
                },
              ],
            })
          );
        }
        if (url.includes('/api/v1/workflows')) {
          return Promise.resolve(
            jsonResponse({
              total: 1,
              workflows: [
                {
                  id: 'wf_1',
                  tenant_id: 'default',
                  slug: 'refund-resolution-flow',
                  name: 'Refund Resolution Pipeline',
                  description: 'Multi-step refund approval and ledger sync',
                  trigger_type: 'event',
                  dag_json: JSON.stringify({ steps: [{ id: 's1', name: 'Validate Refund', type: 'agent_task' }] }),
                  is_active: 1,
                  version: '1.2.0',
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
        <WorkflowList />
      </BrowserRouter>
    );

    expect(await screen.findByText('Workflow Orchestration & Pipelines')).toBeInTheDocument();
    expect(await screen.findByText('Refund Resolution Pipeline')).toBeInTheDocument();
    expect(await screen.findByText('1 steps')).toBeInTheDocument();
    expect(await screen.findByText(/Pending Workflow Approval Gates/i)).toBeInTheDocument();
  });

  it('allows approving pending gate', async () => {
    const fetchMock = vi.fn((url: string, opts?: RequestInit) => {
      if (url.includes('/api/v1/workflows/approvals/decide') && opts?.method === 'POST') {
        return Promise.resolve(jsonResponse({ status: 'approved' }));
      }
      if (url.includes('/api/v1/workflows/approvals')) {
        return Promise.resolve(
          jsonResponse({
            total: 1,
            approvals: [
              {
                id: 'appr_1',
                execution_id: 'exec_abc',
                step_id: 'human_review',
                status: 'pending',
                required_role: 'admin',
                step_payload_json: '{}',
                created_at: new Date().toISOString(),
              },
            ],
          })
        );
      }
      if (url.includes('/api/v1/workflows')) {
        return Promise.resolve(jsonResponse({ total: 0, workflows: [] }));
      }
      return Promise.resolve(jsonResponse({}, false, 404));
    });

    vi.stubGlobal('fetch', fetchMock);

    render(
      <BrowserRouter>
        <WorkflowList />
      </BrowserRouter>
    );

    const approveBtns = await screen.findAllByRole('button', { name: /^Approve$/i });
    fireEvent.click(approveBtns[0]);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/workflows/approvals/decide'),
        expect.objectContaining({ method: 'POST' })
      );
    });

    expect(await screen.findByText(/Decided approval: APPROVED/i)).toBeInTheDocument();
  });
});
