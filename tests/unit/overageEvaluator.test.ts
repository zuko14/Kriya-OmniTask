import { describe, it, expect } from 'vitest';
import { OverageEvaluator } from '../../src/billing/overage/overageEvaluator.js';
import { BillingPlan, UsageSummary } from '../../src/billing/types/billingTypes.js';

describe('OverageEvaluator Unit Tests', () => {
  const plan: BillingPlan = {
    id: 'plan_growth_test',
    name: 'Growth Plan',
    planTier: 'growth',
    channelPlan: 'combined',
    basePriceCents: 79900,
    currency: 'USD',
    billingInterval: 'month',
    includedTokens: 25_000_000,
    includedVoiceMinutes: 500,
    includedWorkflowExecutions: 2_500,
    includedAgents: 10,
    tokenOverageRateCentsPerK: 0.3, // $0.003 / 1k ($3 / 1M)
    voiceMinuteOverageRateCents: 10.0, // $0.10 / min
    workflowOverageRateCents: 5.0, // $0.05 / run
    isActive: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };

  it('should evaluate zero overage when usage is within included quota allowances', () => {
    const usage: UsageSummary = {
      tenantId: 'tenant_sub_test',
      periodStart: '2026-03-01T00:00:00Z',
      periodEnd: '2026-03-31T23:59:59Z',
      totalTokens: 20_000_000,
      totalVoiceMinutes: 400,
      totalWorkflowExecutions: 2_000,
      totalAgentSeatHours: 100,
      totalApiCalls: 500,
      totalVectorStorageMb: 50,
    };

    const res = OverageEvaluator.calculateOverages(usage, plan);
    expect(res.hasOverage).toBe(false);
    expect(res.totalOverageAmountCents).toBe(0);
    expect(res.items.length).toBe(0);
  });

  it('should accurately calculate delta overages and monetized amounts when limits are exceeded', () => {
    const usage: UsageSummary = {
      tenantId: 'tenant_sub_test',
      periodStart: '2026-03-01T00:00:00Z',
      periodEnd: '2026-03-31T23:59:59Z',
      totalTokens: 30_000_000, // 5M overage -> 5,000 * 0.3 = 1,500 cents ($15.00)
      totalVoiceMinutes: 600, // 100 mins overage -> 100 * 10 = 1,000 cents ($10.00)
      totalWorkflowExecutions: 3_000, // 500 runs overage -> 500 * 5 = 2,500 cents ($25.00)
      totalAgentSeatHours: 100,
      totalApiCalls: 500,
      totalVectorStorageMb: 50,
    };

    const res = OverageEvaluator.calculateOverages(usage, plan);
    expect(res.hasOverage).toBe(true);
    expect(res.items.length).toBe(3);

    const tokenItem = res.items.find((i) => i.metricType === 'tokens')!;
    expect(tokenItem.overageQuantity).toBe(5_000_000);
    expect(tokenItem.overageAmountCents).toBe(1500);

    const voiceItem = res.items.find((i) => i.metricType === 'voice_minutes')!;
    expect(voiceItem.overageQuantity).toBe(100);
    expect(voiceItem.overageAmountCents).toBe(1000);

    const wfItem = res.items.find((i) => i.metricType === 'workflow_executions')!;
    expect(wfItem.overageQuantity).toBe(500);
    expect(wfItem.overageAmountCents).toBe(2500);

    expect(res.totalOverageAmountCents).toBe(5000); // $50.00 total overage
  });
});
