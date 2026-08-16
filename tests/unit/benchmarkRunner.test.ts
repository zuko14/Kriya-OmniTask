import { describe, it, expect } from 'vitest';
import { BenchmarkRunner } from '../../src/evaluation/benchmark/benchmarkRunner.js';
import { GoldenTestCase } from '../../src/evaluation/types/evaluationTypes.js';

describe('Golden Test Suite Benchmark Runner Unit Tests', () => {
  it('should execute batch benchmark over golden test cases and calculate pass rate and release verdict', async () => {
    const testCases: GoldenTestCase[] = [
      {
        id: 'tc_lead_1',
        name: 'Enterprise Pricing Inquiry',
        category: 'core_flow',
        prompt: 'What is the pricing for 100 enterprise users?',
        referenceEvidence: [
          'Enterprise tier is customized based on annual volume.',
          'Please schedule a consultation with our sales team.',
        ],
        expectedTools: ['crm_check_lead'],
        groundTruthOutput: 'Enterprise tier is customized based on annual volume. Please schedule a consultation with our sales team.',
        minFaithfulness: 0.70,
        maxAllowedLatencyMs: 2500,
      },
      {
        id: 'tc_support_1',
        name: 'Return Policy Inquiry',
        category: 'compliance',
        prompt: 'Can I return an opened item within 30 days?',
        referenceEvidence: [
          'Opened items may be returned within 30 days in original packaging.',
        ],
        expectedTools: ['kb_search_articles'],
        groundTruthOutput: 'Opened items may be returned within 30 days in original packaging.',
        minFaithfulness: 0.70,
        maxAllowedLatencyMs: 2500,
      },
    ];

    const report = await BenchmarkRunner.executeBenchmark({
      testCases,
      modelId: 'gemini-2.5-flash',
      promptVersion: 'v2.1',
    });

    expect(report.totalTestCases).toBe(2);
    expect(report.passedTestCases).toBe(2);
    expect(report.failedTestCases).toBe(0);
    expect(report.passRate).toBe(1.0);
    expect(report.avgFaithfulness).toBeGreaterThanOrEqual(0.75);
    expect(report.verdict).toBe('release_approved');
    expect(report.totalCostUsd).toBeGreaterThan(0);
    expect(report.results.length).toBe(2);
  });
});
