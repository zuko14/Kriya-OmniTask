import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router';
import { BusinessIntelligence } from './BusinessIntelligence';

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

const mockBriefings = {
  count: 1,
  briefings: [
    {
      id: 'briefing_2026_08_15',
      tenant_id: 'default',
      briefing_date: '2026-08-15',
      title: 'Executive Daily Synthesis — Aug 15, 2026',
      summary_markdown: '### Operational Highlights\n\nAll agent pipelines healthy.',
      status: 'generated',
      created_at: new Date().toISOString(),
    },
  ],
};

describe('BusinessIntelligence Page', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('renders executive briefings list and markdown viewer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.includes('/api/v1/bi/briefings')) {
          return Promise.resolve(jsonResponse(mockBriefings));
        }
        return Promise.resolve(jsonResponse({}, false, 404));
      })
    );

    render(
      <BrowserRouter>
        <BusinessIntelligence />
      </BrowserRouter>
    );

    expect(await screen.findByText('Business Intelligence & Executive Briefings')).toBeInTheDocument();
    const matches = await screen.findAllByText(/Executive Daily Synthesis/i);
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(await screen.findByText(/All agent pipelines healthy/i)).toBeInTheDocument();
  });

  it('allows on-demand briefing generation', async () => {
    const fetchMock = vi.fn((url: string, opts?: RequestInit) => {
      if (url.includes('/api/v1/bi/briefings/generate') && opts?.method === 'POST') {
        return Promise.resolve(
          jsonResponse({
            id: 'briefing_new',
            title: 'Executive Synthesis — On Demand',
            summary_markdown: 'Generated fresh metrics.',
            status: 'generated',
          }, true, 201)
        );
      }
      if (url.includes('/api/v1/bi/briefings')) {
        return Promise.resolve(jsonResponse(mockBriefings));
      }
      return Promise.resolve(jsonResponse({}, false, 404));
    });

    vi.stubGlobal('fetch', fetchMock);

    render(
      <BrowserRouter>
        <BusinessIntelligence />
      </BrowserRouter>
    );

    const generateBtns = await screen.findAllByRole('button', { name: /Generate/i });
    fireEvent.click(generateBtns[0]);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/bi/briefings/generate'),
        expect.objectContaining({ method: 'POST' })
      );
    });

    expect(await screen.findByText(/Generated briefing 'Executive Synthesis — On Demand' successfully/i)).toBeInTheDocument();
  });
});
