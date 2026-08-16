import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PlatformOverview } from './PlatformOverview';

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

describe('PlatformOverview', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('renders real cross-tenant data once endpoints resolve', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.includes('/admin/tenants')) {
          return Promise.resolve(
            jsonResponse({ tenants: [{ id: 't1', name: 'Acme Corp', slug: 'acme', status: 'active', plan_tier: 'pro' }], count: 1 })
          );
        }
        if (url.includes('/admin/fleet/diagnostics')) {
          return Promise.resolve(
            jsonResponse({ totalNodes: 4, onlineNodes: 4, degradedNodes: 0, offlineNodes: 0, clusterHealth: 'healthy' })
          );
        }
        if (url.includes('/admin/maintenance')) {
          return Promise.resolve(jsonResponse({ isMaintenanceActive: false, readOnlyMode: false }));
        }
        return Promise.resolve(jsonResponse({}, false, 404));
      })
    );

    render(<PlatformOverview />);

    expect(await screen.findByText('Acme Corp')).toBeInTheDocument();
    expect(await screen.findByText(/4\/4 nodes online/)).toBeInTheDocument();
  });

  it('renders an in-page Access Denied state for a 403 on the tenants endpoint', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.includes('/admin/tenants')) {
          return Promise.resolve(
            jsonResponse({ error: { code: 'FORBIDDEN', message: 'Insufficient permissions', statusCode: 403 } }, false, 403)
          );
        }
        if (url.includes('/admin/fleet/diagnostics')) {
          return Promise.resolve(
            jsonResponse({ totalNodes: 1, onlineNodes: 1, degradedNodes: 0, offlineNodes: 0, clusterHealth: 'healthy' })
          );
        }
        return Promise.resolve(jsonResponse({ isMaintenanceActive: false }));
      })
    );

    render(<PlatformOverview />);

    expect(await screen.findByText(/Access denied/i)).toBeInTheDocument();
  });
});
