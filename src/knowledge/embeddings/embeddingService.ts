/**
 * Kriya Omnitask — Dense Vector Embedding & Similarity Engine (WP-5.8, Blueprint §10, §18)
 *
 * Computes vector embeddings using real provider APIs (OpenRouter, OpenAI, Gemini)
 * or deterministic hash projection for offline/test environments.
 * Provides cosine similarity scoring and batching support.
 */

import { config } from '../../core/config/config.js';
import { logger } from '../../core/logger/logger.js';
import { PolicyViolationError } from '../../core/errors/errors.js';
import {
  EmbeddingAdapter,
  EmbeddingResult,
  OpenAICompatibleEmbeddingAdapter,
  DeterministicHashEmbeddingAdapter,
} from './embeddingAdapters.js';

export interface EmbeddingServiceOptions {
  adapter?: EmbeddingAdapter;
  model?: string;
  dimensions?: number;
  maxBatchSize?: number;
  enforceProductionProvider?: boolean;
  useRealProviderInTest?: boolean;
}

export class EmbeddingService {
  private readonly adapter: EmbeddingAdapter;
  private readonly maxBatchSize: number;

  constructor(options: EmbeddingServiceOptions = {}) {
    this.maxBatchSize = options.maxBatchSize || 100;

    if (options.adapter) {
      this.adapter = options.adapter;
      return;
    }

    const nodeEnv = config.get('NODE_ENV');
    const appMode = config.get('APP_MODE');
    const isTest = nodeEnv === 'test' || appMode === 'test';
    const isProduction = appMode === 'production' || (!appMode && nodeEnv === 'production');

    // In unit tests, default to DeterministicHashEmbeddingAdapter for fast hermetic execution
    // unless an explicit real provider is requested or production is enforced
    if (isTest && !options.enforceProductionProvider && !options.useRealProviderInTest) {
      this.adapter = new DeterministicHashEmbeddingAdapter({
        dimension: options.dimensions || 64,
        model: options.model || 'deterministic-hash-64',
      });
      logger.debug(`Initialized DeterministicHashEmbeddingAdapter (${this.adapter.defaultDimensions}d) for test environment`);
      return;
    }

    // Resolve key from environment or config
    const openrouterKey = config.get('OPENROUTER_API_KEY') || process.env.KRIYA_LIVE_TEST_OPENROUTER_KEY;
    const openaiKey = config.get('OPENAI_API_KEY');
    const apiKey = openrouterKey || openaiKey;

    if (apiKey) {
      const baseUrl = openrouterKey
        ? config.get('OPENROUTER_BASE_URL') || 'https://openrouter.ai/api/v1'
        : 'https://api.openai.com/v1';

      const defaultModel = options.model || config.get('EMBEDDING_MODEL') || (openrouterKey ? 'openai/text-embedding-3-small' : 'text-embedding-3-small');
      const defaultDimensions = options.dimensions || config.get('EMBEDDING_DIMENSIONS') || 1536;

      this.adapter = new OpenAICompatibleEmbeddingAdapter({
        apiKey,
        baseUrl,
        defaultModel,
        defaultDimensions,
      });
      logger.info(`Initialized OpenAI-compatible EmbeddingService with model '${defaultModel}' (${defaultDimensions}d)`);
    } else {
      if (isProduction || options.enforceProductionProvider) {
        throw new PolicyViolationError(
          'Refusing to initialize deterministic hash embeddings in production mode. Configure OPENROUTER_API_KEY or OPENAI_API_KEY.',
          { appMode }
        );
      }

      this.adapter = new DeterministicHashEmbeddingAdapter({
        dimension: options.dimensions || 64,
        model: options.model || 'deterministic-hash-64',
      });
      logger.debug(`Initialized DeterministicHashEmbeddingAdapter (${this.adapter.defaultDimensions}d) for non-production environment`);
    }
  }

  /**
   * Generates a normalized dense vector embedding for a single text string.
   */
  public async generateEmbedding(text: string): Promise<number[]> {
    const res = await this.generateEmbeddings([text]);
    return res[0] || new Array(this.getDimension()).fill(0);
  }

  /**
   * Generates embeddings for multiple texts, automatically chunking into batches.
   */
  public async generateEmbeddings(texts: string[]): Promise<number[][]> {
    const meta = await this.generateEmbeddingsWithMetadata(texts);
    return meta.embeddings;
  }

  /**
   * Generates embedding with token counts and cost attribution metadata for a single text.
   */
  public async generateEmbeddingWithMetadata(text: string): Promise<{
    embedding: number[];
    promptTokens: number;
    costUsd: number | null;
    model: string;
    dimensions: number;
  }> {
    const res = await this.generateEmbeddingsWithMetadata([text]);
    return {
      embedding: res.embeddings[0] || new Array(this.getDimension()).fill(0),
      promptTokens: res.promptTokens,
      costUsd: res.costUsd,
      model: res.model,
      dimensions: res.dimensions,
    };
  }

  /**
   * Generates embeddings with token counts and cost attribution metadata for multiple texts.
   */
  public async generateEmbeddingsWithMetadata(texts: string[]): Promise<EmbeddingResult> {
    if (!texts || texts.length === 0) {
      return {
        embeddings: [],
        promptTokens: 0,
        costUsd: 0,
        model: this.getModel(),
        dimensions: this.getDimension(),
      };
    }

    // Process in batches if texts exceed maxBatchSize
    if (texts.length <= this.maxBatchSize) {
      return this.adapter.embed(texts);
    }

    const allEmbeddings: number[][] = [];
    let totalPromptTokens = 0;
    let totalCostUsd: number | null = 0;
    let model = this.getModel();
    let dimensions = this.getDimension();

    for (let i = 0; i < texts.length; i += this.maxBatchSize) {
      const batch = texts.slice(i, i + this.maxBatchSize);
      const batchRes = await this.adapter.embed(batch);

      allEmbeddings.push(...batchRes.embeddings);
      totalPromptTokens += batchRes.promptTokens;
      if (batchRes.costUsd !== null && totalCostUsd !== null) {
        totalCostUsd += batchRes.costUsd;
      } else {
        totalCostUsd = null;
      }
      model = batchRes.model;
      dimensions = batchRes.dimensions;
    }

    return {
      embeddings: allEmbeddings,
      promptTokens: totalPromptTokens,
      costUsd: totalCostUsd,
      model,
      dimensions,
    };
  }

  public getAdapter(): EmbeddingAdapter {
    return this.adapter;
  }

  public getDimension(): number {
    return this.adapter.defaultDimensions;
  }

  public getModel(): string {
    return this.adapter.defaultModel;
  }

  public isDeterministic(): boolean {
    return this.adapter.isDeterministic;
  }

  /**
   * Computes Cosine Similarity between two normalized vectors (returns value between 0.0 and 1.0).
   */
  public static cosineSimilarity(a: number[], b: number[]): number {
    if (!a || !b || a.length !== b.length || a.length === 0) return 0;

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

  /**
   * Computes L2 Normalization on a vector.
   */
  public static l2Normalize(vec: number[]): number[] {
    let sumSq = 0;
    for (let i = 0; i < vec.length; i++) {
      sumSq += vec[i] * vec[i];
    }
    const norm = Math.sqrt(sumSq);
    if (norm === 0) return vec;
    return vec.map((v) => v / norm);
  }
}
