import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router';
import { KnowledgeCenter } from './KnowledgeCenter';

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

const mockDocs = {
  total: 1,
  documents: [
    {
      id: 'doc_101',
      organization_id: 'default',
      title: 'Enterprise Refund & SLA Guideline',
      source_type: 'policy_sop',
      summary: 'Guidelines for 30-day refund grace period',
      version: 1,
      is_active: 1,
      quality_status: 'UNVERIFIED',
      stale_after_days: 90,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ],
};

const mockQueryResults = {
  query: 'refund period',
  results: [
    {
      chunkId: 'chunk_1',
      documentId: 'doc_101',
      documentTitle: 'Enterprise Refund & SLA Guideline',
      headingContext: 'Refund Window',
      content: 'Customers are eligible for 100% full refund within 30 calendar days.',
      qualityStatus: 'UNVERIFIED',
      score: 0.94,
    },
  ],
  totalMatches: 1,
  sanitizedContext: 'Eligible for 100% refund within 30 days.',
};

describe('KnowledgeCenter Page', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('renders documents table and allows hybrid RAG query search', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, opts?: RequestInit) => {
        if (url.includes('/api/v1/knowledge/query') && opts?.method === 'POST') {
          return Promise.resolve(jsonResponse(mockQueryResults));
        }
        if (url.includes('/api/v1/knowledge/documents')) {
          return Promise.resolve(jsonResponse(mockDocs));
        }
        return Promise.resolve(jsonResponse({}, false, 404));
      })
    );

    render(
      <BrowserRouter>
        <KnowledgeCenter />
      </BrowserRouter>
    );

    expect(await screen.findByText('Knowledge Fabric & RAG Intelligence')).toBeInTheDocument();
    expect(await screen.findByText('Enterprise Refund & SLA Guideline')).toBeInTheDocument();
    expect(await screen.findByText('UNVERIFIED')).toBeInTheDocument();

    const searchInput = screen.getByPlaceholderText(/Test live RAG retrieval/i);
    fireEvent.change(searchInput, { target: { value: 'refund period' } });

    const searchBtn = screen.getByRole('button', { name: /Hybrid Query/i });
    fireEvent.click(searchBtn);

    expect(await screen.findByText(/Customers are eligible for 100% full refund/i)).toBeInTheDocument();
    expect(await screen.findByText(/Score: 94\.0%/i)).toBeInTheDocument();
  });

  it('allows verifying a document quality status', async () => {
    const fetchMock = vi.fn((url: string, opts?: RequestInit) => {
      if (url.includes('/api/v1/knowledge/documents/doc_101/verify') && opts?.method === 'POST') {
        return Promise.resolve(jsonResponse({ status: 'VERIFIED' }));
      }
      if (url.includes('/api/v1/knowledge/documents')) {
        return Promise.resolve(jsonResponse(mockDocs));
      }
      return Promise.resolve(jsonResponse({}, false, 404));
    });

    vi.stubGlobal('fetch', fetchMock);

    render(
      <BrowserRouter>
        <KnowledgeCenter />
      </BrowserRouter>
    );

    const verifyBtns = await screen.findAllByRole('button', { name: /Verify/i });
    fireEvent.click(verifyBtns[0]);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/knowledge/documents/doc_101/verify'),
        expect.objectContaining({ method: 'POST' })
      );
    });

    expect(await screen.findByText(/Updated document quality status to VERIFIED/i)).toBeInTheDocument();
  });
});
