/**
 * Kriya Omnitask — OpenRouter Model Adapter (docs/kriya WP-1.2)
 * Real inference over OpenRouter's OpenAI-compatible Chat Completions API using native fetch.
 * One adapter reaches every provider OpenRouter routes to (Anthropic, OpenAI, Google, DeepSeek, Meta…).
 *
 * Guarantees: bounded timeout, bounded retries (429/5xx/network only), real token usage and
 * provider-reported cost, typed errors, and the API key never appears in errors or logs.
 */

import { config } from '../../core/config/config.js';
import { logger } from '../../core/logger/logger.js';

export type ProviderErrorKind = 'auth' | 'rate_limit' | 'timeout' | 'server' | 'invalid_request' | 'bad_response' | 'network' | 'truncated';

export class ProviderError extends Error {
  public retryAfterMs?: number;

  constructor(
    public readonly kind: ProviderErrorKind,
    message: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = 'ProviderError';
  }

  get retryable(): boolean {
    return this.kind === 'rate_limit' || this.kind === 'server' || this.kind === 'timeout' || this.kind === 'network';
  }
}

export interface ChatExecutionOptions {
  temperature?: number;
  maxTokens?: number;
  /** Ask the model for a single JSON object (response_format json_object). */
  jsonMode?: boolean;
}

