import { useState, useCallback } from 'react';
import { apiFetch, ApiError } from '../../lib/apiClient';
import { useAsync } from '../../lib/useAsync';
import { DataTable, Column } from '../../components/DataTable';
import { AsyncState } from '../../components/AsyncState';
import styles from './KnowledgeCenter.module.css';

export interface KnowledgeDocument {
  id: string;
  organization_id: string;
  title: string;
  source_type: string;
  source_uri?: string;
  summary?: string;
  version: number;
  is_active: number;
  quality_status: string;
  stale_after_days: number;
  created_at: string;
  updated_at: string;
}

export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  headingContext: string;
  content: string;
  qualityStatus: string;
  score: number;
}

export interface KnowledgeQueryResponse {
  query: string;
  results: RetrievedChunk[];
  totalMatches: number;
  sanitizedContext: string;
}

export function KnowledgeCenter() {
  const [refreshTrigger, setRefreshTrigger] = useState<number>(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Ingest Document Modal
  const [isIngesting, setIsIngesting] = useState<boolean>(false);
  const [docTitle, setDocTitle] = useState<string>('');
  const [docSourceType, setDocSourceType] = useState<string>('markdown');
  const [docContent, setDocContent] = useState<string>('');
  const [docSummary, setDocSummary] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Query Tester State
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [searchResults, setSearchResults] = useState<KnowledgeQueryResponse | null>(null);

  const fetchDocuments = useCallback(() => {
    return apiFetch<{ documents: KnowledgeDocument[]; total: number }>('/api/v1/knowledge/documents');
  }, [refreshTrigger]);

  const docsState = useAsync(fetchDocuments, [fetchDocuments]);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    try {
      setIsSearching(true);
      setActionError(null);
      const res = await apiFetch<KnowledgeQueryResponse>('/api/v1/knowledge/query', {
        method: 'POST',
        body: JSON.stringify({
          query: searchQuery,
          topK: 5,
          qualityFilter: ['VERIFIED', 'UNVERIFIED'],
        }),
      });
      setSearchResults(res);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Search failed');
    } finally {
      setIsSearching(false);
    }
  };

  const handleIngest = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsSubmitting(true);
      setActionError(null);
      await apiFetch('/api/v1/knowledge/documents', {
        method: 'POST',
        body: JSON.stringify({
          title: docTitle,
          sourceType: docSourceType,
          content: docContent,
          summary: docSummary || undefined,
          staleAfterDays: 90,
        }),
      });
      setActionSuccess(`Document '${docTitle}' ingested and chunked successfully.`);
      setIsIngesting(false);
      setDocTitle('');
      setDocContent('');
      setDocSummary('');
      setRefreshTrigger((prev) => prev + 1);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Failed to ingest document');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleVerify = async (docId: string, status: 'VERIFIED' | 'STALE') => {
    try {
      setActionError(null);
      await apiFetch(`/api/v1/knowledge/documents/${docId}/verify`, {
        method: 'POST',
        body: JSON.stringify({ status }),
      });
      setActionSuccess(`Updated document quality status to ${status}.`);
      setRefreshTrigger((prev) => prev + 1);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Failed to verify document');
    }
  };

  const handleDelete = async (docId: string, title: string) => {
    if (!window.confirm(`Are you sure you want to delete '${title}' from the Knowledge Fabric?`)) return;
    try {
      setActionError(null);
      await apiFetch(`/api/v1/knowledge/documents/${docId}`, { method: 'DELETE' });
      setActionSuccess(`Deleted document '${title}'.`);
      setRefreshTrigger((prev) => prev + 1);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Failed to delete document');
    }
  };

  const documents = docsState.status === 'success' ? docsState.data.documents : [];
  const verifiedCount = documents.filter((d) => d.quality_status === 'VERIFIED').length;

  const columns: Column<KnowledgeDocument>[] = [
    {
      key: 'title',
      header: 'Document Title',
      render: (d) => (
        <div>
          <div style={{ fontWeight: 600, color: 'var(--color-ink)' }}>{d.title}</div>
          {d.summary && <div style={{ fontSize: '12px', color: 'var(--color-ink-muted)' }}>{d.summary}</div>}
          <div style={{ fontSize: '11px', color: 'var(--color-ink-muted)', fontFamily: 'var(--font-mono)' }}>
            v{d.version} · Stale after {d.stale_after_days}d
          </div>
        </div>
      ),
    },
    {
      key: 'source_type',
      header: 'Source Format',
      width: '130px',
      render: (d) => <span style={{ textTransform: 'capitalize', fontSize: '12px' }}>{d.source_type.replace('_', ' ')}</span>,
    },
    {
      key: 'quality_status',
      header: 'Quality Status',
      width: '140px',
      render: (d) => {
        const isVer = d.quality_status === 'VERIFIED';
        const isUnver = d.quality_status === 'UNVERIFIED';
        return (
          <span className={`${styles.badge} ${isVer ? styles.badgeVerified : isUnver ? styles.badgeUnverified : styles.badgeStale}`}>
            {d.quality_status}
          </span>
        );
      },
    },
    {
      key: 'actions',
      header: 'Actions',
      width: '200px',
      render: (d) => (
        <div style={{ display: 'flex', gap: 'var(--space-1)', flexWrap: 'wrap' }}>
          {d.quality_status !== 'VERIFIED' ? (
            <button className={styles.btnSecondary} onClick={() => handleVerify(d.id, 'VERIFIED')}>
              ✓ Verify
            </button>
          ) : (
            <button className={styles.btnSecondary} onClick={() => handleVerify(d.id, 'STALE')}>
              Mark Stale
            </button>
          )}
          <button className={styles.btnDanger} onClick={() => handleDelete(d.id, d.title)}>
            Delete
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.titleGroup}>
          <h1>Knowledge Fabric & RAG Intelligence</h1>
          <p className={styles.subtitle}>Document ingestion, hybrid vector/BM25 retrieval, and quality provenance verification.</p>
        </div>
        <div className={styles.headerActions}>
          <button className={styles.btnPrimary} onClick={() => setIsIngesting(true)}>
            + Ingest Document
          </button>
        </div>
      </header>

      {actionError && <div style={{ color: 'var(--color-critical)', background: 'rgba(216,87,75,0.1)', padding: 'var(--space-3)', borderRadius: 'var(--radius-sm)' }}>⚠️ {actionError}</div>}
      {actionSuccess && <div style={{ color: 'var(--color-verify)', background: 'rgba(63,166,107,0.1)', padding: 'var(--space-3)', borderRadius: 'var(--radius-sm)' }}>✓ {actionSuccess}</div>}

      {/* Top Metrics Strip */}
      <div className={styles.metricsGrid}>
        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>Total Ingested</span>
          <span className={styles.metricValue}>{documents.length}</span>
        </div>
        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>Verified Quality</span>
          <span className={styles.metricValue} style={{ color: 'var(--color-verify)' }}>{verifiedCount}</span>
        </div>
        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>Unverified / Stale</span>
          <span className={styles.metricValue} style={{ color: 'var(--color-caution)' }}>
            {documents.length - verifiedCount}
          </span>
        </div>
      </div>

      {/* Hybrid Search Test Console */}
      <div className={styles.searchCard}>
        <h2 style={{ fontSize: '16px', fontWeight: 600, margin: 0, color: 'var(--color-ink)' }}>Hybrid Vector & Keyword Query Sandbox</h2>
        <form onSubmit={handleSearch} className={styles.searchForm}>
          <input
            type="text"
            className={styles.searchInput}
            placeholder="Test live RAG retrieval (e.g. refund policy, enterprise SLA, pricing tiers)..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <button type="submit" className={styles.btnPrimary} disabled={isSearching}>
            {isSearching ? 'Searching...' : '🔍 Hybrid Query'}
          </button>
        </form>

        {searchResults && (
          <div className={styles.searchResults}>
            <div style={{ fontSize: '12px', color: 'var(--color-ink-muted)' }}>
              Found <strong>{searchResults.totalMatches}</strong> matched chunks for query <em>"{searchResults.query}"</em>:
            </div>
            {searchResults.results.map((chunk) => (
              <div key={chunk.chunkId} className={styles.resultChunk}>
                <div className={styles.resultHeader}>
                  <span className={styles.resultTitle}>{chunk.documentTitle} · <em>{chunk.headingContext || 'Section'}</em></span>
                  <span className={styles.resultScore}>Score: {(chunk.score * 100).toFixed(1)}%</span>
                </div>
                <div className={styles.resultContent}>{chunk.content}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Documents Data Table */}
      {docsState.status !== 'success' ? (
        <AsyncState status={docsState.status === 'loading' ? 'loading' : 'error'} error={docsState.error} />
      ) : (
        <DataTable
          columns={columns}
          data={documents}
          keyExtractor={(d) => d.id}
          emptyMessage="No documents in knowledge base yet. Ingest markdown or policy files to ground your workforce."
          ariaLabel="Knowledge fabric documents table"
        />
      )}

      {/* Ingest Document Modal */}
      {isIngesting && (
        <div className={styles.modalBackdrop} role="dialog" aria-modal="true" aria-labelledby="ingest-modal-title">
          <div className={styles.modal}>
            <h2 className={styles.modalTitle} id="ingest-modal-title">Ingest Knowledge Document</h2>
            <form onSubmit={handleIngest} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              <div className={styles.formField}>
                <label className={styles.formLabel} htmlFor="doc-title-input">Document Title *</label>
                <input
                  id="doc-title-input"
                  type="text"
                  required
                  className={styles.input}
                  placeholder="e.g. Enterprise SLA & Support Tier Policy"
                  value={docTitle}
                  onChange={(e) => setDocTitle(e.target.value)}
                />
              </div>

              <div className={styles.formField}>
                <label className={styles.formLabel} htmlFor="doc-type-select">Source Type</label>
                <select
                  id="doc-type-select"
                  className={styles.select}
                  value={docSourceType}
                  onChange={(e) => setDocSourceType(e.target.value)}
                >
                  <option value="markdown">Markdown (.md)</option>
                  <option value="policy_sop">Standard Operating Procedure (SOP)</option>
                  <option value="faq">FAQ Knowledge</option>
                  <option value="text">Plain Text</option>
                  <option value="structured_json">Structured JSON</option>
                </select>
              </div>

              <div className={styles.formField}>
                <label className={styles.formLabel} htmlFor="doc-summary-input">Brief Summary (Optional)</label>
                <input
                  id="doc-summary-input"
                  type="text"
                  className={styles.input}
                  placeholder="Short description of this document content"
                  value={docSummary}
                  onChange={(e) => setDocSummary(e.target.value)}
                />
              </div>

              <div className={styles.formField}>
                <label className={styles.formLabel} htmlFor="doc-content-textarea">Document Content *</label>
                <textarea
                  id="doc-content-textarea"
                  required
                  rows={8}
                  className={styles.textarea}
                  placeholder="Paste raw markdown, knowledge text, or procedures..."
                  value={docContent}
                  onChange={(e) => setDocContent(e.target.value)}
                />
              </div>

              <div className={styles.modalActions}>
                <button type="button" className={styles.btnSecondary} onClick={() => setIsIngesting(false)} disabled={isSubmitting}>
                  Cancel
                </button>
                <button type="submit" className={styles.btnPrimary} disabled={isSubmitting}>
                  {isSubmitting ? 'Ingesting & Chunking...' : 'Ingest Document'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
