import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { WorkflowDetail } from './WorkflowDetail';

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

const mockWorkflow = {
  id: 'wf_123',
  tenant_id: 'default',
  slug: 'kyc-verification-pipeline',
  name: 'KYC Verification Pipeline',
  description: 'Validates customer documents and performs AML sanction checks',
  trigger_type: 'webhook',
  dag_json: JSON.stringify({
    steps: [
      {
        id: 'doc_ocr',
        name: 'Document OCR Extract',
        type: 'tool_execution',
        dependsOn: [],
        config: { toolName: 'vision_ocr' },
      },
      {
        id: 'aml_check',
        name: 'Sanctions Check',
        type: 'policy_check',
        dependsOn: ['doc_ocr'],
        config: { category: 'compliance' },
      },
    ],
  }),
  is_active: 1,
  version: '2.0.1',
  created_at: new Date().toISOString(),
};

const mockExecutions = {
  total: 1,
  executions: [
    {
      id: 'exec_777',
      workflow_id: 'wf_123',
      status: 'completed',
      current_step_id: null,
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    },
  ],
};

describe('WorkflowDetail Page', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('renders workflow DAG step pipeline and executions table', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.includes('/api/v1/workflows/executions')) {
          return Promise.resolve(jsonResponse(mockExecutions));
        }
        if (url.includes('/api/v1/workflows/kyc-verification-pipeline')) {
          return Promise.resolve(jsonResponse(mockWorkflow));
        }
        return Promise.resolve(jsonResponse({}, false, 404));
      })
    );

    render(
      <MemoryRouter initialEntries={['/app/workflows/kyc-verification-pipeline']}>
        <Routes>
          <Route path="/app/workflows/:slug" element={<WorkflowDetail />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText('KYC Verification Pipeline')).toBeInTheDocument();
    expect(await screen.findByText('Document OCR Extract')).toBeInTheDocument();
    expect(await screen.findByText('Sanctions Check')).toBeInTheDocument();
    expect(await screen.findByText('exec_777')).toBeInTheDocument();
  });

  it('allows triggering workflow execution', async () => {
    const fetchMock = vi.fn((url: string, opts?: RequestInit) => {
      if (url.includes('/api/v1/workflows/kyc-verification-pipeline/trigger') && opts?.method === 'POST') {
        return Promise.resolve(jsonResponse({ id: 'exec_new_888', status: 'pending' }));
      }
      if (url.includes('/api/v1/workflows/executions')) {
        return Promise.resolve(jsonResponse(mockExecutions));
      }
      if (url.includes('/api/v1/workflows/kyc-verification-pipeline')) {
        return Promise.resolve(jsonResponse(mockWorkflow));
      }
      return Promise.resolve(jsonResponse({}, false, 404));
    });

    vi.stubGlobal('fetch', fetchMock);

    render(
      <MemoryRouter initialEntries={['/app/workflows/kyc-verification-pipeline']}>
        <Routes>
          <Route path="/app/workflows/:slug" element={<WorkflowDetail />} />
        </Routes>
      </MemoryRouter>
    );

    const triggerBtns = await screen.findAllByRole('button', { name: /Trigger Execution/i });
    fireEvent.click(triggerBtns[0]);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/workflows/kyc-verification-pipeline/trigger'),
        expect.objectContaining({ method: 'POST' })
      );
    });

    expect(await screen.findByText(/Workflow execution triggered successfully/i)).toBeInTheDocument();
  });
});
