import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router';
import { PlatformTenants } from './PlatformTenants';

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

const mockTenants = {
  count: 2,
  tenants: [
    {
      id: 'tenant_acme_123',
      name: 'Acme Corp',
      slug: 'acme-corp',
      status: 'active',
      plan_tier: 'enterprise',
      channel_plan: 'combined',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: 'tenant_beta_456',
      name: 'Beta Inc',
      slug: 'beta-inc',
      status: 'suspended',
      plan_tier: 'growth',
      channel_plan: 'single_channel',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ],
};

describe('PlatformTenants Page', () => {
  beforeEach(() => {
    sessionStorage.clear();
    sessionStorage.setItem('xylarc_access_token', 'test_platform_token');
    vi.restoreAllMocks();
  });

  it('renders tenant registry list with lifecycle badges', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.includes('/api/v1/admin/tenants')) {
          return Promise.resolve(jsonResponse(mockTenants));
        }
        return Promise.resolve(jsonResponse({}, false, 404));
      })
    );

    render(
      <BrowserRouter>
        <PlatformTenants />
      </BrowserRouter>
    );

    expect(await screen.findByText('Platform Tenant Registry & Lifecycle')).toBeInTheDocument();
    expect(await screen.findByText('Acme Corp')).toBeInTheDocument();
    expect(await screen.findByText('tenant_acme_123')).toBeInTheDocument();
    expect(await screen.findByText('Beta Inc')).toBeInTheDocument();
    expect(await screen.findByText('Suspend')).toBeInTheDocument();
    expect(await screen.findByText('Reactivate')).toBeInTheDocument();
  });

  it('allows provisioning a new tenant organization', async () => {
    const fetchMock = vi.fn((url: string, opts?: RequestInit) => {
      if (url.includes('/api/v1/admin/tenants/provision') && opts?.method === 'POST') {
        return Promise.resolve(
          jsonResponse(
            {
              id: 'tenant_gamma_789',
              name: 'Gamma Corp',
              slug: 'gamma-corp',
              status: 'active',
              plan_tier: 'growth',
              channel_plan: 'combined',
            },
            true,
            201
          )
        );
      }
      if (url.includes('/api/v1/admin/tenants')) {
        return Promise.resolve(jsonResponse(mockTenants));
      }
      return Promise.resolve(jsonResponse({}, false, 404));
    });

    vi.stubGlobal('fetch', fetchMock);

    render(
      <BrowserRouter>
        <PlatformTenants />
      </BrowserRouter>
    );

    const openProvisionBtns = await screen.findAllByRole('button', { name: /Provision New Tenant/i });
    fireEvent.click(openProvisionBtns[0]);

    const nameInput = screen.getByLabelText(/Organization Name \*/i);
    const emailInput = screen.getByLabelText(/Admin Contact Email \*/i);

    fireEvent.change(nameInput, { target: { value: 'Gamma Corp' } });
    fireEvent.change(emailInput, { target: { value: 'admin@gamma.com' } });

    const submitBtns = screen.getAllByRole('button', { name: /Provision Tenant/i });
    fireEvent.click(submitBtns[0]);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/admin/tenants/provision'),
        expect.objectContaining({ method: 'POST' })
      );
    });

    expect(await screen.findByText(/Tenant 'Gamma Corp' \(gamma-corp\) provisioned successfully/i)).toBeInTheDocument();
  });

  it('allows updating a tenant status with operator reason', async () => {
    const fetchMock = vi.fn((url: string, opts?: RequestInit) => {
      if (url.includes('/api/v1/admin/tenants/tenant_acme_123/status') && opts?.method === 'PUT') {
        return Promise.resolve(jsonResponse({ message: "Tenant 'tenant_acme_123' status updated to 'suspended'." }));
      }
      if (url.includes('/api/v1/admin/tenants')) {
        return Promise.resolve(jsonResponse(mockTenants));
      }
      return Promise.resolve(jsonResponse({}, false, 404));
    });

    vi.stubGlobal('fetch', fetchMock);

    render(
      <BrowserRouter>
        <PlatformTenants />
      </BrowserRouter>
    );

    const suspendBtns = await screen.findAllByRole('button', { name: /Suspend/i });
    fireEvent.click(suspendBtns[0]);

    const reasonInput = screen.getByLabelText(/Operator Audit Reason \*/i);
    fireEvent.change(reasonInput, { target: { value: 'Payment failure investigation' } });

    const confirmBtn = screen.getByRole('button', { name: /Confirm SUSPENDED/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/admin/tenants/tenant_acme_123/status'),
        expect.objectContaining({ method: 'PUT' })
      );
    });

    expect(await screen.findByText(/Tenant 'Acme Corp' status updated to 'suspended'/i)).toBeInTheDocument();
  });
});
