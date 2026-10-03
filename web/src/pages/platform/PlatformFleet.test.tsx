import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router';
import { PlatformFleet } from './PlatformFleet';

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

const mockDiagnostics = {
  totalNodes: 4,
  onlineNodes: 3,
  degradedNodes: 1,
  offlineNodes: 0,
  avgCpuUsagePct: 32.5,
  avgMemoryUsagePct: 48.0,
  clusterHealth: 'healthy',
  nodes: [
    {
      nodeId: 'node-us-east-01',
      clusterRegion: 'us-east-1',
      status: 'healthy',
      cpuUsagePct: 28.4,
      memoryUsagePct: 42.1,
      lastHeartbeat: new Date().toISOString(),
    },
    {
      nodeId: 'node-eu-west-02',
      clusterRegion: 'eu-central-1',
      status: 'degraded',
      cpuUsagePct: 78.9,
      memoryUsagePct: 82.0,
      lastHeartbeat: new Date().toISOString(),
    },
  ],
};

describe('PlatformFleet Page', () => {
  beforeEach(() => {
    sessionStorage.clear();
    sessionStorage.setItem('kriya_access_token', 'test_platform_token');
    vi.restoreAllMocks();
  });

  it('renders fleet health KPIs and compute nodes table', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.includes('/api/v1/admin/fleet/diagnostics')) {
          return Promise.resolve(jsonResponse(mockDiagnostics));
        }
        return Promise.resolve(jsonResponse({}, false, 404));
      })
    );

    render(
      <BrowserRouter>
        <PlatformFleet />
      </BrowserRouter>
    );

    expect(await screen.findByText('Autonomous Compute Fleet & Node Health')).toBeInTheDocument();
    expect(await screen.findByText('HEALTHY')).toBeInTheDocument();
    expect(await screen.findByText('node-us-east-01')).toBeInTheDocument();
    expect(await screen.findByText('node-eu-west-02')).toBeInTheDocument();
    expect(await screen.findByText('28.4%')).toBeInTheDocument();
  });

  it('allows recording a new node heartbeat', async () => {
    const fetchMock = vi.fn((url: string, opts?: RequestInit) => {
      if (url.includes('/api/v1/admin/fleet/heartbeat') && opts?.method === 'POST') {
        return Promise.resolve(
          jsonResponse(
            {
              nodeId: 'node-ap-south-01',
              clusterRegion: 'ap-southeast-1',
              status: 'healthy',
              cpuUsagePct: 15,
              memoryUsagePct: 30,
              lastHeartbeat: new Date().toISOString(),
            },
            true,
            200
          )
        );
      }
      if (url.includes('/api/v1/admin/fleet/diagnostics')) {
        return Promise.resolve(jsonResponse(mockDiagnostics));
      }
      return Promise.resolve(jsonResponse({}, false, 404));
    });

    vi.stubGlobal('fetch', fetchMock);

    render(
      <BrowserRouter>
        <PlatformFleet />
      </BrowserRouter>
    );

    const openHeartbeatBtns = await screen.findAllByRole('button', { name: /Dispatch Node Heartbeat/i });
    fireEvent.click(openHeartbeatBtns[0]);

    const nodeIdInput = screen.getByLabelText(/Node Identifier \*/i);
    fireEvent.change(nodeIdInput, { target: { value: 'node-ap-south-01' } });

    const submitBtns = screen.getAllByRole('button', { name: /Send Heartbeat/i });
    fireEvent.click(submitBtns[0]);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/admin/fleet/heartbeat'),
        expect.objectContaining({ method: 'POST' })
      );
    });

    expect(await screen.findByText(/Heartbeat recorded for node 'node-ap-south-01'/i)).toBeInTheDocument();
  });
});
