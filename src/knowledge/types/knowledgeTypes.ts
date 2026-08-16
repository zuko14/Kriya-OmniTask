/**
 * Xylarc AI — Knowledge Fabric Type Definitions & Zod Schemas
 * Typed contracts for Document Ingestion, Hybrid Vector/BM25 Retrieval, Quality Verification & Provenance Lineage (§10, §11, §12 of CLAUDE.md).
 */

import { z } from 'zod';
import { BaseEntity } from '../../storage/repositories/baseRepository.js';

export const KnowledgeSourceTypeEnum = z.enum([
  'pdf',
  'docx',
  'markdown',
  'text',
  'web_crawl',
  'structured_json',
  'faq',
  'policy_sop',
]);

export type KnowledgeSourceType = z.infer<typeof KnowledgeSourceTypeEnum>;

export const KnowledgeQualityStatusEnum = z.enum([
  'VERIFIED',
  'UNVERIFIED',
  'STALE',
  'CONFLICTING',
  'UNKNOWN',
]);

export type KnowledgeQualityStatus = z.infer<typeof KnowledgeQualityStatusEnum>;

export const ProvenanceMetadataSchema = z.object({
  author: z.string().optional(),
  uploadedBy: z.string().optional(),
  sourceSystem: z.string().default('manual_upload'),
  contentHash: z.string().optional(),
  verifiedAt: z.string().optional(),
  verifiedBy: z.string().optional(),
  tags: z.array(z.string()).default([]),
});

export type ProvenanceMetadata = z.infer<typeof ProvenanceMetadataSchema>;

export const AccessScopeSchema = z.object({
  allowedRoles: z.array(z.string()).default(['admin', 'support_agent']),
  allowedAgents: z.array(z.string()).default(['*']), // '*' allows all tenant agents
  isPublicToTenant: z.boolean().default(true),
});

export type AccessScope = z.infer<typeof AccessScopeSchema>;

// ============================================================================
// Document Ingestion Schemas (§10)
// ============================================================================

export const IngestDocumentRequestSchema = z.object({
  title: z.string().min(1).max(255),
  sourceType: KnowledgeSourceTypeEnum.default('markdown'),
  sourceUri: z.string().optional(),
  mimeType: z.string().default('text/plain'),
  content: z.string().min(1),
  summary: z.string().optional(),
  staleAfterDays: z.number().int().positive().default(90),
  provenance: ProvenanceMetadataSchema.optional(),
  accessScope: AccessScopeSchema.optional(),
  metadata: z.record(z.unknown()).default({}),
});

export type IngestDocumentRequest = z.input<typeof IngestDocumentRequestSchema>;

export interface KnowledgeDocumentRecord extends BaseEntity {
  organization_id: string;
  title: string;
  source_type: KnowledgeSourceType;
  source_uri?: string;
  mime_type: string;
  content_raw: string;
  content_normalized: string;
  summary?: string;
  version: number;
  is_active: number; // 1 or 0
  quality_status: KnowledgeQualityStatus;
  stale_after_days: number;
  provenance_json: string;
  access_scope_json: string;
  metadata_json: string;
}

export interface KnowledgeChunkRecord extends BaseEntity {
  document_id: string;
  chunk_index: number;
  heading_context: string;
  content: string;
  token_count: number;
  embedding_json?: string; // JSON array of numbers
  quality_status: KnowledgeQualityStatus;
  metadata_json: string;
}

export interface KnowledgeLineageEventRecord extends BaseEntity {
  document_id: string;
  event_type: 'ingested' | 'chunked' | 'embedded' | 'updated' | 'verified' | 'invalidated' | 'retrieved';
  actor_type: 'user' | 'agent' | 'system';
  actor_id: string;
  agent_id?: string;
  query_text?: string;
  details_json: string;
}

// ============================================================================
// Retrieval & Hybrid Query Schemas (§11)
// ============================================================================

export const KnowledgeQueryRequestSchema = z.object({
  query: z.string().min(1),
  topK: z.number().int().min(1).max(20).default(5),
  sourceTypes: z.array(KnowledgeSourceTypeEnum).optional(),
  qualityFilter: z.array(KnowledgeQualityStatusEnum).default(['VERIFIED', 'UNVERIFIED']),
  agentId: z.string().optional(), // For agent-scoped retrieval gating
  userRole: z.string().optional(), // For RBAC filtering
  minScore: z.number().min(0).max(1).default(0.2),
});

export type KnowledgeQueryRequest = z.input<typeof KnowledgeQueryRequestSchema>;

export interface RetrievedChunkResult {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  sourceType: KnowledgeSourceType;
  sourceUri?: string;
  headingContext: string;
  content: string;
  qualityStatus: KnowledgeQualityStatus;
  score: number; // Combined hybrid score (0.0 to 1.0)
  vectorScore: number;
  bm25Score: number;
  provenance: ProvenanceMetadata;
  isStale: boolean;
}

export interface KnowledgeRetrievalResponse {
  query: string;
  results: RetrievedChunkResult[];
  totalMatches: number;
  qualitySummary: {
    verifiedCount: number;
    unverifiedCount: number;
    staleCount: number;
    conflictingCount: number;
  };
  hasConflicts: boolean;
  sanitizedContext: string; // Safety-filtered context ready for agent prompt injection
}
