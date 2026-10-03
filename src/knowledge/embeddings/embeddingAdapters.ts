/**
 * Kriya Omnitask — Embedding Adapters (WP-5.8, Blueprint §10, §18)
 *
 * Real embedding generation using OpenAI-compatible HTTP endpoints (OpenRouter, OpenAI, Gemini)
 * and deterministic hash projection adapter for offline/testing fallback.
 *
 * Zero-fabrication guarantees:
 * - Cost computed from versioned pricing table (pricing.ts); returns null if model is unpriced.
 * - API keys are never leaked in error messages or logs.
 * - Real token counts reported from provider responses.
 */

import crypto from 'node:crypto';
import { logger } from '../../core/logger/logger.js';
import { calculateTokenCost } from '../../model/gateway/pricing.js';
import { getAppMode } from '../../core/config/runtimeMode.js';
import { PolicyViolationError } from '../../core/errors/errors.js';

export interface EmbeddingResult {
  embeddings: number[][];
  promptTokens: number;
  costUsd: number | null;
  model: string;
  dimensions: number;
}

export interface EmbeddingAdapterOptions {
  model?: string;
  dimensions?: number;
}

export interface EmbeddingAdapter {
  readonly isDeterministic: boolean;
  readonly defaultModel: string;
  readonly defaultDimensions: number;
  embed(texts: string[], options?: EmbeddingAdapterOptions): Promise<EmbeddingResult>;
}

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export interface OpenAICompatibleEmbeddingAdapterOptions {
  apiKey?: string;
  baseUrl?: string;
  defaultModel?: string;
  defaultDimensions?: number;
  timeoutMs?: number;
  maxRetries?: number;
  fetchFn?: FetchFn;
  sleep?: (ms: number) => Promise<void>;
}

export class EmbeddingProviderError extends Error {
  public retryAfterMs?: number;

  constructor(
    public readonly kind: 'auth' | 'rate_limit' | 'timeout' | 'server' | 'invalid_request' | 'bad_response' | 'network',
    message: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = 'EmbeddingProviderError';
  }

  get retryable(): boolean {
    return this.kind === 'rate_limit' || this.kind === 'server' || this.kind === 'timeout' || this.kind === 'network';
  }
}

