/**
 * Xylarc AI — Knowledge Fabric Service
 * High-level orchestration service for document ingestion, recursive chunking, embedding, hybrid search, and provenance lineage (§10-§12 of CLAUDE.md).
 */

import {
  IngestDocumentRequest,
  KnowledgeDocumentRecord,
  KnowledgeChunkRecord,
  KnowledgeQueryRequest,
  KnowledgeRetrievalResponse,
  KnowledgeQualityStatus,
  ProvenanceMetadata,
  AccessScope,
} from '../types/knowledgeTypes.js';
import { KnowledgeRepository } from '../repositories/knowledgeRepository.js';
import { LineageRepository } from '../repositories/lineageRepository.js';
import { DocumentParser } from '../parsers/documentParser.js';
import { DocumentChunker } from '../parsers/documentChunker.js';
import { EmbeddingService } from '../embeddings/embeddingService.js';
import { HybridRetriever } from '../retrieval/hybridRetriever.js';
import { NotFoundError, ValidationError } from '../../core/errors/errors.js';
import { logger } from '../../core/logger/logger.js';
import crypto from 'crypto';

export class KnowledgeFabricService {
  private knowledgeRepo: KnowledgeRepository;
  private lineageRepo: LineageRepository;
  private embeddingService: EmbeddingService;
  private hybridRetriever: HybridRetriever;

  constructor(dependencies?: {
    knowledgeRepo?: KnowledgeRepository;
    lineageRepo?: LineageRepository;
    embeddingService?: EmbeddingService;
    hybridRetriever?: HybridRetriever;
  }) {
    this.knowledgeRepo = dependencies?.knowledgeRepo || new KnowledgeRepository();
    this.lineageRepo = dependencies?.lineageRepo || new LineageRepository();
    this.embeddingService = dependencies?.embeddingService || new EmbeddingService();
    this.hybridRetriever = dependencies?.hybridRetriever || new HybridRetriever(this.embeddingService);
  }

  /**
   * Ingests, parses, chunks, embeds, and stores a document with provenance tracking.
   */
  public async ingestDocument(
    req: IngestDocumentRequest,
    actor: { actorType: 'user' | 'agent' | 'system'; actorId: string } = { actorType: 'user', actorId: 'admin' }
  ): Promise<{ document: KnowledgeDocumentRecord; chunkCount: number }> {
    // 1. Compute Content Hash for Provenance
    const contentHash = crypto.createHash('sha256').update(req.content).digest('hex');
    const sourceType = req.sourceType || 'markdown';

    // 2. Parse & Normalize Document (§10)
    const parsed = DocumentParser.parse(req.content, sourceType);

    // 3. Recursive Windowed Chunking
    const generatedChunks = DocumentChunker.chunkSections(parsed.sections);
    if (generatedChunks.length === 0) {
      throw new ValidationError('Document contains no parseable text content for ingestion.');
    }

    // 4. Generate Dense Vector Embeddings
    const chunksWithEmbeddings = await Promise.all(
      generatedChunks.map(async (c) => {
        const embedding = await this.embeddingService.generateEmbedding(`${c.headingContext}\n${c.content}`);
        return {
          chunkIndex: c.chunkIndex,
          headingContext: c.headingContext,
          content: c.content,
          tokenCount: c.tokenCount,
          embeddingJson: JSON.stringify(embedding),
          metadataJson: '{}',
        };
      })
    );

    // 5. Package Provenance & Access Scopes
    const provenance: ProvenanceMetadata = {
      author: req.provenance?.author,
      uploadedBy: req.provenance?.uploadedBy || actor.actorId,
      sourceSystem: req.provenance?.sourceSystem || 'direct_upload',
      contentHash,
      tags: req.provenance?.tags || [],
    };

    const accessScope: AccessScope = {
      allowedRoles: req.accessScope?.allowedRoles || ['admin', 'support_agent'],
      allowedAgents: req.accessScope?.allowedAgents || ['*'],
      isPublicToTenant: req.accessScope?.isPublicToTenant ?? true,
    };

    // 6. Relational & Vector Persistence
    const { document, chunks } = await this.knowledgeRepo.createDocumentWithChunks({
      title: req.title,
      sourceType,
      sourceUri: req.sourceUri,
      mimeType: req.mimeType,
      contentRaw: req.content,
      contentNormalized: parsed.normalizedContent,
      summary: req.summary || parsed.summary,
      qualityStatus: 'UNVERIFIED',
      staleAfterDays: req.staleAfterDays || 90,
      provenanceJson: JSON.stringify(provenance),
      accessScopeJson: JSON.stringify(accessScope),
      metadataJson: JSON.stringify(req.metadata || {}),
      chunks: chunksWithEmbeddings,
    });

    // 7. Record Ingestion Lineage Event
    await this.lineageRepo.recordEvent({
      documentId: document.id,
      eventType: 'ingested',
      actorType: actor.actorType,
      actorId: actor.actorId,
      details: {
        title: document.title,
        sourceType: document.source_type,
        chunkCount: chunks.length,
        contentHash,
      },
    });

    logger.info(`Knowledge document '${document.title}' (ID: ${document.id}) ingested with ${chunks.length} chunks.`);

    return { document, chunkCount: chunks.length };
  }

