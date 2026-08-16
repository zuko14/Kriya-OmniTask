import { describe, it, expect } from 'vitest';
import { UsageMeteringEngine } from '../../src/billing/metering/usageMeteringEngine.js';
import { UsageMeterRecord } from '../../src/billing/types/billingTypes.js';

describe('UsageMeteringEngine Unit Tests', () => {
  const tenantId = 'tenant_usage_test';
  const periodStart = '2026-03-01T00:00:00.000Z';
  const periodEnd = '2026-03-31T23:59:59.000Z';

  const records: UsageMeterRecord[] = [
    {
      id: 'rec_1',
      tenantId,
      metricType: 'tokens',
      quantity: 1_250_000,
      recordedAt: '2026-03-05T10:00:00.000Z',
    },
    {
      id: 'rec_2',
      tenantId,
      metricType: 'tokens',
      quantity: 2_750_000,
      recordedAt: '2026-03-15T12:00:00.000Z',
    },
    {
      id: 'rec_3',
      tenantId,
      metricType: 'voice_minutes',
      quantity: 120.5,
      recordedAt: '2026-03-10T14:30:00.000Z',
    },
    {
      id: 'rec_4',
      tenantId,
      metricType: 'workflow_executions',
      quantity: 450,
      recordedAt: '2026-03-20T09:00:00.000Z',
    },
    {
      id: 'rec_out_of_bounds',
      tenantId,
      metricType: 'tokens',
      quantity: 5_000_000,
      recordedAt: '2026-04-05T00:00:00.000Z', // Outside March billing period
    },
  ];

  it('should aggregate usage within billing cycle boundaries and omit out-of-period records', () => {
    const summary = UsageMeteringEngine.aggregateUsage(tenantId, records, periodStart, periodEnd);

    expect(summary.tenantId).toBe(tenantId);
    expect(summary.totalTokens).toBe(4_000_000); // 1.25M + 2.75M (5M excluded)
    expect(summary.totalVoiceMinutes).toBe(120.5);
    expect(summary.totalWorkflowExecutions).toBe(450);
    expect(summary.totalApiCalls).toBe(0);
  });
});
