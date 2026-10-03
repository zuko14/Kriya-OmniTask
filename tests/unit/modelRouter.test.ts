/**
 * Kriya AI — Model Router & Cost Intelligence Unit Tests
 * Verifies model routing, token cost calculations, and automatic fallback failover (§24 of CLAUDE.md).
 */

import { describe, it, expect } from 'vitest';
import { ModelRouter, LLMProviderAdapter } from '../../src/orchestration/routing/modelRouter.js';

class MockFailingPrimaryAdapter implements LLMProviderAdapter {
  public async execute(
    model: string,
    systemPrompt: string,
    userPrompt: string
  ): Promise<{ content: string; promptTokens: number; completionTokens: number }> {
    if (model === 'gemini-2.5-pro') {
      throw new Error('503 Service Unavailable: Provider Rate Limit Exceeded');
    }

    return {
      content: JSON.stringify({
        taskId: 'fallback-task',
        status: 'completed',
        facts: ['Generated via fallback model'],
        evidence: [{ source: 'fallback_adapter' }],
        confidence: 0.92,
        recommendedAction: 'Execute next step',
        risks: [],
        policyFlags: [],
        requiresApproval: false,
        details: {},
      }),
      promptTokens: 100,
      completionTokens: 50,
    };
  }
}

describe('Model Router & Cost Intelligence Tests', () => {
  it('should calculate accurate USD costs per token rates', () => {
    const router = new ModelRouter();
    // 1,000,000 prompt tokens + 1,000,000 completion tokens on gemini-2.5-flash ($0.15 + $0.60 = $0.75)
    const costFlash = router.calculateCost('gemini-2.5-flash', 1_000_000, 1_000_000);
    expect(costFlash).toBe(0.75);

    // 100,000 prompt tokens + 50,000 completion tokens on gemini-2.5-pro
    // (0.1 * 1.25) + (0.05 * 5.00) = 0.125 + 0.25 = 0.375
    const costPro = router.calculateCost('gemini-2.5-pro', 100_000, 50_000);
    expect(costPro).toBe(0.375);
  });

  it('should route request and return complete token usage and cost metrics', async () => {
    const router = new ModelRouter();
    const result = await router.complete({
      systemPrompt: 'You are a test agent.',
      userPrompt: 'Hello, what is your status?',
      policy: {
        primaryModel: 'gemini-2.5-flash',
        fallbackModel: 'gemini-2.5-pro',
        temperature: 0.1,
        maxTokens: 1024,
      },
    });

    expect(result.modelUsed).toBe('gemini-2.5-flash');
    expect(result.isFallback).toBe(false);
    expect(result.promptTokens).toBeGreaterThan(0);
    expect(result.completionTokens).toBeGreaterThan(0);
    expect(result.estimatedCostUsd).toBeGreaterThan(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('should automatically failover to fallback model when primary model fails', async () => {
    const router = new ModelRouter(new MockFailingPrimaryAdapter());

    const result = await router.complete({
      systemPrompt: 'System instruction.',
      userPrompt: 'Test message for fallback.',
      policy: {
        primaryModel: 'gemini-2.5-pro', // Will throw
        fallbackModel: 'gemini-2.5-flash', // Will succeed
      },
    });

    expect(result.modelUsed).toBe('gemini-2.5-flash');
    expect(result.isFallback).toBe(true);
    expect(result.content).toContain('Generated via fallback model');
  });
});
