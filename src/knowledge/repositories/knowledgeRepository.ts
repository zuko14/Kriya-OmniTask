/**
 * Kriya AI — Knowledge Documents & Chunks Repository
 * Manages relational and vector storage of documents and windowed chunks with strict tenant scoping (§10 of CLAUDE.md).
 */

import { BaseRepository } from '../../storage/repositories/baseRepository.js';
import { DatabaseClient, isPostgres } from '../../storage/db.js';
import {
  KnowledgeDocumentRecord,
  KnowledgeChunkRecord,
  KnowledgeSourceType,
  KnowledgeQualityStatus,
} from '../types/knowledgeTypes.js';
import { CryptoUtils } from '../../core/utils/crypto.js';
import { EmbeddingService } from '../embeddings/embeddingService.js';

export class KnowledgeRepository extends BaseRepository<KnowledgeDocumentRecord> {
  protected readonly tableName = 'knowledge_documents';

  constructor(client?: DatabaseClient) {
    super(client);
  }

  /**
   * Ingests a new document and its chunks transactionally.
   * Supports pgvector vector column persistence when running on PostgreSQL.
   */
  public async createDocumentWithChunks(params: {
    title: string;
    sourceType: KnowledgeSourceType;
    sourceUri?: string;
    mimeType?: string;
    contentRaw: string;
    contentNormalized: string;
    summary?: string;
    qualityStatus?: KnowledgeQualityStatus;
    staleAfterDays?: number;
    provenanceJson: string;
    accessScopeJson: string;
    metadataJson?: string;
    chunks: Array<{
      chunkIndex: number;
      headingContext: string;
      content: string;
      tokenCount: number;
      embeddingJson?: string;
      embeddingVector?: number[];
      embeddingModel?: string;
      embeddingDimensions?: number;
      metadataJson?: string;
    }>;
  }): Promise<{ document: KnowledgeDocumentRecord; chunks: KnowledgeChunkRecord[] }> {
    const tenantId = this.getTenantId();
    const docId = CryptoUtils.generateId();
    const now = new Date().toISOString();

    const docRecord: KnowledgeDocumentRecord = {
      id: docId,
      tenant_id: tenantId,
      organization_id: 'default',
      title: params.title,
      source_type: params.sourceType,
      source_uri: params.sourceUri,
      mime_type: params.mimeType || 'text/plain',
      content_raw: params.contentRaw,
      content_normalized: params.contentNormalized,
      summary: params.summary,
      version: 1,
      is_active: 1,
      quality_status: params.qualityStatus || 'UNVERIFIED',
      stale_after_days: params.staleAfterDays || 90,
      provenance_json: params.provenanceJson,
      access_scope_json: params.accessScopeJson,
      metadata_json: params.metadataJson || '{}',
      created_at: now,
      updated_at: now,
    };

    const chunkRecords: KnowledgeChunkRecord[] = params.chunks.map((c) => ({
      id: CryptoUtils.generateId(),
      tenant_id: tenantId,
      document_id: docId,
      chunk_index: c.chunkIndex,
      heading_context: c.headingContext,
      content: c.content,
      token_count: c.tokenCount,
      embedding_json: c.embeddingJson || (c.embeddingVector ? JSON.stringify(c.embeddingVector) : undefined),
      embedding_model: c.embeddingModel || 'openai/text-embedding-3-small',
      embedding_dimensions: c.embeddingDimensions || c.embeddingVector?.length || 1536,
      quality_status: docRecord.quality_status,
      metadata_json: c.metadataJson || '{}',
      created_at: now,
      updated_at: now,
    }));

    const isPg = isPostgres(this.client);

    await this.client.transaction(async (tx) => {
      // 1. Insert document
      await tx.execute(
        `INSERT INTO knowledge_documents (
          id, tenant_id, organization_id, title, source_type, source_uri, mime_type,
          content_raw, content_normalized, summary, version, is_active, quality_status,
          stale_after_days, provenance_json, access_scope_json, metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        [
          docRecord.id,
          docRecord.tenant_id,
          docRecord.organization_id,
          docRecord.title,
          docRecord.source_type,
          docRecord.source_uri || null,
          docRecord.mime_type,
          docRecord.content_raw,
          docRecord.content_normalized,
          docRecord.summary || null,
          docRecord.version,
          docRecord.is_active,
          docRecord.quality_status,
          docRecord.stale_after_days,
          docRecord.provenance_json,
          docRecord.access_scope_json,
          docRecord.metadata_json,
          docRecord.created_at,
          docRecord.updated_at,
        ]
      );

      // 2. Insert chunks
      for (let i = 0; i < chunkRecords.length; i++) {
        const chunk = chunkRecords[i];
        const rawChunk = params.chunks[i];
        const vectorArray = rawChunk.embeddingVector || (chunk.embedding_json ? JSON.parse(chunk.embedding_json) : null);

        if (isPg && vectorArray && Array.isArray(vectorArray)) {
          const vectorLiteral = `[${vectorArray.join(',')}]`;
          await tx.execute(
            `INSERT INTO knowledge_chunks (
              id, tenant_id, document_id, chunk_index, heading_context, content,
              token_count, embedding_json, embedding_vector, embedding_model, embedding_dimensions,
              quality_status, metadata_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?::vector, ?, ?, ?, ?, ?);`,
            [
              chunk.id,
              chunk.tenant_id,
              chunk.document_id,
              chunk.chunk_index,
              chunk.heading_context,
              chunk.content,
              chunk.token_count,
              chunk.embedding_json || null,
              vectorLiteral,
              chunk.embedding_model || 'openai/text-embedding-3-small',
              chunk.embedding_dimensions || 1536,
              chunk.quality_status,
              chunk.metadata_json,
              chunk.created_at,
            ]
          );
        } else {
          await tx.execute(
            `INSERT INTO knowledge_chunks (
              id, tenant_id, document_id, chunk_index, heading_context, content,
              token_count, embedding_json, embedding_model, embedding_dimensions,
              quality_status, metadata_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
            [
              chunk.id,
              chunk.tenant_id,
              chunk.document_id,
              chunk.chunk_index,
              chunk.heading_context,
              chunk.content,
              chunk.token_count,
              chunk.embedding_json || null,
              chunk.embedding_model || 'openai/text-embedding-3-small',
              chunk.embedding_dimensions || 1536,
              chunk.quality_status,
              chunk.metadata_json,
              chunk.created_at,
            ]
          );
        }
      }
    });

