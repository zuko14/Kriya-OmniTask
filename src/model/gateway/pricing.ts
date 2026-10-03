/**
 * Kriya Omnitask — Versioned Model Pricing Table (WP-1.1b, WP-1.4; Blueprint §18)
 *
 * Deterministic, versioned lookup for token-based cost attribution and pre-call budget estimation.
 * ZERO-FABRICATION RULE: Unknown models return costUsd: null and costSource: 'unknown'.
 * Never fabricate or hallucinate a cost number.
 */

import { logger } from '../../core/logger/logger.js';

export const PRICING_TABLE_VERSION = '2026-10-01-v1';

export interface ModelPriceRate {
  promptPer1M: number;
  completionPer1M: number;
  provider: 'google' | 'openai' | 'anthropic' | 'deepseek' | 'meta' | 'openrouter' | 'local';
}

export const MODEL_PRICE_TABLE: Record<string, ModelPriceRate> = {
  // DeepSeek
  'deepseek/deepseek-chat': { promptPer1M: 0.14, completionPer1M: 0.28, provider: 'deepseek' },
  'deepseek/deepseek-v4-flash': { promptPer1M: 0.07, completionPer1M: 0.14, provider: 'deepseek' },
  'deepseek/deepseek-r1': { promptPer1M: 0.55, completionPer1M: 2.19, provider: 'deepseek' },
  'deepseek-chat': { promptPer1M: 0.14, completionPer1M: 0.28, provider: 'deepseek' },
  'deepseek-v4-flash': { promptPer1M: 0.07, completionPer1M: 0.14, provider: 'deepseek' },
  'deepseek-r1': { promptPer1M: 0.55, completionPer1M: 2.19, provider: 'deepseek' },

  // Google Gemini
  'gemini-2.5-flash': { promptPer1M: 0.15, completionPer1M: 0.60, provider: 'google' },
  'gemini-2.5-pro': { promptPer1M: 1.25, completionPer1M: 5.00, provider: 'google' },
  'google/gemini-2.5-flash': { promptPer1M: 0.15, completionPer1M: 0.60, provider: 'google' },
  'google/gemini-2.5-pro': { promptPer1M: 1.25, completionPer1M: 5.00, provider: 'google' },

  // OpenAI
  'gpt-4o': { promptPer1M: 2.50, completionPer1M: 10.00, provider: 'openai' },
  'gpt-4o-mini': { promptPer1M: 0.15, completionPer1M: 0.60, provider: 'openai' },
  'openai/gpt-4o': { promptPer1M: 2.50, completionPer1M: 10.00, provider: 'openai' },
  'openai/gpt-4o-mini': { promptPer1M: 0.15, completionPer1M: 0.60, provider: 'openai' },

  // Anthropic
  'claude-3-5-sonnet': { promptPer1M: 3.00, completionPer1M: 15.00, provider: 'anthropic' },
  'claude-3-7-sonnet': { promptPer1M: 3.00, completionPer1M: 15.00, provider: 'anthropic' },
  'claude-3-haiku': { promptPer1M: 0.25, completionPer1M: 1.25, provider: 'anthropic' },
  'anthropic/claude-3-5-sonnet': { promptPer1M: 3.00, completionPer1M: 15.00, provider: 'anthropic' },
  'anthropic/claude-3-7-sonnet': { promptPer1M: 3.00, completionPer1M: 15.00, provider: 'anthropic' },
  'anthropic/claude-3-haiku': { promptPer1M: 0.25, completionPer1M: 1.25, provider: 'anthropic' },

  // Meta Llama
  'meta-llama/llama-3.3-70b-instruct': { promptPer1M: 0.35, completionPer1M: 0.40, provider: 'meta' },

  // Local / Sandbox
  'local': { promptPer1M: 0.00, completionPer1M: 0.00, provider: 'local' },
  'sandbox-model': { promptPer1M: 0.05, completionPer1M: 0.10, provider: 'local' },

  // Embedding Models (WP-5.8)
  'text-embedding-3-small': { promptPer1M: 0.02, completionPer1M: 0.00, provider: 'openai' },
  'openai/text-embedding-3-small': { promptPer1M: 0.02, completionPer1M: 0.00, provider: 'openai' },
  'text-embedding-3-large': { promptPer1M: 0.13, completionPer1M: 0.00, provider: 'openai' },
  'openai/text-embedding-3-large': { promptPer1M: 0.13, completionPer1M: 0.00, provider: 'openai' },
  'text-embedding-004': { promptPer1M: 0.00, completionPer1M: 0.00, provider: 'google' },
  'google/text-embedding-004': { promptPer1M: 0.00, completionPer1M: 0.00, provider: 'google' },
};

/**
 * Looks up price rate for a given model identifier, handling provider prefixes.
 */
export function getModelPrice(modelId: string): ModelPriceRate | null {
  if (MODEL_PRICE_TABLE[modelId]) {
    return MODEL_PRICE_TABLE[modelId];
  }

  // Check stripped prefix e.g. "openai/gpt-4o" -> "gpt-4o"
  const parts = modelId.split('/');
  if (parts.length > 1) {
    const stripped = parts.slice(1).join('/');
    if (MODEL_PRICE_TABLE[stripped]) {
      return MODEL_PRICE_TABLE[stripped];
    }
  }

  return null;
}

/**
 * Computes exact USD token cost from versioned pricing table.
 * If model is unknown, returns null with costSource 'unknown' per Zero-Fabrication rule.
 */
export function calculateTokenCost(
  modelId: string,
  promptTokens: number,
  completionTokens: number
): { costUsd: number | null; costSource: 'price_table' | 'unknown' } {
  const rate = getModelPrice(modelId);
  if (!rate) {
    logger.warn(`Model '${modelId}' not present in versioned price table ${PRICING_TABLE_VERSION}. Cost marked unknown.`);
    return { costUsd: null, costSource: 'unknown' };
  }

  const promptCost = (promptTokens / 1_000_000) * rate.promptPer1M;
  const completionCost = (completionTokens / 1_000_000) * rate.completionPer1M;
  const totalCost = Number((promptCost + completionCost).toFixed(6));

  return { costUsd: totalCost, costSource: 'price_table' };
}

/**
 * Estimates worst-case upper bound cost for pre-call budget checks.
 * Uses rate if model is known, or a conservative $0.005 baseline for unknown models.
 */
export function estimateMaxCost(
  modelId: string,
  promptTokens = 1000,
  maxCompletionTokens = 1000
): number {
  const rate = getModelPrice(modelId);
  if (!rate) {
    // Conservative baseline for budget check to prevent runaway calls
    return 0.005;
  }
  const promptCost = (promptTokens / 1_000_000) * rate.promptPer1M;
  const completionCost = (maxCompletionTokens / 1_000_000) * rate.completionPer1M;
  return Number((promptCost + completionCost).toFixed(6));
}

/**
 * Infers a standardized provider enum from model identifier.
 */
export function inferProviderFromModelId(
  modelId: string
): 'google' | 'openai' | 'anthropic' | 'deepseek' | 'local' {
  const lower = modelId.toLowerCase();
  if (lower.startsWith('deepseek') || lower.includes('deepseek')) return 'deepseek';
  if (lower.startsWith('gemini') || lower.includes('google')) return 'google';
  if (lower.startsWith('claude') || lower.includes('anthropic')) return 'anthropic';
  if (lower.startsWith('gpt') || lower.includes('openai')) return 'openai';
  return 'local';
}
