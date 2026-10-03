import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router';
import { PlatformTenants } from './PlatformTenants';

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

const mockRoster = {
  count: 2,
  organizations: [
    {
      id: 'tenant_kaveri_456',
      name: 'Kaveri Motors',
      slug: 'kaveri-motors',
      status: 'degraded',
      planTier: 'enterprise',
      channelPlan: 'voice_only',
      brainSupplyMode: 'byo',
      agentCount: 5,
      executions24h: 1203,
      errorRatePct: 6.1,
      spendInr: 4100,
      quotaBudgetInr: 10000,
      spendRatioPct: 41,
      attentionCount: 12,
      activeElevation: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: 'tenant_meridian_123',
      name: 'Meridian Retail',
      slug: 'meridian-retail',
      status: 'active',
      planTier: 'growth',
      channelPlan: 'combined',
      brainSupplyMode: 'byo',
      agentCount: 7,
      executions24h: 4812,
      errorRatePct: 0.4,
      spendInr: 4850,
      quotaBudgetInr: 10000,
      spendRatioPct: 49,
      attentionCount: 0,
      activeElevation: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ],
};

describe('PlatformTenants Page (§17.1 Organizations Roster)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    sessionStorage.setItem('kriya_access_token', 'test_platform_token');
    vi.restoreAllMocks();
  });

  it('renders organizations roster table with worst-first sorting and metrics', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.includes('/api/v1/admin/organizations/roster') || url.includes('/api/v1/admin/tenants')) {
          return Promise.resolve(jsonResponse(mockRoster));
        }
        return Promise.resolve(jsonResponse({}, false, 404));
      })
    );

    render(
      <BrowserRouter>
        <PlatformTenants />
      </BrowserRouter>
    );

    expect(await screen.findByText('Organizations Roster')).toBeInTheDocument();
    expect(await screen.findByText('Meridian Retail')).toBeInTheDocument();
    expect(await screen.findByText('Kaveri Motors')).toBeInTheDocument();
    expect(screen.getByText('4,812')).toBeInTheDocument();
    expect(screen.getByText('1,203')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Attention items' })).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('allows guided provisioning of a new tenant organization (§17.2)', async () => {
    const fetchMock = vi.fn((url: string, opts?: RequestInit) => {
      if (url.includes('/api/v1/admin/tenants/provision') && opts?.method === 'POST') {
        return Promise.resolve(
          jsonResponse(
            {
              id: 'tenant_anand_789',
              slug: 'anand-textiles',
              adminEmail: 'admin@anand.test',
              generatedAdminPassword: '0123456789abcdef01234567',
              tenant: {
                id: 'tenant_anand_789',
                name: 'Anand Textiles',
                slug: 'anand-textiles',
                status: 'active',
                plan_tier: 'growth',
                channel_plan: 'whatsapp_only',
              },
            },
            true,
            201
          )
        );
      }
      if (url.includes('/api/v1/admin/organizations/roster') || url.includes('/api/v1/admin/tenants')) {
        return Promise.resolve(jsonResponse(mockRoster));
      }
      return Promise.resolve(jsonResponse({}, false, 404));
    });

    vi.stubGlobal('fetch', fetchMock);

    render(
      <BrowserRouter>
        <PlatformTenants />
      </BrowserRouter>
    );

    const openProvisionBtns = await screen.findAllByRole('button', { name: /Provision/i });
    fireEvent.click(openProvisionBtns[0]);

    // Step 1: Identity
    const nameInput = await screen.findByPlaceholderText(/e\.g\. Kaveri Motors/i);
    fireEvent.change(nameInput, { target: { value: 'Anand Textiles' } });

    const nextStep1Btn = screen.getByRole('button', { name: /Next Step →/i });
    fireEvent.click(nextStep1Btn);

    // Step 2: DNA Profile
    const dnaOption = await screen.findByText(/General Enterprise Services DNA/i);
    fireEvent.click(dnaOption);
    const nextStep2Btn = screen.getByRole('button', { name: /Next Step →/i });
    fireEvent.click(nextStep2Btn);

    // Step 3: Channels
    const channelBtn = await screen.findByRole('button', { name: /WhatsApp Only/i });
    fireEvent.click(channelBtn);
    const nextStep3Btn = screen.getByRole('button', { name: /Next Step →/i });
    fireEvent.click(nextStep3Btn);

    // Step 4: Governance
    const nextStep4Btn = await screen.findByRole('button', { name: /Next Step →/i });
    fireEvent.click(nextStep4Btn);

    // Step 5: Admin Email
    const adminEmailInput = await screen.findByPlaceholderText(/admin@kaverimotors\.com/i);
    fireEvent.change(adminEmailInput, { target: { value: 'admin@anandtextiles.com' } });
    const nextStep5Btn = screen.getByRole('button', { name: /Next Step →/i });
    fireEvent.click(nextStep5Btn);

    // Step 6: Confirm
    const confirmBtn = await screen.findByRole('button', { name: /Confirm & Provision Tenant/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/admin/tenants/provision'),
        expect.objectContaining({ method: 'POST' })
      );
    });

    // One-time credential hand-off: login URL, workspace, email and the generated password.
    const creds = await screen.findByTestId('credentials-block');
    expect(creds.textContent).toContain('/admin');
    expect(creds.textContent).toContain('Workspace: anand-textiles');
    expect(creds.textContent).toContain('Email: admin@anand.test');
    expect(creds.textContent).toContain('Password: 0123456789abcdef01234567');
    const body = JSON.parse(String(fetchMock.mock.calls.find((c) => String(c[0]).includes('/provision'))![1]!.body));
    expect(body.adminPassword).toBeUndefined(); // no hardcoded default password is ever sent
  });

  it('allows temporary operator elevation into tenant (§17.6)', async () => {
    const fetchMock = vi.fn((url: string, opts?: RequestInit) => {
      if (url.includes('/elevate') && opts?.method === 'POST') {
        return Promise.resolve(
          jsonResponse({
            token: 'elevated_jwt_token_sample',
            tenant: { id: 'tenant_kaveri_456', name: 'Kaveri Motors' },
          })
        );
      }
      if (url.includes('/api/v1/admin/organizations/roster') || url.includes('/api/v1/admin/tenants')) {
        return Promise.resolve(jsonResponse(mockRoster));
      }
      return Promise.resolve(jsonResponse({}, false, 404));
    });

    vi.stubGlobal('fetch', fetchMock);

    render(
      <BrowserRouter>
        <PlatformTenants />
      </BrowserRouter>
    );

    const elevateBtns = await screen.findAllByRole('button', { name: /Elevate/i });
    fireEvent.click(elevateBtns[0]); // Kaveri Motors

    const reasonInput = await screen.findByPlaceholderText(/e\.g\. Investigating escalation ticket/i);
    fireEvent.change(reasonInput, { target: { value: 'Investigating high error rate on WhatsApp webhook' } });

    const submitElevateBtn = screen.getByRole('button', { name: /Authorize & Enter Workspace/i });
    fireEvent.click(submitElevateBtn);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/elevate'),
        expect.objectContaining({ method: 'POST' })
      );
    });

    expect(await screen.findByText(/Successfully elevated into tenant 'Kaveri Motors'/i)).toBeInTheDocument();
  });

  it('deletes a client only after typing its workspace slug and a reason, then sends status=disabled', async () => {
    const fetchMock = vi.fn((url: string, _opts?: RequestInit) => {
      if (url.includes('/status')) return Promise.resolve(jsonResponse({ message: 'ok' }));
      return Promise.resolve(jsonResponse(mockRoster));
    });
    vi.stubGlobal('fetch', fetchMock);
    render(
      <BrowserRouter>
        <PlatformTenants />
      </BrowserRouter>
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Delete client Meridian Retail' }));
    const confirm = screen.getByRole('button', { name: 'Delete client' });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'Contract ended' } });
    fireEvent.change(screen.getByLabelText(/to confirm/), { target: { value: 'meridian-wrong' } });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/to confirm/), { target: { value: 'meridian-retail' } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) => String(c[0]).includes('/tenants/tenant_meridian_123/status'));
      expect(call).toBeDefined();
      expect(JSON.parse(String(call![1]!.body))).toMatchObject({ status: 'disabled' });
    });
  });
});
