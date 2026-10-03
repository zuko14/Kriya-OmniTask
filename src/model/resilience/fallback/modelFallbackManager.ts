/**
 * Kriya AI — Model Fallback Execution Manager
 * Multi-tier provider failover execution loop with cost and latency calculation.
 */

import {
  IModelProviderAdapter,
  GoogleProviderAdapter,
  OpenAIProviderAdapter,
  AnthropicProviderAdapter,
  DeepSeekProviderAdapter,
  LocalProviderAdapter,
} from '../adapters/modelProviderAdapter.js';
import {
  ModelExecutionRequest,
  ModelExecutionResponse,
  ModelRegistryRecord,
} from '../types/modelResilienceTypes.js';
import { RoutingPlan } from '../router/dynamicModelRouter.js';
import { logger } from '../../../core/logger/logger.js';

export class ModelFallbackManager {
  private adapters = new Map<string, IModelProviderAdapter>();

  constructor() {
    this.registerAdapter(new GoogleProviderAdapter());
    this.registerAdapter(new OpenAIProviderAdapter());
    this.registerAdapter(new AnthropicProviderAdapter());
    this.registerAdapter(new DeepSeekProviderAdapter());
    this.registerAdapter(new LocalProviderAdapter());
  }

  public registerAdapter(adapter: IModelProviderAdapter): void {
    this.adapters.set(adapter.provider, adapter);
  }

  /**
   * Executes a model request with automated fallback chain failover.
   */
  public async executeWithResilience(
    plan: RoutingPlan,
    request: ModelExecutionRequest,
    options?: { mockFailures?: string[] }
  ): Promise<ModelExecutionResponse> {
    const executionQueue: ModelRegistryRecord[] = [plan.primaryModel, ...plan.fallbackChain];
    const attemptedChain: string[] = [];
    const startTime = Date.now();

    for (let i = 0; i < executionQueue.length; i++) {
      const candidate = executionQueue[i];
      const isFallback = i > 0;
      attemptedChain.push(candidate.modelIdentifier);

      const adapter = this.adapters.get(candidate.provider);
      if (!adapter) {
        logger.warn(`No adapter registered for provider '${candidate.provider}'. Skipping candidate.`);
        continue;
      }

      const shouldMockFailure = options?.mockFailures?.includes(candidate.modelIdentifier) ?? false;

      try {
        const result = await adapter.execute(candidate.modelIdentifier, request.prompt, {
          systemInstruction: request.systemInstruction,
          temperature: request.temperature,
          maxTokens: request.maxTokens,
          mockFailure: shouldMockFailure,
        });

        // Cost in USD: provider-reported when available, otherwise the registry's list price.
        const inputCost = (result.promptTokens / 1000) * candidate.inputCostPer1k;
        const outputCost = (result.completionTokens / 1000) * candidate.outputCostPer1k;
        const totalCostUsd =
          typeof result.costUsd === 'number' ? result.costUsd : Number((inputCost + outputCost).toFixed(6));

        if (isFallback) {
          logger.warn(
            `Primary model '${plan.primaryModel.modelIdentifier}' failed. Fallback to '${candidate.modelIdentifier}' succeeded.`
          );
        }

        return {
          taskId: request.taskId,
          modelIdentifier: candidate.modelIdentifier,
          provider: candidate.provider,
          outputContent: result.outputText,
          fallbackUsed: isFallback,
          fallbackChain: isFallback ? attemptedChain.slice(0, -1) : [],
          promptTokens: result.promptTokens,
          completionTokens: result.completionTokens,
          totalCostUsd,
          latencyMs: Date.now() - startTime,
        };
      } catch (err: any) {
        logger.warn(`Execution failed on model '${candidate.modelIdentifier}' (${candidate.provider}):`, {
          error: err.message,
          attempt: i + 1,
        });

        if (i === executionQueue.length - 1) {
          throw new Error(
            `All candidate models in fallback chain failed: [${attemptedChain.join(', ')}]. Error: ${err.message}`
          );
        }
      }
    }

    throw new Error('Unexpected: Exhausted model execution queue without result.');
  }
}