export interface ChatExecutionResult {
  content: string;
  promptTokens: number;
  completionTokens: number;
  /** Provider-reported USD cost; null when the provider did not report it. */
  costUsd: number | null;
  /** The concrete model OpenRouter served (may differ from the requested alias). */
  servedModel: string;
  /** True when the reply hit the token limit (free-text mode only; JSON mode throws instead). */
  truncated: boolean;
}

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export interface OpenRouterAdapterOptions {
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  fetchFn?: FetchFn;
  /** Injectable for tests so backoff doesn't slow the suite. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Short model names used across agent templates → OpenRouter model slugs.
 * Anything containing '/' is already an OpenRouter slug and passes through unchanged.
 */
export const OPENROUTER_MODEL_ALIASES: Record<string, string> = {
  'gemini-2.5-flash': 'google/gemini-2.5-flash',
  'gemini-2.5-pro': 'google/gemini-2.5-pro',
  'gpt-4o': 'openai/gpt-4o',
  'gpt-4o-mini': 'openai/gpt-4o-mini',
  'claude-3-5-sonnet': 'anthropic/claude-3.5-sonnet',
};

export function toOpenRouterModel(model: string): string {
  if (model.includes('/')) return model;
  return OPENROUTER_MODEL_ALIASES[model] ?? model;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface ModelPricing {
  promptPer1M: number;
  completionPer1M: number;
}

const pricingCache = new Map<string, { pricing: ModelPricing | null; fetchedAt: number }>();
const PRICING_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * Live per-model price from OpenRouter's public model list (USD per 1M tokens).
 * Returns null when the model isn't listed or the list can't be fetched — callers must then
 * say the price is unknown rather than guess.
 */
export async function fetchOpenRouterPricing(model: string, fetchFn: FetchFn = (u, i) => fetch(u, i)): Promise<ModelPricing | null> {
  const slug = toOpenRouterModel(model);
  const cached = pricingCache.get(slug);
  if (cached && Date.now() - cached.fetchedAt < PRICING_TTL_MS) return cached.pricing;

  let pricing: ModelPricing | null = null;
  try {
    const base = (config.get('OPENROUTER_BASE_URL') ?? 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
    const res = await fetchFn(`${base}/models`, { signal: AbortSignal.timeout(10_000) });
    if (res.ok) {
      const body = (await res.json()) as { data?: Array<{ id: string; pricing?: { prompt?: string; completion?: string } }> };
      const entry = body.data?.find((m) => m.id === slug);
      const prompt = Number(entry?.pricing?.prompt);
      const completion = Number(entry?.pricing?.completion);
      if (entry && Number.isFinite(prompt) && Number.isFinite(completion)) {
        pricing = { promptPer1M: prompt * 1e6, completionPer1M: completion * 1e6 };
      }
    }
  } catch (err) {
    logger.warn(`Could not fetch OpenRouter pricing for '${slug}': ${err instanceof Error ? err.message : String(err)}`);
  }
  pricingCache.set(slug, { pricing, fetchedAt: Date.now() });
  return pricing;
}

export class OpenRouterAdapter {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetchFn: FetchFn;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(opts: OpenRouterAdapterOptions = {}) {
    const apiKey = opts.apiKey ?? config.get('OPENROUTER_API_KEY');
    if (!apiKey) {
      throw new ProviderError('auth', 'OPENROUTER_API_KEY is not configured.');
    }
    this.apiKey = apiKey;
    this.baseUrl = (opts.baseUrl ?? config.get('OPENROUTER_BASE_URL') ?? 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
    this.timeoutMs = opts.timeoutMs ?? 60_000;
    this.maxRetries = opts.maxRetries ?? 2;
    this.fetchFn = opts.fetchFn ?? ((url, init) => fetch(url, init));
    this.sleep = opts.sleep ?? defaultSleep;
  }

  public async execute(
    model: string,
    systemPrompt: string,
    userPrompt: string,
    options: ChatExecutionOptions = {}
  ): Promise<ChatExecutionResult> {
    const body: Record<string, unknown> = {
      model: toOpenRouterModel(model),
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      usage: { include: true },
    };
    if (options.temperature !== undefined) body.temperature = options.temperature;
    if (options.maxTokens !== undefined) body.max_tokens = options.maxTokens;
    if (options.jsonMode) body.response_format = { type: 'json_object' };

    let attempt = 0;
    for (;;) {
      try {
        return await this.attempt(body);
      } catch (err) {
        const providerErr = err instanceof ProviderError ? err : new ProviderError('network', String(err));
        if (!providerErr.retryable || attempt >= this.maxRetries) throw providerErr;
        const delay = this.backoffMs(attempt, providerErr.retryAfterMs);
        logger.warn(`OpenRouter ${providerErr.kind} on '${String(body.model)}', retry ${attempt + 1}/${this.maxRetries} in ${delay}ms`);
        await this.sleep(delay);
        attempt++;
      }
    }
  }

  private backoffMs(attempt: number, retryAfterMs?: number): number {
    if (retryAfterMs !== undefined) return Math.min(retryAfterMs, 10_000);
    const base = 500 * 2 ** attempt;
    return base + Math.floor(Math.random() * base * 0.25);
  }

  private async attempt(body: Record<string, unknown>): Promise<ChatExecutionResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchFn(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'X-Title': 'Kriya Omnitask',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if (controller.signal.aborted) {
        throw new ProviderError('timeout', `OpenRouter request timed out after ${this.timeoutMs}ms`);
      }
      throw new ProviderError('network', `OpenRouter network error: ${this.redact(err instanceof Error ? err.message : String(err))}`);
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const detail = this.redact(await res.text().catch(() => '')).slice(0, 300);
      const kind: ProviderErrorKind =
        res.status === 401 || res.status === 403 ? 'auth'
        : res.status === 429 ? 'rate_limit'
        : res.status >= 500 ? 'server'
        : 'invalid_request';
      const error = new ProviderError(kind, `OpenRouter HTTP ${res.status}: ${detail}`, res.status);
      const retryAfter = Number(res.headers.get('retry-after'));
      if (Number.isFinite(retryAfter) && retryAfter > 0) error.retryAfterMs = retryAfter * 1000;
      throw error;
    }

    let json: any;
    try {
      json = await res.json();
    } catch {
      throw new ProviderError('bad_response', 'OpenRouter returned a non-JSON body.');
    }

    // OpenRouter can return HTTP 200 with an error object (e.g. upstream provider failure).
    if (json?.error) {
      const code = Number(json.error.code);
      const kind: ProviderErrorKind = code === 429 ? 'rate_limit' : code >= 500 ? 'server' : 'invalid_request';
      throw new ProviderError(kind, `OpenRouter error: ${this.redact(String(json.error.message ?? 'unknown'))}`, code || undefined);
    }

    const content = json?.choices?.[0]?.message?.content;
    // A reply cut off by the token limit is not an answer. Reasoning models can spend the whole
    // budget thinking and return EMPTY content with finish_reason=length — report that precisely.
    const finishReason = json?.choices?.[0]?.finish_reason ?? json?.choices?.[0]?.native_finish_reason;
    const truncated = finishReason === 'length' || finishReason === 'max_tokens';
    if (typeof content !== 'string' || content.length === 0) {
      throw truncated
        ? new ProviderError('truncated', `Model used the whole max_tokens budget (${String(body.max_tokens ?? 'default')}) before answering (likely internal reasoning); raise maxTokens.`)
        : new ProviderError('bad_response', 'OpenRouter response contained no message content.');
    }
    // In JSON mode a truncated reply is always invalid, so fail instead of returning partial JSON.
    if (truncated && body.response_format) {
      throw new ProviderError('truncated', `OpenRouter reply was truncated at max_tokens (${String(body.max_tokens ?? 'default')}); raise maxTokens.`);
    }

    const usage = json.usage ?? {};
    return {
      content,
      promptTokens: Number(usage.prompt_tokens ?? 0),
      completionTokens: Number(usage.completion_tokens ?? 0),
      costUsd: typeof usage.cost === 'number' ? usage.cost : null,
      servedModel: String(json.model ?? body.model),
      truncated,
    };
  }

  private redact(text: string): string {
    return text.split(this.apiKey).join('[REDACTED]');
  }
}
