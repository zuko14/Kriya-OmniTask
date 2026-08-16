import { describe, it, expect } from 'vitest';
import { CostAttributionEngine } from '../../src/cost/attribution/costAttributionEngine.js';

describe('CostAttributionEngine Unit Tests', () => {
  it('should accurately calculate token costs from standard catalog rates without hallucination', () => {
    const record = CostAttributionEngine.attributeCost('tenant_1', 'org_1', {
      agentId: 'agent_sales_1',
      taskId: 'task_llm_1',
      costCategory: 'token_llm',
      provider: 'google',
      resourceMetricName: 'prompt_tokens',
      resourceQuantity: 10000,
      unitCostUsd: 0, // Fallback to catalog
    });

    expect(record.unitCostUsd).toBe(0.000075 / 1000);
    expect(record.totalCostUsd).toBe(0.00075);
    expect(record.costCategory).toBe('token_llm');
    expect(record.provider).toBe('google');
  });

  it('should accurately calculate voice telephony costs and custom unit cost overrides', () => {
    const recordVoice = CostAttributionEngine.attributeCost('tenant_1', 'org_1', {
      agentId: 'agent_voice_1',
      taskId: 'task_call_1',
      costCategory: 'voice_telephony',
      provider: 'elevenlabs',
      resourceMetricName: 'voice_minutes',
      resourceQuantity: 5.5,
      unitCostUsd: 0,
    });

    expect(recordVoice.unitCostUsd).toBe(0.15);
    expect(recordVoice.totalCostUsd).toBe(0.825);

    const recordCustom = CostAttributionEngine.attributeCost('tenant_1', 'org_1', {
      agentId: 'agent_api_1',
      taskId: 'task_api_1',
      costCategory: 'api_tool',
      provider: 'clearbit',
      resourceMetricName: 'api_calls',
      resourceQuantity: 10,
      unitCostUsd: 0.08, // Custom contract rate override
    });

    expect(recordCustom.unitCostUsd).toBe(0.08);
    expect(recordCustom.totalCostUsd).toBe(0.8);
  });
});
