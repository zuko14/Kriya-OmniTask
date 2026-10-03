/**
 * Kriya AI — Hybrid RAG Retriever Unit Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { HybridRetriever, ChunkWithDocument } from '../../src/knowledge/retrieval/hybridRetriever.js';
import { EmbeddingService } from '../../src/knowledge/embeddings/embeddingService.js';
import { BM25SearchEngine } from '../../src/knowledge/embeddings/bm25SearchEngine.js';

describe('Hybrid RAG Retriever Unit Tests', () => {
  let embeddingService: EmbeddingService;
  let bm25Engine: BM25SearchEngine;
  let retriever: HybridRetriever;
  let mockCorpus: ChunkWithDocument[];

  beforeEach(async () => {
    embeddingService = new EmbeddingService();
    bm25Engine = new BM25SearchEngine();
    retriever = new HybridRetriever(embeddingService, bm25Engine);

    const vec1 = await embeddingService.generateEmbedding('WhatsApp Cloud API integration instructions and webhook verification');
    const vec2 = await embeddingService.generateEmbedding('Billing and credit card payment processing policies');

    mockCorpus = [
      {
        chunk: {
          id: 'chunk_1',
          tenant_id: 'tenant_test',
          document_id: 'doc_1',
          chunk_index: 0,
          heading_context: 'WhatsApp Setup',
          content: 'Configure Meta App ID and verify webhook signature using SHA256 HMAC.',
          token_count: 20,
          embedding_json: JSON.stringify(vec1),
          quality_status: 'VERIFIED',
          metadata_json: '{}',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        document: {
          id: 'doc_1',
          tenant_id: 'tenant_test',
          organization_id: 'default',
          title: 'WhatsApp Integration Guide',
          source_type: 'markdown',
          mime_type: 'text/markdown',
          content_raw: '...',
          content_normalized: '...',
          version: 1,
          is_active: 1,
          quality_status: 'VERIFIED',
          stale_after_days: 90,
          provenance_json: JSON.stringify({ author: 'Alice', uploadedBy: 'admin', sourceSystem: 'docs' }),
          access_scope_json: JSON.stringify({ allowedRoles: ['*'], allowedAgents: ['*'], isPublicToTenant: true }),
          metadata_json: '{}',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      },
      {
        chunk: {
          id: 'chunk_2',
          tenant_id: 'tenant_test',
          document_id: 'doc_2',
          chunk_index: 0,
          heading_context: 'Billing',
          content: 'Invoices are generated on the first calendar day of every month.',
          token_count: 15,
          embedding_json: JSON.stringify(vec2),
          quality_status: 'VERIFIED',
          metadata_json: '{}',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        document: {
          id: 'doc_2',
          tenant_id: 'tenant_test',
          organization_id: 'default',
          title: 'Billing Policies',
          source_type: 'policy_sop',
          mime_type: 'text/plain',
          content_raw: '...',
          content_normalized: '...',
          version: 1,
          is_active: 1,
          quality_status: 'VERIFIED',
          stale_after_days: 90,
          provenance_json: JSON.stringify({ author: 'Finance', uploadedBy: 'admin', sourceSystem: 'erp' }),
          access_scope_json: JSON.stringify({ allowedRoles: ['finance_admin', 'admin'], allowedAgents: ['billing_agent'], isPublicToTenant: false }),
          metadata_json: '{}',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      },
    ];
  });

  it('should retrieve relevant chunks ranking WhatsApp guide first for whatsapp query', async () => {
    const res = await retriever.retrieve(
      {
        query: 'How to verify WhatsApp webhook HMAC signature?',
        topK: 5,
        minScore: 0.1,
      },
      mockCorpus
    );

    expect(res.results.length).toBeGreaterThan(0);
    expect(res.results[0].documentTitle).toBe('WhatsApp Integration Guide');
    expect(res.results[0].score).toBeGreaterThan(0.3);
    expect(res.qualitySummary.verifiedCount).toBeGreaterThan(0);
  });

  it('should enforce role and agent access scope filtering', async () => {
    // Standard support agent query for billing
    const resForbidden = await retriever.retrieve(
      {
        query: 'Invoice billing policies and monthly schedule',
        userRole: 'support_agent',
        agentId: 'support_agent',
        topK: 5,
        minScore: 0.05,
      },
      mockCorpus
    );

    // doc_2 requires finance_admin/admin or billing_agent
    expect(resForbidden.results.some((r) => r.documentId === 'doc_2')).toBe(false);

    // Authorized billing agent query
    const resAllowed = await retriever.retrieve(
      {
        query: 'Invoice billing policies and monthly schedule',
        userRole: 'admin',
        agentId: 'billing_agent',
        topK: 5,
        minScore: 0.05,
      },
      mockCorpus
    );

    expect(resAllowed.results.some((r) => r.documentId === 'doc_2')).toBe(true);
  });
});
