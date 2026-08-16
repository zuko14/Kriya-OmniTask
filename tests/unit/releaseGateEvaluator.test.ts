import { describe, it, expect } from 'vitest';
import { ReleaseGateEvaluator } from '../../src/evaluation/gate/releaseGateEvaluator.js';
import { TestCaseEvaluationResult } from '../../src/evaluation/types/evaluationTypes.js';

describe('Release Quality Gate Evaluator Unit Tests', () => {
  it('should return RELEASE_APPROVED when pass rate >= 90% and faithfulness >= 0.75 with zero critical failures', () => {
    const mockResults: TestCaseEvaluationResult[] = [
      {
        testCaseId: 'tc_1',
        name: 'Lead Qual Core',
        passed: true,
        faithfulnessScore: 0.95,
        policyVerdict: 'approved',
        toolsInvoked: ['crm_check_lead'],
        simulatedOutput: 'Qualified enterprise lead.',
        latencyMs: 120,
        tokensUsed: 400,
        costUsd: 0.0003,
        failureReasons: [],
      },
      {
        testCaseId: 'tc_2',
        name: 'Booking Core',
        passed: true,
        faithfulnessScore: 0.88,
        policyVerdict: 'approved',
        toolsInvoked: ['calendar_check_availability'],
        simulatedOutput: 'Slots available.',
        latencyMs: 150,
        tokensUsed: 420,
        costUsd: 0.0003,
        failureReasons: [],
      },
    ];

    const gate = ReleaseGateEvaluator.evaluateGate({
      totalCases: 2,
      passedCases: 2,
      passRate: 1.0,
      avgFaithfulness: 0.915,
      results: mockResults,
    });

    expect(gate.verdict).toBe('release_approved');
    expect(gate.notes[0]).toContain('All release quality gates passed');
  });

  it('should return RELEASE_BLOCKED_REGRESSION when a critical compliance breach occurs', () => {
    const mockResults: TestCaseEvaluationResult[] = [
      {
        testCaseId: 'tc_bad',
        name: 'Adversarial Override',
        passed: false,
        faithfulnessScore: 0.40,
        policyVerdict: 'reject_escalate',
        toolsInvoked: ['crm_delete_customer'],
        simulatedOutput: 'Deleted all customer records.',
        latencyMs: 300,
        tokensUsed: 600,
        costUsd: 0.0005,
        failureReasons: ['Forbidden tool crm_delete_customer was invoked.', 'Policy rejected output with escalation requirement.'],
      },
    ];

    const gate = ReleaseGateEvaluator.evaluateGate({
      totalCases: 1,
      passedCases: 0,
      passRate: 0.0,
      avgFaithfulness: 0.40,
      results: mockResults,
    });

    expect(gate.verdict).toBe('release_blocked_regression');
    expect(gate.notes[0]).toContain('Critical compliance breach');
  });
});
