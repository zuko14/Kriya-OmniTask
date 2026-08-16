/**
 * Xylarc AI — Hybrid RAG Retriever (Dense Vector + Sparse BM25 + Scope Gating)
 * Reciprocal Rank Fusion, access permission filtering, freshness checks & conflict detection (§11, §12 of CLAUDE.md).
 */

import {
  KnowledgeDocumentRecord,
  KnowledgeChunkRecord,
  KnowledgeQueryRequest,
  KnowledgeRetrievalResponse,
  RetrievedChunkResult,
  ProvenanceMetadata,
  AccessScope,
} from '../types/knowledgeTypes.js';
import { EmbeddingService } from '../embeddings/embeddingService.js';
import { BM25SearchEngine, BM25Document } from '../embeddings/bm25SearchEngine.js';
import { IndirectInjectionShield } from '../safety/indirectInjectionShield.js';

export interface ChunkWithDocument {
  chunk: KnowledgeChunkRecord;
  document: KnowledgeDocumentRecord;
}

export class HybridRetriever {
  private embeddingService: EmbeddingService;
  private bm25Engine: BM25SearchEngine;

  constructor(embeddingService?: EmbeddingService, bm25Engine?: BM25SearchEngine) {
    this.embeddingService = embeddingService || new EmbeddingService();
    this.bm25Engine = bm25Engine || new BM25SearchEngine();
  }

  /**
   * Performs hybrid search across a corpus of chunks with access gating and quality evaluation.
   */
  public async retrieve(
    req: KnowledgeQueryRequest,
    corpus: ChunkWithDocument[]
  ): Promise<KnowledgeRetrievalResponse> {
    const topK = req.topK || 5;
    const minScore = req.minScore || 0.2;

    // 1. Access Control & Permission Scope Filtering (§11)
    const accessibleChunks = corpus.filter((item) =>
      this.isAccessible(item.document, req.userRole, req.agentId)
    );

    if (accessibleChunks.length === 0) {
      return {
        query: req.query,
        results: [],
        totalMatches: 0,
        qualitySummary: { verifiedCount: 0, unverifiedCount: 0, staleCount: 0, conflictingCount: 0 },
        hasConflicts: false,
        sanitizedContext: IndirectInjectionShield.frameEvidenceContext([]),
      };
    }

    // 2. Generate Query Embedding
    const queryVector = await this.embeddingService.generateEmbedding(req.query);

    // 3. Dense Vector Similarity Scoring
    const vectorScores: Map<string, number> = new Map();
    for (const item of accessibleChunks) {
      if (item.chunk.embedding_json) {
        try {
          const chunkVec = JSON.parse(item.chunk.embedding_json) as number[];
          const sim = EmbeddingService.cosineSimilarity(queryVector, chunkVec);
          vectorScores.set(item.chunk.id, sim);
        } catch {
          vectorScores.set(item.chunk.id, 0);
        }
      } else {
        vectorScores.set(item.chunk.id, 0);
      }
    }

    // 4. Sparse BM25 Keyword Scoring
    const bm25Docs: BM25Document[] = accessibleChunks.map((item) => ({
      id: item.chunk.id,
      text: `${item.chunk.heading_context} ${item.chunk.content}`,
    }));
    const bm25Results = this.bm25Engine.score(req.query, bm25Docs);
    const bm25Scores: Map<string, number> = new Map(bm25Results.map((r) => [r.id, r.score]));

    // 5. Reciprocal Rank Fusion / Weighted Hybrid Ranking (60% Dense Vector, 40% BM25)
    const scoredResults: RetrievedChunkResult[] = accessibleChunks.map((item) => {
      const vScore = vectorScores.get(item.chunk.id) || 0;
      const bScore = bm25Scores.get(item.chunk.id) || 0;
      const hybridScore = 0.6 * vScore + 0.4 * bScore;

      let provenance: ProvenanceMetadata = { tags: [], sourceSystem: 'upload' };
      try {
        provenance = JSON.parse(item.document.provenance_json);
      } catch {}

      // Freshness evaluation: check if document exceeds stale_after_days
      const createdAt = new Date(item.document.created_at).getTime();
      const ageDays = (Date.now() - createdAt) / (1000 * 60 * 60 * 24);
      const isStale = ageDays > (item.document.stale_after_days || 90);
      let qualityStatus = item.chunk.quality_status || item.document.quality_status;
      if (isStale && qualityStatus === 'VERIFIED') {
        qualityStatus = 'STALE';
      }

      return {
        chunkId: item.chunk.id,
        documentId: item.document.id,
        documentTitle: item.document.title,
        sourceType: item.document.source_type,
        sourceUri: item.document.source_uri,
        headingContext: item.chunk.heading_context,
        content: item.chunk.content,
        qualityStatus,
        score: Math.round(hybridScore * 1000) / 1000,
        vectorScore: Math.round(vScore * 1000) / 1000,
        bm25Score: Math.round(bScore * 1000) / 1000,
        provenance,
        isStale,
      };
    });

    // 6. Filter by minScore and Quality Status Filter
    const qualityFilter = req.qualityFilter || ['VERIFIED', 'UNVERIFIED'];
    const filteredResults = scoredResults
      .filter((r) => r.score >= minScore)
      .filter((r) => qualityFilter.includes(r.qualityStatus) || qualityFilter.includes('*' as any))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    // 7. Quality Summary & Conflict Detection
    const qualitySummary = {
      verifiedCount: filteredResults.filter((r) => r.qualityStatus === 'VERIFIED').length,
      unverifiedCount: filteredResults.filter((r) => r.qualityStatus === 'UNVERIFIED').length,
      staleCount: filteredResults.filter((r) => r.isStale || r.qualityStatus === 'STALE').length,
      conflictingCount: filteredResults.filter((r) => r.qualityStatus === 'CONFLICTING').length,
    };

    const hasConflicts = qualitySummary.conflictingCount > 0;

    // 8. Sanitize and package evidence frame
    const sanitizedContext = IndirectInjectionShield.frameEvidenceContext(
      filteredResults.map((r) => ({
        headingContext: r.headingContext,
        content: r.content,
        qualityStatus: r.qualityStatus,
        documentTitle: r.documentTitle,
      }))
    );

    return {
      query: req.query,
      results: filteredResults,
      totalMatches: filteredResults.length,
      qualitySummary,
      hasConflicts,
      sanitizedContext,
    };
  }

  /**
   * Evaluates if document access scope matches user role or agent ID.
   */
  private isAccessible(doc: KnowledgeDocumentRecord, userRole?: string, agentId?: string): boolean {
    if (!doc.access_scope_json) return true;

    try {
      const scope = JSON.parse(doc.access_scope_json) as AccessScope;

      // Check User Role permission
      if (userRole && scope.allowedRoles && scope.allowedRoles.length > 0) {
        if (!scope.allowedRoles.includes('*') && !scope.allowedRoles.includes(userRole)) {
          return false;
        }
      }

      // Check Agent Scope permission
      if (agentId && scope.allowedAgents && scope.allowedAgents.length > 0) {
        if (!scope.allowedAgents.includes('*') && !scope.allowedAgents.includes(agentId)) {
          return false;
        }
      }

      return true;
    } catch {
      return true;
    }
  }
}
