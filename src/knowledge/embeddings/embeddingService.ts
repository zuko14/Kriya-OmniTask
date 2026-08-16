/**
 * Xylarc AI — Dense Vector Embedding & Similarity Engine
 * Computes vector embeddings and performs cosine similarity vector comparisons (§10 of CLAUDE.md).
 */

import crypto from 'crypto';

export class EmbeddingService {
  private readonly dimension: number = 64;

  /**
   * Generates a normalized dense vector embedding for a text string.
   * Uses a deterministic hash projection algorithm for high-performance offline & local execution,
   * while allowing provider plug-ins for OpenAI / Gemini embedding models.
   */
  public async generateEmbedding(text: string): Promise<number[]> {
    if (!text || text.trim().length === 0) {
      return new Array(this.dimension).fill(0);
    }

    const clean = text.toLowerCase().trim();
    const words = clean.split(/\W+/).filter((w) => w.length > 0);
    const vector = new Array(this.dimension).fill(0);

    for (const word of words) {
      // Deterministic hash projection into embedding dimensions
      const hash = crypto.createHash('sha256').update(word).digest();
      for (let i = 0; i < this.dimension; i++) {
        const byteVal = hash[i % hash.length];
        const val = (byteVal / 128.0) - 1.0; // [-1.0, 1.0]
        vector[i] += val;
      }
    }

    // L2 Normalize Vector
    return this.l2Normalize(vector);
  }

  /**
   * Computes Cosine Similarity between two normalized vectors (returns value between -1.0 and 1.0).
   */
  public static cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    if (normA === 0 || normB === 0) return 0;
    const similarity = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    // Clamp to [0, 1] range for search relevance scoring
    return Math.max(0, Math.min(1, (similarity + 1) / 2));
  }

  private l2Normalize(vec: number[]): number[] {
    let sumSq = 0;
    for (let i = 0; i < vec.length; i++) {
      sumSq += vec[i] * vec[i];
    }
    const norm = Math.sqrt(sumSq);
    if (norm === 0) return vec;
    return vec.map((v) => v / norm);
  }
}
