import { describe, it, expect } from 'vitest';
import { DynamicModelRouter } from '../../src/model/resilience/router/dynamicModelRouter.js';
import { ModelRegistryRecord, TenantModelPolicy } from '../../src/model/resilience/types/modelResilienceTypes.js';

describe('DynamicModelRouter Unit Tests', () => {
  const sampleModels: ModelRegistryRecord[] = [
    {
      id: 'mdl_flash',
      provider: 'google',
      modelIdentifier: 'gemini-2.5-flash',
      displayName: 'Gemini 2.5 Flash',
      status: 'active',
      contextWindowTokens: 1000000,
      inputCostPer1k: 0.000075,
      outputCostPer1k: 0.0003,
      capabilities: ['fast_classification', 'standard_reasoning'],
      allowedDataClassifications: ['public', 'internal', 'confidential', 'restricted'],
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 'mdl_pro',
      provider: 'google',
      modelIdentifier: 'gemini-2.5-pro',
      displayName: 'Gemini 2.5 Pro',
      status: 'active',
      contextWindowTokens: 2000000,
      inputCostPer1k: 0.00125,
      outputCostPer1k: 0.005,
      capabilities: ['complex_orchestration', 'reasoning_chain'],
      allowedDataClassifications: ['public', 'internal', 'confidential', 'restricted'],
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 'mdl_openai',
      provider: 'openai',
      modelIdentifier: 'gpt-4o',
      displayName: 'GPT-4o',
      status: 'active',
      contextWindowTokens: 128000,
      inputCostPer1k: 0.0025,
      outputCostPer1k: 0.01,
      capabilities: ['complex_orchestration', 'code_generation'],
      allowedDataClassifications: ['public', 'internal', 'confidential'],
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 'mdl_local',
      provider: 'local',
      modelIdentifier: 'llama-3.3-70b-local',
      displayName: 'Llama 3.3 70B Local',
      status: 'active',
      contextWindowTokens: 128000,
      inputCostPer1k: 0.00001,
      outputCostPer1k: 0.00001,
      capabilities: ['fast_classification', 'standard_reasoning', 'complex_orchestration'],
      allowedDataClassifications: ['public', 'internal', 'confidential', 'restricted'],
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
  ];

  it('should route fast classification tasks to cost-effective models with matching capabilities', () => {
    const plan = DynamicModelRouter.formulateRoutingPlan(sampleModels, null, {
      taskId: 'task_1',
      taskType: 'fast_classification',
      prompt: 'Classify this intent',
    });

    expect(plan.primaryModel.modelIdentifier).toBe('llama-3.3-70b-local'); // Lowest cost with matching capability
    expect(plan.fallbackChain.length).toBeGreaterThanOrEqual(1);
  });

  it('should exclude tenant-disallowed providers and enforce local execution for confidential data when required', () => {
    const policy: TenantModelPolicy = {
      id: 'pol_1',
      tenantId: 'tenant_1',
      organizationId: 'default',
      defaultPrimaryModelId: 'mdl_pro',
      defaultFallbackModelId: 'mdl_flash',
      disallowedProviders: ['openai'],
      maxCostPerQueryUsd: 1.0,
      requireLocalForConfidential: true,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };

    // Confidential request -> must route exclusively to local provider
    const plan = DynamicModelRouter.formulateRoutingPlan(sampleModels, policy, {
      taskId: 'task_sec_1',
      taskType: 'complex_orchestration',
      prompt: 'Confidential corporate reorganization plan',
      dataClassification: 'confidential',
    });

    expect(plan.primaryModel.provider).toBe('local');
    expect(plan.fallbackChain.every((m) => m.provider === 'local')).toBe(true);
  });
});
