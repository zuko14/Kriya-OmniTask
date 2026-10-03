import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router';
import { AuthProvider } from '../../lib/authContext';
import { TenantSettings } from './TenantSettings';

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

const mockMe = {
  user: { id: 'usr_1', email: 'owner@acme.com', fullName: 'Owner User', roles: ['owner', 'admin'] },
  tenant: { id: 'tenant_abc', name: 'Acme Global', slug: 'acme-global', planTier: 'growth', channelPlan: 'combined' },
};

const mockTenantDetails = {
  tenant: {
    id: 'tenant_abc',
    name: 'Acme Global',
    slug: 'acme-global',
    status: 'active',
    plan_tier: 'growth',
    channel_plan: 'combined',
    created_at: new Date().toISOString(),
  },
  configuration: { allow_takeovers: true },
  limits: {
    maxAgents: 20,
    monthlyWorkflowRuns: 50000,
    maxConcurrentSessions: 100,
  },
};

const mockUsers = {
  users: [
    {
      id: 'usr_1',
      tenant_id: 'tenant_abc',
      email: 'owner@acme.com',
      full_name: 'Owner User',
      created_at: new Date().toISOString(),
    },
  ],
};

describe('TenantSettings Page', () => {
  beforeEach(() => {
    sessionStorage.clear();
    sessionStorage.setItem('kriya_access_token', 'test_jwt');
    vi.restoreAllMocks();
  });

  it('renders tenant profile, effective limits, and team members', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.includes('/api/v1/auth/me')) {
          return Promise.resolve(jsonResponse(mockMe));
        }
        if (url.includes('/api/v1/tenants/tenant_abc')) {
          return Promise.resolve(jsonResponse(mockTenantDetails));
        }
        if (url.includes('/api/v1/users')) {
          return Promise.resolve(jsonResponse(mockUsers));
        }
        return Promise.resolve(jsonResponse({}, false, 404));
      })
    );

    render(
      <AuthProvider>
        <BrowserRouter>
          <TenantSettings />
        </BrowserRouter>
      </AuthProvider>
    );

    expect(await screen.findByText('Organization & Workspace Settings')).toBeInTheDocument();
    expect(await screen.findByText('Acme Global')).toBeInTheDocument();
    expect(await screen.findByText('acme-global')).toBeInTheDocument();
    expect(await screen.findByText('50000')).toBeInTheDocument();
    expect(await screen.findByText('Owner User')).toBeInTheDocument();
  });

  it('allows inviting a new team member', async () => {
    const fetchMock = vi.fn((url: string, opts?: RequestInit) => {
      if (url.includes('/api/v1/auth/me')) {
        return Promise.resolve(jsonResponse(mockMe));
      }
      if (url.includes('/api/v1/users/invite') && opts?.method === 'POST') {
        return Promise.resolve(
          jsonResponse({
            user: { id: 'usr_2', email: 'dev@acme.com', full_name: 'Dev Engineer' },
            assignedRole: 'agent_operator',
          }, true, 201)
        );
      }
      if (url.includes('/api/v1/tenants/tenant_abc')) {
        return Promise.resolve(jsonResponse(mockTenantDetails));
      }
      if (url.includes('/api/v1/users')) {
        return Promise.resolve(jsonResponse(mockUsers));
      }
      return Promise.resolve(jsonResponse({}, false, 404));
    });

    vi.stubGlobal('fetch', fetchMock);

    render(
      <AuthProvider>
        <BrowserRouter>
          <TenantSettings />
        </BrowserRouter>
      </AuthProvider>
    );

    const inviteBtns = await screen.findAllByRole('button', { name: /Invite/i });
    fireEvent.click(inviteBtns[0]);

    const nameInput = screen.getByLabelText(/Full Name \*/i);
    const emailInput = screen.getByLabelText(/Email Address \*/i);
    const passInput = screen.getByLabelText(/Temporary Password \*/i);

    fireEvent.change(nameInput, { target: { value: 'Dev Engineer' } });
    fireEvent.change(emailInput, { target: { value: 'dev@acme.com' } });
    fireEvent.change(passInput, { target: { value: 'tempPass1234' } });

    const submitBtn = screen.getByRole('button', { name: /Send Invitation/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/users/invite'),
        expect.objectContaining({ method: 'POST' })
      );
    });

    expect(await screen.findByText(/Invited 'dev@acme\.com' with role 'agent_operator'/i)).toBeInTheDocument();
  });
});
