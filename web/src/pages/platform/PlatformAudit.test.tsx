import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router';
import { PlatformAudit } from './PlatformAudit';

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

const mockLogs = {
  count: 2,
  logs: [
    {
      id: 'log_op_1',
      operatorId: 'operator_admin_01',
      targetTenantId: 'tenant_acme_123',
      actionType: 'tenant_suspend',
      reason: 'Billing delinquency lock',
      metadata: { requestedBy: 'finance_lead', ip: '10.0.0.1' },
      createdAt: new Date().toISOString(),
    },
    {
      id: 'log_op_2',
      operatorId: 'operator_admin_02',
      targetTenantId: undefined,
      actionType: 'maintenance_mode_toggle',
      reason: 'Database migration checkpoint',
      metadata: { readOnly: true },
      createdAt: new Date().toISOString(),
    },
  ],
};

describe('PlatformAudit Page', () => {
  beforeEach(() => {
    sessionStorage.clear();
    sessionStorage.setItem('xylarc_access_token', 'test_platform_token');
    vi.restoreAllMocks();
  });

  it('renders operator audit log table and allows payload inspection', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.includes('/api/v1/admin/audit-logs')) {
          return Promise.resolve(jsonResponse(mockLogs));
        }
        return Promise.resolve(jsonResponse({}, false, 404));
      })
    );

    render(
      <BrowserRouter>
        <PlatformAudit />
      </BrowserRouter>
    );

    expect(await screen.findByText('Platform Operator Audit Ledger')).toBeInTheDocument();
    expect((await screen.findAllByText('tenant_suspend')).length).toBeGreaterThan(0);
    expect(await screen.findByText('Billing delinquency lock')).toBeInTheDocument();
    expect(await screen.findByText('operator_admin_01')).toBeInTheDocument();

    const inspectBtns = await screen.findAllByRole('button', { name: /Inspect/i });
    fireEvent.click(inspectBtns[0]);

    expect(await screen.findByText(/Audit Event Details: log_op_1/i)).toBeInTheDocument();
    expect(await screen.findByText(/finance_lead/i)).toBeInTheDocument();
  });

  it('allows manually dispatching a security audit log', async () => {
    const fetchMock = vi.fn((url: string, opts?: RequestInit) => {
      if (url.includes('/api/v1/security/audit/log') && opts?.method === 'POST') {
        return Promise.resolve(
          jsonResponse(
            {
              id: 'sec_event_99',
              sequence_number: 46,
              event_type: 'manual_security_checkpoint',
              current_hash: 'hash_abc_123',
            },
            true,
            201
          )
        );
      }
      if (url.includes('/api/v1/admin/audit-logs')) {
        return Promise.resolve(jsonResponse(mockLogs));
      }
      return Promise.resolve(jsonResponse({}, false, 404));
    });

    vi.stubGlobal('fetch', fetchMock);

    render(
      <BrowserRouter>
        <PlatformAudit />
      </BrowserRouter>
    );

    const openLogBtns = await screen.findAllByRole('button', { name: /Log Security Event/i });
    fireEvent.click(openLogBtns[0]);

    const submitBtns = screen.getAllByRole('button', { name: /Record Hash Event/i });
    fireEvent.click(submitBtns[0]);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/security/audit/log'),
        expect.objectContaining({ method: 'POST' })
      );
    });

    expect(await screen.findByText(/Chained cryptographic audit event logged/i)).toBeInTheDocument();
  });
});
