import { describe, it, expect } from 'vitest';
import { OutcomeUnitEconomicsEngine } from '../../src/cost/outcomes/outcomeUnitEconomicsEngine.js';
import { CostAttributionRecord, BusinessOutcomeRecord } from '../../src/cost/types/costTypes.js';

describe('OutcomeUnitEconomicsEngine Unit Tests', () => {
  it('should aggregate linked task costs and compute ground-truth outcome ROI', () => {
    const linkedCosts: CostAttributionRecord[] = [
      {
        id: 'cst_1',
        tenantId: 'tenant_1',
        organizationId: 'org_1',
        agentId: 'agent_sdr_1',
        taskId: 'task_enrich',
        costCategory: 'api_tool',
        provider: 'clearbit',
        resourceMetricName: 'api_calls',
        resourceQuantity: 1,
        unitCostUsd: 0.05,
        totalCostUsd: 0.05,
        createdAt: '2026-01-01T00:00:00Z',
      },
      {
        id: 'cst_2',
        tenantId: 'tenant_1',
        organizationId: 'org_1',
        agentId: 'agent_sdr_1',
        taskId: 'task_call',
        costCategory: 'voice_telephony',
        provider: 'elevenlabs',
        resourceMetricName: 'voice_minutes',
        resourceQuantity: 2.0,
        unitCostUsd: 0.15,
        totalCostUsd: 0.30,
        createdAt: '2026-01-01T00:00:00Z',
      },
    ];

    const outcome = OutcomeUnitEconomicsEngine.calculateOutcome(
      'tenant_1',
      'org_1',
      {
        agentId: 'agent_sdr_1',
        outcomeType: 'lead_qualified',
        outcomeStatus: 'achieved',
        valueGeneratedUsd: 50.0,
        taskIds: ['task_enrich', 'task_call'],
        metadata: { leadCompany: 'Acme Corp' },
      },
      linkedCosts
    );

    expect(outcome.totalCostUsd).toBe(0.35);
    expect(outcome.valueGeneratedUsd).toBe(50.0);
    // ROI = (50 - 0.35) / 0.35 = 141.86
    expect(outcome.roiMultiplier).toBe(141.86);
  });

  it('should aggregate unit economics across multiple outcome events', () => {
    const outcomes: BusinessOutcomeRecord[] = [
      {
        id: 'out_1',
        tenantId: 'tenant_1',
        organizationId: 'org_1',
        agentId: 'agent_1',
        outcomeType: 'lead_qualified',
        outcomeStatus: 'achieved',
        valueGeneratedUsd: 100.0,
        totalCostUsd: 0.5,
        roiMultiplier: 199.0,
        outcomeMetadata: {},
        createdAt: '2026-01-01T00:00:00Z',
      },
      {
        id: 'out_2',
        tenantId: 'tenant_1',
        organizationId: 'org_1',
        agentId: 'agent_1',
        outcomeType: 'lead_qualified',
        outcomeStatus: 'failed',
        valueGeneratedUsd: 0.0,
        totalCostUsd: 0.3,
        roiMultiplier: -1.0,
        outcomeMetadata: {},
        createdAt: '2026-01-01T00:00:00Z',
      },
    ];

    const summaries = OutcomeUnitEconomicsEngine.aggregateUnitEconomics(outcomes);
    const leadSummary = summaries.lead_qualified;

    expect(leadSummary).toBeDefined();
    expect(leadSummary.totalCount).toBe(2);
    expect(leadSummary.achievedCount).toBe(1);
    expect(leadSummary.successRatePct).toBe(50.0);
    expect(leadSummary.totalCostUsd).toBe(0.8);
    expect(leadSummary.avgCostPerOutcomeUsd).toBe(0.4);
    expect(leadSummary.totalValueGeneratedUsd).toBe(100.0);
  });
});
