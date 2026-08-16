import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router';
import { CustomerList } from './CustomerList';

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

describe('CustomerList Page', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('renders customer directory table when API call succeeds', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.includes('/api/v1/customers')) {
          return Promise.resolve(
            jsonResponse({
              customers: [
                {
                  id: 'cust_test_1',
                  full_name: 'Dr. Evelyn Reed',
                  primary_email: 'evelyn.reed@acme.org',
                  primary_phone: '+14155551234',
                  preferred_channel: 'whatsapp',
                  preferred_language: 'en',
                  lifecycle_stage: 'active',
                  sentiment_score: 0.8,
                  churn_risk_score: 0.1,
                  status: 'active',
                  created_at: new Date().toISOString(),
                },
              ],
              total: 1,
            })
          );
        }
        return Promise.resolve(jsonResponse({}, false, 404));
      })
    );

    render(
      <BrowserRouter>
        <CustomerList />
      </BrowserRouter>
    );

    expect(await screen.findByText('Customer 360 Directory')).toBeInTheDocument();
    expect(await screen.findByText('Dr. Evelyn Reed')).toBeInTheDocument();
    expect(await screen.findByText('evelyn.reed@acme.org')).toBeInTheDocument();
    expect(await screen.findByText('active')).toBeInTheDocument();
  });

  it('allows opening modal and submitting new customer', async () => {
    const fetchMock = vi.fn((url: string, opts?: RequestInit) => {
      if (url.includes('/api/v1/customers') && opts?.method === 'POST') {
        return Promise.resolve(
          jsonResponse({
            customer: {
              id: 'cust_new_1',
              full_name: 'Marcus Vance',
              primary_email: 'marcus@vance.io',
              primary_phone: '+14155559999',
              preferred_channel: 'whatsapp',
              lifecycle_stage: 'lead',
            },
          }, true, 201)
        );
      }
      if (url.includes('/api/v1/customers')) {
        return Promise.resolve(jsonResponse({ customers: [], total: 0 }));
      }
      return Promise.resolve(jsonResponse({}, false, 404));
    });

    vi.stubGlobal('fetch', fetchMock);

    render(
      <BrowserRouter>
        <CustomerList />
      </BrowserRouter>
    );

    const addBtns = await screen.findAllByRole('button', { name: /\+ Add Customer/i });
    fireEvent.click(addBtns[0]);

    expect(await screen.findByRole('heading', { name: /New Customer Profile/i })).toBeInTheDocument();

    const nameInput = screen.getByLabelText(/Full Name/i);
    fireEvent.change(nameInput, { target: { value: 'Marcus Vance' } });

    const emailInput = screen.getByLabelText(/Primary Email/i);
    fireEvent.change(emailInput, { target: { value: 'marcus@vance.io' } });

    const submitBtn = screen.getByRole('button', { name: /Create Customer/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/customers'),
        expect.objectContaining({ method: 'POST' })
      );
    });
  });
});