function redactKey(msg: string, key?: string): string {
  if (!key || key.length < 8) return msg;
  return msg.replaceAll(key, `${key.slice(0, 4)}…${key.slice(-4)}`);
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Real provider adapter communicating with OpenAI-compatible embedding APIs (OpenRouter, OpenAI, etc.).
 */
export class OpenAICompatibleEmbeddingAdapter implements EmbeddingAdapter {
  public readonly isDeterministic = false;
  public readonly defaultModel: string;
  public readonly defaultDimensions: number;
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetchFn: FetchFn;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(opts: OpenAICompatibleEmbeddingAdapterOptions = {}) {
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl || 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
    this.defaultModel = opts.defaultModel || 'openai/text-embedding-3-small';
    this.defaultDimensions = opts.defaultDimensions || 1536;
    this.timeoutMs = opts.timeoutMs ?? 30000;
    this.maxRetries = opts.maxRetries ?? 2;
    this.fetchFn = opts.fetchFn ?? ((u, i) => fetch(u, i));
    this.sleep = opts.sleep ?? defaultSleep;
  }

  public async embed(texts: string[], options?: EmbeddingAdapterOptions): Promise<EmbeddingResult> {
    if (!texts || texts.length === 0) {
      return {
        embeddings: [],
        promptTokens: 0,
        costUsd: 0,
        model: options?.model || this.defaultModel,
        dimensions: options?.dimensions || this.defaultDimensions,
      };
    }

    if (!this.apiKey) {
      throw new EmbeddingProviderError('auth', 'Embedding API key is required but was not provided.');
    }

    let model = options?.model || this.defaultModel;
    if (this.baseUrl.includes('openrouter.ai') && !model.includes('/')) {
      if (model === 'text-embedding-3-small') model = 'openai/text-embedding-3-small';
      else if (model === 'text-embedding-3-large') model = 'openai/text-embedding-3-large';
      else if (model === 'text-embedding-004') model = 'openai/text-embedding-3-small';
    }
    const requestedDimensions = options?.dimensions || this.defaultDimensions;
    const url = `${this.baseUrl}/embeddings`;

    const requestBody: Record<string, unknown> = {
      model,
      input: texts,
    };

    // Only include dimensions if using modern models that support custom embedding dimensions
    if (model.includes('text-embedding-3')) {
      requestBody.dimensions = requestedDimensions;
    }

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const res = await this.fetchFn(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
            'HTTP-Referer': 'https://kriya.ai',
            'X-Title': 'Kriya Omnitask Embeddings',
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        });

        clearTimeout(timer);

        if (!res.ok) {
          const bodyText = await res.text().catch(() => '');
          const safeBody = redactKey(bodyText, this.apiKey);

          let errorKind: EmbeddingProviderError['kind'] = 'server';
          if (res.status === 401 || res.status === 403) errorKind = 'auth';
          else if (res.status === 429) errorKind = 'rate_limit';
          else if (res.status === 400 || res.status === 422) errorKind = 'invalid_request';

          const err = new EmbeddingProviderError(
            errorKind,
            `Embedding provider returned HTTP ${res.status}: ${safeBody.slice(0, 300)}`,
            res.status
          );

          if (res.status === 429) {
            const retryAfter = res.headers.get('retry-after');
            if (retryAfter) {
              const seconds = parseInt(retryAfter, 10);
              if (!Number.isNaN(seconds)) err.retryAfterMs = seconds * 1000;
            }
          }

          if (err.retryable && attempt < this.maxRetries) {
            lastError = err;
            const backoff = err.retryAfterMs ?? Math.min(1000 * Math.pow(2, attempt) + Math.random() * 200, 10000);
            logger.warn(`Retrying embedding request in ${backoff}ms (attempt ${attempt + 1}/${this.maxRetries}): ${err.message}`);
            await this.sleep(backoff);
            continue;
          }

          throw err;
        }

        const data = await res.json() as any;

        if (!data || !Array.isArray(data.data)) {
          throw new EmbeddingProviderError('bad_response', 'Malformed embedding response: missing "data" array.');
        }

        // Sort items by index to guarantee input-output ordering
        const items = [...data.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
        const embeddings: number[][] = items.map((item) => {
          if (!Array.isArray(item.embedding)) {
            throw new EmbeddingProviderError('bad_response', 'Malformed embedding item: missing "embedding" vector.');
          }
          return item.embedding as number[];
        });

        const promptTokens = Number(data.usage?.prompt_tokens ?? data.usage?.total_tokens ?? 0);
        const costUsd = calculateTokenCost(model, promptTokens, 0).costUsd;
        const actualDimensions = embeddings[0]?.length || requestedDimensions;

        return {
          embeddings,
          promptTokens,
          costUsd,
          model: data.model || model,
          dimensions: actualDimensions,
        };
      } catch (err: any) {
        clearTimeout(timer);

        if (err instanceof EmbeddingProviderError) {
          if (!err.retryable || attempt >= this.maxRetries) throw err;
          lastError = err;
        } else if (err.name === 'AbortError') {
          const timeoutErr = new EmbeddingProviderError('timeout', `Embedding request timed out after ${this.timeoutMs}ms`);
          if (attempt >= this.maxRetries) throw timeoutErr;
          lastError = timeoutErr;
        } else {
          const networkErr = new EmbeddingProviderError('network', redactKey(err.message || String(err), this.apiKey));
          if (attempt >= this.maxRetries) throw networkErr;
          lastError = networkErr;
        }

        const backoff = Math.min(1000 * Math.pow(2, attempt) + Math.random() * 200, 10000);
        logger.warn(`Retrying embedding request on error in ${backoff}ms (attempt ${attempt + 1}/${this.maxRetries})`);
        await this.sleep(backoff);
      }
    }

    throw lastError || new EmbeddingProviderError('server', 'Embedding request failed after retries.');
  }
}

/**
 * Deterministic hash projection adapter for offline development and hermetic unit testing.
 * NOT for production RAG (explicitly flagged via isDeterministic = true).
 */
export class DeterministicHashEmbeddingAdapter implements EmbeddingAdapter {
  public readonly isDeterministic = true;
  public readonly defaultModel: string;
  public readonly defaultDimensions: number;

  constructor(opts: { dimension?: number; model?: string } = {}) {
    this.defaultDimensions = opts.dimension || 64;
    this.defaultModel = opts.model || `deterministic-hash-${this.defaultDimensions}`;
  }

  public async embed(texts: string[], options?: EmbeddingAdapterOptions): Promise<EmbeddingResult> {
    if (getAppMode() === 'production' || process.env.APP_MODE === 'production') {
      throw new PolicyViolationError(
        'DeterministicHashEmbeddingAdapter is strictly prohibited in production mode. A real embedding provider (OpenRouter/OpenAI/Gemini) must be configured.'
      );
    }

    const dim = options?.dimensions || this.defaultDimensions;
    const model = options?.model || this.defaultModel;

    let totalTokens = 0;
    const embeddings: number[][] = texts.map((text) => {
      if (!text || text.trim().length === 0) {
        return new Array(dim).fill(0);
      }

      const clean = text.toLowerCase().trim();
      const words = clean.split(/\W+/).filter((w) => w.length > 0);
      totalTokens += Math.max(1, words.length);
      const vector = new Array(dim).fill(0);

      for (const word of words) {
        const hash = crypto.createHash('sha256').update(word).digest();
        for (let i = 0; i < dim; i++) {
          const byteVal = hash[i % hash.length];
          const val = byteVal / 128.0 - 1.0;
          vector[i] += val;
        }
      }

      // L2 Normalize
      let sumSq = 0;
      for (let i = 0; i < dim; i++) sumSq += vector[i] * vector[i];
      const norm = Math.sqrt(sumSq);
      if (norm === 0) return vector;
      return vector.map((v) => v / norm);
    });

    return {
      embeddings,
      promptTokens: totalTokens,
      costUsd: 0,
      model,
      dimensions: dim,
    };
  }
}
