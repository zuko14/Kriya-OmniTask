import { describe, it, expect } from 'vitest';
import { BehavioralComparator } from '../../src/simulation/comparator/behavioralComparator.js';
import { ExpectedOutcomes, SimulatedToolCall } from '../../src/simulation/types/simulationTypes.js';

describe('Behavioral Comparator & Simulation Regression Evaluator Unit Tests', () => {
  it('should return PASSED when all expected tools, keywords, and budgets match', () => {
    const mockToolCalls: SimulatedToolCall[] = [
      {
        toolName: 'calendar_check_availability',
        inputParameters: { preferredDate: '2026-08-16' },
        mockResponse: { slots: ['10:00 AM', '2:00 PM'] },
        timestamp: new Date().toISOString(),
      },
    ];

    const expectedOutcomes: ExpectedOutcomes = {
      expectedToolsCalled: ['calendar_check_availability'],
      forbiddenTools: ['crm_delete_customer', 'payments_charge_card'],
      expectedKeywords: ['available', 'slots'],
      prohibitedKeywords: ['guarantee 100%', 'free forever'],
      expectedPolicyVerdict: 'approved',
      maxAllowedLatencyMs: 2000,
      maxAllowedCostUsd: 0.05,
    };

    const report = BehavioralComparator.evaluateRun({
      simulatedOutput: 'We have available slots tomorrow at 10:00 AM and 2:00 PM EST.',
      toolCalls: mockToolCalls,
      policyVerdict: 'approved',
      expectedOutcomes,
      latencyMs: 320,
      tokensUsed: 600,
      costUsd: 0.0004,
    });

    expect(report.overallResult).toBe('passed');
    expect(report.checksPassed).toBeGreaterThanOrEqual(7);
    expect(report.checksFailed).toBe(0);
    expect(report.toolSequenceMatch).toBe(true);
    expect(report.policyComplianceMatch).toBe(true);
  });

  it('should detect REGRESSION when forbidden tools or prohibited keywords are triggered', () => {
    const mockToolCalls: SimulatedToolCall[] = [
      {
        toolName: 'crm_delete_customer', // Forbidden!
        inputParameters: { customerId: 'cust_1' },
        mockResponse: { success: true },
        timestamp: new Date().toISOString(),
      },
    ];

    const expectedOutcomes: ExpectedOutcomes = {
      forbiddenTools: ['crm_delete_customer'],
      prohibitedKeywords: ['unconditional refund'],
      maxAllowedLatencyMs: 1000,
    };

    const report = BehavioralComparator.evaluateRun({
      simulatedOutput: 'We will process your unconditional refund immediately.',
      toolCalls: mockToolCalls,
      policyVerdict: 'approved',
      expectedOutcomes,
      latencyMs: 1500, // Budget exceeded!
      tokensUsed: 800,
      costUsd: 0.0006,
    });

    expect(report.overallResult).toBe('regression_detected');
    expect(report.checksFailed).toBeGreaterThanOrEqual(3);
    expect(report.failureDetails.some((d) => d.includes('Forbidden tool'))).toBe(true);
    expect(report.failureDetails.some((d) => d.includes('Prohibited keyword'))).toBe(true);
    expect(report.failureDetails.some((d) => d.includes('Latency budget'))).toBe(true);
  });
});
