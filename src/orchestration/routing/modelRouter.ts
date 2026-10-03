/**
 * Kriya Omnitask — Model Router & Cost Intelligence Engine
 * Provider-agnostic model routing with automatic fallback and token cost attribution (§24 of CLAUDE.md).
 *
 * Production/staging route through OpenRouter (docs/kriya WP-1.2, decision D2).
 * The deterministic adapter exists for tests and sandbox demos only and refuses to construct elsewhere.
 */

import { ModelPolicy, ModelPolicyInput } from '../../agents/types/agentTypes.js';
import { logger } from '../../core/logger/logger.js';
import { config } from '../../core/config/config.js';
import { isSandboxMode, NotConfiguredError } from '../../core/config/runtimeMode.js';
import { OpenRouterAdapter } from '../../model/gateway/openRouterAdapter.js';

export interface ModelCompletionRequest {
  systemPrompt: string;
  userPrompt: string;
  contextData?: Record<string, unknown>;
  policy: ModelPolicyInput | ModelPolicy;
  temperature?: number;
  maxTokens?: number;
  /** Request a single JSON object from the model. */
  jsonMode?: boolean;
}

export type CostSource = 'provider' | 'price_table' | 'unknown';

export interface ModelCompletionResponse {
  modelUsed: string;
  content: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** USD. 0 when costSource is 'unknown' — never a guessed figure. */
  estimatedCostUsd: number;
  costSource: CostSource;
  durationMs: number;
  isFallback: boolean;
}

// Rates per 1,000,000 tokens (USD). Used only when the provider doesn't report cost.
export const MODEL_PRICING: Record<string, { promptPer1M: number; completionPer1M: number }> = {
  'gemini-2.5-flash': { promptPer1M: 0.15, completionPer1M: 0.60 },
  'gemini-2.5-pro': { promptPer1M: 1.25, completionPer1M: 5.00 },
  'claude-3-5-sonnet': { promptPer1M: 3.00, completionPer1M: 15.00 },
  'gpt-4o': { promptPer1M: 2.50, completionPer1M: 10.00 },
  'gpt-4o-mini': { promptPer1M: 0.15, completionPer1M: 0.60 },
};

export interface LLMExecuteOptions {
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
}

export interface LLMProviderAdapter {
  execute(model: string, systemPrompt: string, userPrompt: string, options?: LLMExecuteOptions): Promise<{
    content: string;
    promptTokens: number;
    completionTokens: number;
    /** Provider-reported USD cost when available. */
    costUsd?: number | null;
  }>;
}

/**
 * Deterministic adapter for tests and sandbox demos ONLY.
 * Its default reply is explicitly marked as simulated and is never presented as a real result.
 */
export class DeterministicLLMAdapter implements LLMProviderAdapter {
  private mockResponses: Map<string, string> = new Map();

  constructor() {
    if (!isSandboxMode()) {
      throw new NotConfiguredError('DeterministicLLMAdapter', 'simulated model output is only allowed in sandbox/test mode.');
    }
  }

  public registerMock(keySubstring: string, response: string): void {
    this.mockResponses.set(keySubstring.toLowerCase(), response);
  }

  public async execute(
    model: string,
    systemPrompt: string,
    userPrompt: string,
    _options?: LLMExecuteOptions
  ): Promise<{ content: string; promptTokens: number; completionTokens: number }> {
    const combined = `${systemPrompt}\n${userPrompt}`.toLowerCase();

    let responseText = '';
    for (const [key, resp] of this.mockResponses.entries()) {
      if (combined.includes(key)) {
        responseText = resp;
        break;
      }
    }

    if (!responseText) {
      responseText = JSON.stringify({
        taskId: 'auto-generated',
        status: 'completed',
        facts: ['[SANDBOX] Simulated model output — no real model was called'],
        evidence: [{ source: 'sandbox_deterministic_adapter', timestamp: new Date().toISOString() }],
        confidence: 0.95,
        recommendedAction: 'Process next workflow step',
        risks: [],
        policyFlags: ['SANDBOX_SIMULATED_OUTPUT'],
        requiresApproval: false,
        details: { model, promptLength: userPrompt.length, sandbox: true },
      });
    }

    return {
      content: responseText,
      promptTokens: Math.ceil((systemPrompt.length + userPrompt.length) / 4),
      completionTokens: Math.ceil(responseText.length / 4),
    };
  }
}

