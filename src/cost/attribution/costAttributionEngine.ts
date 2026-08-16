/**
 * Xylarc AI — Cost Attribution Engine
 * Ground-truth cost calculation for LLM tokens, voice minutes, API tools, and compute units.
 */

import {
  CostCategory,
  CostProvider,
  RecordCostRequest,
  CostAttributionRecord,
} from '../types/costTypes.js';
import { CryptoUtils } from '../../core/utils/crypto.js';

export interface StandardRateCatalogEntry {
  category: CostCategory;
  provider: CostProvider;
  metric: string;
  unitCostUsd: number;
}

export class CostAttributionEngine {
  private static readonly RATE_CATALOG: StandardRateCatalogEntry[] = [
    // LLM Models
    { category: 'token_llm', provider: 'google', metric: 'prompt_tokens', unitCostUsd: 0.000075 / 1000 },
    { category: 'token_llm', provider: 'google', metric: 'completion_tokens', unitCostUsd: 0.0003 / 1000 },
    { category: 'token_llm', provider: 'openai', metric: 'prompt_tokens', unitCostUsd: 0.0025 / 1000 },
    { category: 'token_llm', provider: 'openai', metric: 'completion_tokens', unitCostUsd: 0.01 / 1000 },
    { category: 'token_llm', provider: 'anthropic', metric: 'prompt_tokens', unitCostUsd: 0.003 / 1000 },
    { category: 'token_llm', provider: 'anthropic', metric: 'completion_tokens', unitCostUsd: 0.015 / 1000 },
    { category: 'token_llm', provider: 'deepseek', metric: 'prompt_tokens', unitCostUsd: 0.00055 / 1000 },
    { category: 'token_llm', provider: 'deepseek', metric: 'completion_tokens', unitCostUsd: 0.00219 / 1000 },
    { category: 'token_llm', provider: 'local', metric: 'prompt_tokens', unitCostUsd: 0.000001 / 1000 },
    { category: 'token_llm', provider: 'local', metric: 'completion_tokens', unitCostUsd: 0.000001 / 1000 },

    // Voice & Audio
    { category: 'voice_telephony', provider: 'twilio', metric: 'voice_minutes', unitCostUsd: 0.014 },
    { category: 'voice_telephony', provider: 'elevenlabs', metric: 'voice_minutes', unitCostUsd: 0.15 },
    { category: 'voice_telephony', provider: 'livekit', metric: 'voice_minutes', unitCostUsd: 0.004 },

    // Third-party API Integrations
    { category: 'api_tool', provider: 'clearbit', metric: 'api_calls', unitCostUsd: 0.05 },
    { category: 'api_tool', provider: 'stripe', metric: 'api_calls', unitCostUsd: 0.01 },
    { category: 'api_tool', provider: 'custom_api', metric: 'api_calls', unitCostUsd: 0.005 },

    // Vector Search & Sandbox
    { category: 'vector_search', provider: 'google', metric: 'embedding_tokens', unitCostUsd: 0.000025 / 1000 },
    { category: 'compute_sandbox', provider: 'local', metric: 'execution_seconds', unitCostUsd: 0.0001 },
  ];

  /**
   * Resolves standard unit cost from catalog if not explicitly overridden.
   */
  public static resolveUnitCost(
    category: CostCategory,
    provider: CostProvider,
    metric: string,
    providedUnitCost?: number
  ): number {
    if (providedUnitCost !== undefined && providedUnitCost > 0) {
      return providedUnitCost;
    }

    const match = this.RATE_CATALOG.find(
      (entry) =>
        entry.category === category &&
        entry.provider === provider &&
        entry.metric.toLowerCase() === metric.toLowerCase()
    );

    return match ? match.unitCostUsd : 0.00001; // Default fallback micro-cost
  }

  /**
   * Creates a verified, attributed cost record with exact ground-truth calculation.
   */
  public static attributeCost(
    tenantId: string,
    organizationId: string,
    request: RecordCostRequest
  ): CostAttributionRecord {
    const unitCost = this.resolveUnitCost(
      request.costCategory,
      request.provider,
      request.resourceMetricName,
      request.unitCostUsd
    );

    const totalCost = Number((request.resourceQuantity * unitCost).toFixed(6));
    const now = new Date().toISOString();

    return {
      id: `cst_${CryptoUtils.generateId()}`,
      tenantId,
      organizationId,
      agentId: request.agentId,
      workflowExecutionId: request.workflowExecutionId,
      taskId: request.taskId,
      costCategory: request.costCategory,
      provider: request.provider,
      resourceMetricName: request.resourceMetricName,
      resourceQuantity: request.resourceQuantity,
      unitCostUsd: unitCost,
      totalCostUsd: totalCost,
      outcomeId: request.outcomeId,
      createdAt: now,
    };
  }
}
