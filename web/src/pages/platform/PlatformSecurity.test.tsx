import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router';
import { PlatformSecurity } from './PlatformSecurity';

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

const mockScan = {
  status: 'COMPLIANT',
  totalChecks: 12,
  passedChecks: 12,
  findings: [
    {
      severity: 'LOW',
      category: 'secret_leakage',
      description: 'Periodic secret rotation recommended for JWT keys',
      remediation: 'Rotate JWT signing keys at least once per 90 days',
    },
  ],
  scanTimestamp: new Date().toISOString(),
};

const mockLedger = {
  isValid: true,
  totalEventsChecked: 45,
  tamperedEventsCount: 0,
  lastValidSequence: 45,
  details: ['Genesis block verified', 'Chain continuous'],
};

const mockSecrets = {
  count: 1,
  secrets: [
    {
      id: 'sec_1',
      secret_name: 'JWT_SIGNING_KEY',
      secret_version: 1,
      status: 'active',
      rotated_at: new Date().toISOString(),
    },
  ],
};

describe('PlatformSecurity Page', () => {
  beforeEach(() => {
    sessionStorage.clear();
    sessionStorage.setItem('xylarc_access_token', 'test_platform_token');
    vi.restoreAllMocks();
  });

  it('renders zero-trust compliance scan, ledger integrity, and secrets registry', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.includes('/api/v1/security/scan')) {
          return Promise.resolve(jsonResponse(mockScan));
        }
        if (url.includes('/api/v1/security/audit/verify')) {
          return Promise.resolve(jsonResponse(mockLedger));
        }
        if (url.includes('/api/v1/security/secrets')) {
          return Promise.resolve(jsonResponse(mockSecrets));
        }
        return Promise.resolve(jsonResponse({}, false, 404));
      })
    );

    render(
      <BrowserRouter>
        <PlatformSecurity />
      </BrowserRouter>
    );

    expect(await screen.findByText('Security Center & Zero-Trust Verification')).toBeInTheDocument();
    expect(await screen.findByText('VERIFIED (IMMUTABLE)')).toBeInTheDocument();
    expect(await screen.findByText('COMPLIANT')).toBeInTheDocument();
    expect(await screen.findByText('JWT_SIGNING_KEY')).toBeInTheDocument();
    expect(await screen.findByText('Periodic secret rotation recommended for JWT keys')).toBeInTheDocument();
  });

  it('allows rotating a security key', async () => {
    const fetchMock = vi.fn((url: string, opts?: RequestInit) => {
      if (url.includes('/api/v1/security/secrets/rotate') && opts?.method === 'POST') {
        return Promise.resolve(
          jsonResponse(
            {
              secretName: 'JWT_SIGNING_KEY',
              newVersion: 2,
              status: 'active',
              rotatedAt: new Date().toISOString(),
            },
            true,
            201
          )
        );
      }
      if (url.includes('/api/v1/security/scan')) {
        return Promise.resolve(jsonResponse(mockScan));
      }
      if (url.includes('/api/v1/security/audit/verify')) {
        return Promise.resolve(jsonResponse(mockLedger));
      }
      if (url.includes('/api/v1/security/secrets')) {
        return Promise.resolve(jsonResponse(mockSecrets));
      }
      return Promise.resolve(jsonResponse({}, false, 404));
    });

    vi.stubGlobal('fetch', fetchMock);

    render(
      <BrowserRouter>
        <PlatformSecurity />
      </BrowserRouter>
    );

    const openRotateBtns = await screen.findAllByRole('button', { name: /Rotate Secret Key/i });
    fireEvent.click(openRotateBtns[0]);

    const submitBtns = screen.getAllByRole('button', { name: /Rotate & Re-encrypt/i });
    fireEvent.click(submitBtns[0]);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/security/secrets/rotate'),
        expect.objectContaining({ method: 'POST' })
      );
    });

    expect(await screen.findByText(/Secret 'JWT_SIGNING_KEY' rotated successfully/i)).toBeInTheDocument();
  });
});