  /**
   * Performs hybrid search with access gating and records retrieval lineage trace.
   */
  public async query(
    req: KnowledgeQueryRequest,
    context: { actorType?: 'user' | 'agent' | 'system'; actorId?: string; agentId?: string } = {}
  ): Promise<KnowledgeRetrievalResponse> {
    const corpus = await this.knowledgeRepo.getTenantChunksWithDocuments();

    // Query parameters
    const queryParams: KnowledgeQueryRequest = {
      ...req,
      agentId: req.agentId || context.agentId,
    };

    const result = await this.hybridRetriever.retrieve(queryParams, corpus);

    // Record retrieval lineage trace for matched documents
    if (result.results.length > 0) {
      const distinctDocIds = Array.from(new Set(result.results.map((r) => r.documentId)));
      for (const docId of distinctDocIds) {
        await this.lineageRepo.recordEvent({
          documentId: docId,
          eventType: 'retrieved',
          actorType: context.actorType || 'agent',
          actorId: context.actorId || 'agent_query',
          agentId: queryParams.agentId,
          queryText: req.query,
          details: { matchCount: result.results.filter((r) => r.documentId === docId).length },
        });
      }
    }

    return result;
  }

  /**
   * Lists all active documents in tenant scope.
   */
  public async listDocuments(): Promise<KnowledgeDocumentRecord[]> {
    return this.knowledgeRepo.list({ limit: 100 });
  }

  /**
   * Retrieves document and its child chunks by ID.
   */
  public async getDocument(
    documentId: string
  ): Promise<{ document: KnowledgeDocumentRecord; chunks: KnowledgeChunkRecord[] }> {
    const document = await this.knowledgeRepo.findById(documentId);
    if (!document) {
      throw new NotFoundError(`Knowledge document '${documentId}' not found.`);
    }

    const chunks = await this.knowledgeRepo.getChunksForDocument(documentId);
    return { document, chunks };
  }

  /**
   * Updates document quality status (e.g. mark as VERIFIED or STALE).
   */
  public async updateQualityStatus(
    documentId: string,
    status: KnowledgeQualityStatus,
    verifiedBy: string = 'admin'
  ): Promise<KnowledgeDocumentRecord> {
    const updated = await this.knowledgeRepo.updateQualityStatus(documentId, status, verifiedBy);
    if (!updated) {
      throw new NotFoundError(`Knowledge document '${documentId}' not found.`);
    }

    await this.lineageRepo.recordEvent({
      documentId,
      eventType: 'verified',
      actorType: 'user',
      actorId: verifiedBy,
      details: { newQualityStatus: status },
    });

    return updated;
  }

  /**
   * Deletes document and its chunks cascadingly.
   */
  public async deleteDocument(documentId: string, actorId: string = 'admin'): Promise<boolean> {
    const doc = await this.knowledgeRepo.findById(documentId);
    if (!doc) {
      throw new NotFoundError(`Knowledge document '${documentId}' not found.`);
    }

    await this.knowledgeRepo.deleteDocument(documentId);

    await this.lineageRepo.recordEvent({
      documentId,
      eventType: 'invalidated',
      actorType: 'user',
      actorId: actorId,
      details: { action: 'hard_delete' },
    });

    return true;
  }
}
