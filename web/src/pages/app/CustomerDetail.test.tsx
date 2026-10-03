import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router';
import { CustomerDetail } from './CustomerDetail';

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

const mockCustomer360 = {
  profile: {
    id: 'cust_abc_123',
    full_name: 'Sarah Connor',
    primary_email: 'sarah@resistance.org',
    primary_phone: '+14155550000',
    external_crm_id: 'CRM-9921',
    preferred_language: 'en',
    preferred_channel: 'whatsapp',
    lifecycle_stage: 'active',
    sentiment_score: 0.9,
    churn_risk_score: 0.05,
    status: 'active',
    created_at: new Date().toISOString(),
  },
  identities: [
    {
      id: 'ident_1',
      identity_type: 'whatsapp_id',
      identity_val: '+14155550000',
      is_primary: true,
      verified: true,
      created_at: new Date().toISOString(),
    },
  ],
  timeline: [
    {
      id: 'time_1',
      channel: 'whatsapp',
      event_type: 'inbound_message',
      summary: 'Customer requested plan upgrade details',
      sentiment_score: 0.8,
      actor_type: 'customer',
      occurred_at: new Date().toISOString(),
    },
  ],
  consents: [
    {
      id: 'con_1',
      consent_type: 'whatsapp_marketing',
      status: 'granted',
      source: 'web_portal',
      granted_at: new Date().toISOString(),
    },
  ],
  signals: {
    sentiment: 0.9,
    churnRisk: 0.05,
    lifecycleStage: 'active',
    totalInteractions: 14,
    preferredChannel: 'whatsapp',
    preferredLanguage: 'en',
  },
};

describe('CustomerDetail Page', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('renders customer 360 profile, signals, timeline, and identities', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.includes('/api/v1/customers/cust_abc_123')) {
          return Promise.resolve(jsonResponse(mockCustomer360));
        }
        return Promise.resolve(jsonResponse({}, false, 404));
      })
    );

    render(
      <MemoryRouter initialEntries={['/admin/customers/cust_abc_123']}>
        <Routes>
          <Route path="/admin/customers/:id" element={<CustomerDetail />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText('Sarah Connor')).toBeInTheDocument();
    expect(await screen.findByText('CRM-9921')).toBeInTheDocument();
    expect(await screen.findByText('14')).toBeInTheDocument(); // total interactions
    expect(await screen.findByText('Customer requested plan upgrade details')).toBeInTheDocument();
  });

  it('allows toggling consent via API', async () => {
    const fetchMock = vi.fn((url: string, opts?: RequestInit) => {
      if (url.includes('/api/v1/customers/cust_abc_123/consent') && opts?.method === 'POST') {
        return Promise.resolve(jsonResponse({ consent: { id: 'con_1', status: 'revoked' } }));
      }
      if (url.includes('/api/v1/customers/cust_abc_123')) {
        return Promise.resolve(jsonResponse(mockCustomer360));
      }
      return Promise.resolve(jsonResponse({}, false, 404));
    });

    vi.stubGlobal('fetch', fetchMock);

    render(
      <MemoryRouter initialEntries={['/admin/customers/cust_abc_123']}>
        <Routes>
          <Route path="/admin/customers/:id" element={<CustomerDetail />} />
        </Routes>
      </MemoryRouter>
    );

    const consentTab = await screen.findByRole('button', { name: /Consent & Privacy/i });
    fireEvent.click(consentTab);

    expect(await screen.findByText('WHATSAPP MARKETING')).toBeInTheDocument();
    const toggleBtn = screen.getByRole('button', { name: /Toggle/i });
    fireEvent.click(toggleBtn);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/customers/cust_abc_123/consent'),
        expect.objectContaining({ method: 'POST' })
      );
    });
  });
});
