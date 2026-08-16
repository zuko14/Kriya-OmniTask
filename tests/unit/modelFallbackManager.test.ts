import { describe, it, expect } from 'vitest';
import { ModelFallbackManager } from '../../src/model/resilience/fallback/modelFallbackManager.js';
import { ModelRegistryRecord } from '../../src/model/resilience/types/modelResilienceTypes.js';
import { RoutingPlan } from '../../src/model/resilience/router/dynamicModelRouter.js';

describe('ModelFallbackManager Unit Tests', () => {
  const primaryModel: ModelRegistryRecord = {
    id: 'mdl_primary',
    provider: 'google',
    modelIdentifier: 'gemini-2.5-pro',
    displayName: 'Google Gemini 2.5 Pro',
    status: 'active',
    contextWindowTokens: 2000000,
    inputCostPer1k: 0.001,
    outputCostPer1k: 0.002,
    capabilities: ['complex_orchestration'],
    allowedDataClassifications: ['public', 'internal', 'confidential', 'restricted'],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };

  const fallbackModel: ModelRegistryRecord = {
    id: 'mdl_fallback',
    provider: 'openai',
    modelIdentifier: 'gpt-4o',
    displayName: 'OpenAI GPT-4o',
    status: 'active',
    contextWindowTokens: 128000,
    inputCostPer1k: 0.002,
    outputCostPer1k: 0.004,
    capabilities: ['complex_orchestration'],
    allowedDataClassifications: ['public', 'internal', 'confidential', 'restricted'],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };

  const plan: RoutingPlan = {
    primaryModel,
    fallbackChain: [fallbackModel],
    rationale: 'Primary Gemini with OpenAI fallback',
  };

  it('should successfully execute primary model without invoking fallback when primary is healthy', async () => {
    const manager = new ModelFallbackManager();
    const response = await manager.executeWithResilience(plan, {
      taskId: 'task_exec_1',
      taskType: 'complex_orchestration',
      prompt: 'Synthesize quarterly revenue forecast',
    });

    expect(response.modelIdentifier).toBe('gemini-2.5-pro');
    expect(response.fallbackUsed).toBe(false);
    expect(response.totalCostUsd).toBeGreaterThan(0);
    expect(response.outputContent).toContain('Google gemini-2.5-pro');
  });

  it('should automatically failover to fallback model when primary model experiences failure', async () => {
    const manager = new ModelFallbackManager();
    const response = await manager.executeWithResilience(
      plan,
      {
        taskId: 'task_exec_2',
        taskType: 'complex_orchestration',
        prompt: 'Synthesize quarterly revenue forecast',
      },
      { mockFailures: ['gemini-2.5-pro'] }
    );

    expect(response.modelIdentifier).toBe('gpt-4o');
    expect(response.fallbackUsed).toBe(true);
    expect(response.fallbackChain).toEqual(['gemini-2.5-pro']);
    expect(response.outputContent).toContain('OpenAI gpt-4o');
  });
});