/** Placeholder used when no real provider is configured outside sandbox: fails loudly on use. */
class UnconfiguredLLMAdapter implements LLMProviderAdapter {
  public async execute(): Promise<never> {
    throw new NotConfiguredError('Model provider', 'set OPENROUTER_API_KEY to enable real inference.');
  }
}

function resolveDefaultAdapter(): LLMProviderAdapter {
  if (isSandboxMode()) return new DeterministicLLMAdapter();
  if (config.get('OPENROUTER_API_KEY')) return new OpenRouterAdapter();
  return new UnconfiguredLLMAdapter();
}

/** Appends structured context to the user prompt so the model actually receives it. */
export function buildUserPrompt(userPrompt: string, contextData?: Record<string, unknown>): string {
  if (!contextData || Object.keys(contextData).length === 0) return userPrompt;
  return `${userPrompt}\n\n## Context (JSON, authoritative data from Kriya systems)\n${JSON.stringify(contextData)}`;
}

export class ModelRouter {
  private adapter: LLMProviderAdapter;

  constructor(adapter?: LLMProviderAdapter) {
    this.adapter = adapter || resolveDefaultAdapter();
  }

  public setAdapter(adapter: LLMProviderAdapter): void {
    this.adapter = adapter;
  }

  /**
   * Routes completion request to primary model with automatic failover to fallback model.
   * If both fail, the error propagates — a failed call is never turned into a result.
   */
  public async complete(req: ModelCompletionRequest): Promise<ModelCompletionResponse> {
    const startTime = Date.now();
    const primaryModel = req.policy.primaryModel || 'gemini-2.5-flash';
    const fallbackModel = req.policy.fallbackModel || 'gemini-2.5-pro';
    const userPrompt = buildUserPrompt(req.userPrompt, req.contextData);
    const options: LLMExecuteOptions = {
      temperature: req.temperature ?? req.policy.temperature,
      maxTokens: req.maxTokens ?? req.policy.maxTokens,
      jsonMode: req.jsonMode,
    };

    const run = async (model: string, isFallback: boolean): Promise<ModelCompletionResponse> => {
      const result = await this.adapter.execute(model, req.systemPrompt, userPrompt, options);
      const { costUsd, costSource } = this.resolveCost(model, result.promptTokens, result.completionTokens, result.costUsd);
      return {
        modelUsed: model,
        content: result.content,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        totalTokens: result.promptTokens + result.completionTokens,
        estimatedCostUsd: costUsd,
        costSource,
        durationMs: Date.now() - startTime,
        isFallback,
      };
    };

    try {
      return await run(primaryModel, false);
    } catch (primaryErr) {
      if (primaryErr instanceof NotConfiguredError || fallbackModel === primaryModel) throw primaryErr;
      logger.warn(`Primary model '${primaryModel}' failed. Triggering automatic fallback to '${fallbackModel}'`, {
        error: primaryErr instanceof Error ? primaryErr.message : String(primaryErr),
      });
      return run(fallbackModel, true);
    }
  }

  /**
   * USD cost from the price table, or null when the model isn't priced (never a guess).
   */
  public calculateCost(model: string, promptTokens: number, completionTokens: number): number | null {
    const pricing = MODEL_PRICING[model];
    if (!pricing) return null;
    const promptCost = (promptTokens / 1_000_000) * pricing.promptPer1M;
    const completionCost = (completionTokens / 1_000_000) * pricing.completionPer1M;
    return parseFloat((promptCost + completionCost).toFixed(6));
  }

  private resolveCost(
    model: string,
    promptTokens: number,
    completionTokens: number,
    providerCost?: number | null
  ): { costUsd: number; costSource: CostSource } {
    if (typeof providerCost === 'number') return { costUsd: providerCost, costSource: 'provider' };
    const tableCost = this.calculateCost(model, promptTokens, completionTokens);
    if (tableCost !== null) return { costUsd: tableCost, costSource: 'price_table' };
    logger.warn(`No cost data for model '${model}'; recording cost as unknown.`);
    return { costUsd: 0, costSource: 'unknown' };
  }
}