    return { document: docRecord, chunks: chunkRecords };
  }

  /**
   * Retrieves all active chunks with their parent documents for the tenant.
   */
  public async getTenantChunksWithDocuments(): Promise<
    Array<{ chunk: KnowledgeChunkRecord; document: KnowledgeDocumentRecord }>
  > {
    const tenantId = this.getTenantId();
    const rows = await this.client.query<any>(
      `SELECT
        c.id as chunk_id, c.tenant_id, c.document_id, c.chunk_index, c.heading_context,
        c.content as chunk_content, c.token_count, c.embedding_json, c.quality_status as chunk_quality_status,
        c.metadata_json as chunk_metadata_json, c.created_at as chunk_created_at,
        d.id as doc_id, d.title, d.source_type, d.source_uri, d.mime_type, d.content_raw,
        d.content_normalized, d.summary, d.version, d.is_active, d.quality_status as doc_quality_status,
        d.stale_after_days, d.provenance_json, d.access_scope_json, d.metadata_json as doc_metadata_json,
        d.created_at as doc_created_at, d.updated_at as doc_updated_at
       FROM knowledge_chunks c
       JOIN knowledge_documents d ON c.document_id = d.id AND c.tenant_id = d.tenant_id
       WHERE c.tenant_id = ? AND d.is_active = 1;`,
      [tenantId]
    );

    return rows.map((r) => ({
      chunk: {
        id: r.chunk_id,
        tenant_id: r.tenant_id,
        document_id: r.document_id,
        chunk_index: r.chunk_index,
        heading_context: r.heading_context,
        content: r.chunk_content,
        token_count: r.token_count,
        embedding_json: r.embedding_json,
        quality_status: r.chunk_quality_status,
        metadata_json: r.chunk_metadata_json,
        created_at: r.chunk_created_at,
        updated_at: r.chunk_created_at,
      },
      document: {
        id: r.doc_id,
        tenant_id: r.tenant_id,
        organization_id: 'default',
        title: r.title,
        source_type: r.source_type,
        source_uri: r.source_uri,
        mime_type: r.mime_type,
        content_raw: r.content_raw,
        content_normalized: r.content_normalized,
        summary: r.summary,
        version: r.version,
        is_active: r.is_active,
        quality_status: r.doc_quality_status,
        stale_after_days: r.stale_after_days,
        provenance_json: r.provenance_json,
        access_scope_json: r.access_scope_json,
        metadata_json: r.doc_metadata_json,
        created_at: r.doc_created_at,
        updated_at: r.doc_updated_at,
      },
    }));
  }

  /**
   * Retrieves chunks for a single document.
   */
  public async getChunksForDocument(documentId: string): Promise<KnowledgeChunkRecord[]> {
    const tenantId = this.getTenantId();
    return this.client.query<KnowledgeChunkRecord>(
      'SELECT * FROM knowledge_chunks WHERE tenant_id = ? AND document_id = ? ORDER BY chunk_index ASC;',
      [tenantId, documentId]
    );
  }

  /**
   * Updates document and chunk quality status.
   */
  public async updateQualityStatus(
    documentId: string,
    status: KnowledgeQualityStatus,
    verifiedBy?: string
  ): Promise<KnowledgeDocumentRecord | null> {
    const tenantId = this.getTenantId();
    const doc = await this.findById(documentId);
    if (!doc) return null;

    let provenance = { tags: [] as string[] };
    try {
      provenance = JSON.parse(doc.provenance_json);
    } catch {}

    const updatedProvenance = {
      ...provenance,
      verifiedAt: new Date().toISOString(),
      verifiedBy: verifiedBy || 'system_admin',
    };

    const now = new Date().toISOString();
    await this.client.transaction(async (tx) => {
      await tx.execute(
        `UPDATE knowledge_documents SET
          quality_status = ?,
          provenance_json = ?,
          updated_at = ?
         WHERE id = ? AND tenant_id = ?;`,
        [status, JSON.stringify(updatedProvenance), now, documentId, tenantId]
      );

      await tx.execute(
        'UPDATE knowledge_chunks SET quality_status = ? WHERE document_id = ? AND tenant_id = ?;',
        [status, documentId, tenantId]
      );
    });

    return this.findById(documentId);
  }

  /**
   * Cascading soft / hard delete for document and chunks.
   */
  public async deleteDocument(documentId: string): Promise<boolean> {
    const tenantId = this.getTenantId();
    await this.client.transaction(async (tx) => {
      await tx.execute('DELETE FROM knowledge_chunks WHERE document_id = ? AND tenant_id = ?;', [
        documentId,
        tenantId,
      ]);
      await tx.execute('DELETE FROM knowledge_documents WHERE id = ? AND tenant_id = ?;', [
        documentId,
        tenantId,
      ]);
    });
    return true;
  }

  public async list(options: { limit?: number; offset?: number } = {}): Promise<KnowledgeDocumentRecord[]> {
    return this.listDocuments(options);
  }

  public async listDocuments(options: { limit?: number; offset?: number } = {}): Promise<KnowledgeDocumentRecord[]> {
    const tenantId = this.getTenantId();
    const limit = options.limit || 100;
    const offset = options.offset || 0;
    return this.client.query<KnowledgeDocumentRecord>(
      'SELECT * FROM knowledge_documents WHERE tenant_id = ? AND is_active = 1 ORDER BY created_at DESC LIMIT ? OFFSET ?;',
      [tenantId, limit, offset]
    );
  }

  /**
   * Performs vector similarity search using native pgvector cosine distance on PostgreSQL,
   * or falls back to in-memory cosine similarity on SQLite.
   */
  public async vectorSearch(params: {
    queryVector: number[];
    topK?: number;
    minScore?: number;
  }): Promise<Array<{ chunk: KnowledgeChunkRecord; document: KnowledgeDocumentRecord; similarity: number }>> {
    const tenantId = this.getTenantId();
    const topK = params.topK ?? 5;
    const minScore = params.minScore ?? 0.0;

    if (isPostgres(this.client)) {
      const vectorLiteral = `[${params.queryVector.join(',')}]`;
      const rows = await this.client.query<any>(
        `SELECT
          c.id as chunk_id, c.tenant_id, c.document_id, c.chunk_index, c.heading_context,
          c.content as chunk_content, c.token_count, c.embedding_json, c.embedding_model,
          c.embedding_dimensions, c.quality_status as chunk_quality_status,
          c.metadata_json as chunk_metadata_json, c.created_at as chunk_created_at,
          d.id as doc_id, d.title, d.source_type, d.source_uri, d.mime_type, d.content_raw,
          d.content_normalized, d.summary, d.version, d.is_active, d.quality_status as doc_quality_status,
          d.stale_after_days, d.provenance_json, d.access_scope_json, d.metadata_json as doc_metadata_json,
          d.created_at as doc_created_at, d.updated_at as doc_updated_at,
          (1 - (c.embedding_vector <=> ?::vector)) as similarity
        FROM knowledge_chunks c
        JOIN knowledge_documents d ON c.document_id = d.id AND c.tenant_id = d.tenant_id
        WHERE c.tenant_id = ? AND d.is_active = 1
        ORDER BY c.embedding_vector <=> ?::vector ASC
        LIMIT ?;`,
        [vectorLiteral, tenantId, vectorLiteral, topK]
      );

      return rows
        .map((r) => ({
          chunk: {
            id: r.chunk_id,
            tenant_id: r.tenant_id,
            document_id: r.document_id,
            chunk_index: r.chunk_index,
            heading_context: r.heading_context,
            content: r.chunk_content,
            token_count: r.token_count,
            embedding_json: r.embedding_json,
            embedding_model: r.embedding_model,
            embedding_dimensions: r.embedding_dimensions,
            quality_status: r.chunk_quality_status,
            metadata_json: r.chunk_metadata_json,
            created_at: r.chunk_created_at,
            updated_at: r.chunk_created_at,
          },
          document: {
            id: r.doc_id,
            tenant_id: r.tenant_id,
            organization_id: 'default',
            title: r.title,
            source_type: r.source_type,
            source_uri: r.source_uri,
            mime_type: r.mime_type,
            content_raw: r.content_raw,
            content_normalized: r.content_normalized,
            summary: r.summary,
            version: r.version,
            is_active: r.is_active,
            quality_status: r.doc_quality_status,
            stale_after_days: r.stale_after_days,
            provenance_json: r.provenance_json,
            access_scope_json: r.access_scope_json,
            metadata_json: r.doc_metadata_json,
            created_at: r.doc_created_at,
            updated_at: r.doc_updated_at,
          },
          similarity: Number(r.similarity ?? 0),
        }))
        .filter((r) => r.similarity >= minScore);
    }

    // SQLite in-memory fallback
    const corpus = await this.getTenantChunksWithDocuments();
    const scored = corpus.map((item) => {
      let sim = 0;
      if (item.chunk.embedding_json) {
        try {
          const vec = JSON.parse(item.chunk.embedding_json) as number[];
          sim = EmbeddingService.cosineSimilarity(params.queryVector, vec);
        } catch {
          sim = 0;
        }
      }
      return {
        chunk: item.chunk,
        document: item.document,
        similarity: sim,
      };
    });

    return scored
      .filter((s) => s.similarity >= minScore)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK);
  }
}
