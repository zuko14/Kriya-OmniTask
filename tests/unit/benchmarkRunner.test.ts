import { describe, it, expect } from 'vitest';
import { BenchmarkRunner, BenchmarkCandidate, modelCandidate } from '../../src/evaluation/benchmark/benchmarkRunner.js';
import { GoldenTestCase } from '../../src/evaluation/types/evaluationTypes.js';
import { ModelRouter } from '../../src/orchestration/routing/modelRouter.js';
import { OpenRouterAdapter } from '../../src/model/gateway/openRouterAdapter.js';

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
    referenceEvidence: ['Opened items may be returned within 30 days in original packaging.'],
    expectedTools: ['kb_search_articles'],
    groundTruthOutput: 'Opened items may be returned within 30 days in original packaging.',
    minFaithfulness: 0.70,
    maxAllowedLatencyMs: 2500,
  },
];

describe('Golden Test Suite Benchmark Runner', () => {
  it('grader passes a candidate that answers faithfully and uses the expected tools', async () => {
    // Grader test only: this candidate is an oracle, so the score says nothing about any real model.
    const oracle: BenchmarkCandidate = async (tc) => ({
      output: tc.groundTruthOutput!,
      toolsInvoked: tc.expectedTools ?? [],
      promptTokens: 100,
      completionTokens: 40,
      costUsd: 0.00001,
    });
    const report = await BenchmarkRunner.executeBenchmark({ testCases, modelId: 'gemini-2.5-flash', candidate: oracle });

    expect(report.passedTestCases).toBe(2);
    expect(report.verdict).toBe('release_approved');
    expect(report.results[0].candidateOutput).toBe(testCases[0].groundTruthOutput);
    expect(report.executionMode).toBe('live');
  });

  it('fails an unfaithful answer and a missing expected tool (the old runner passed everything)', async () => {
    const wrong: BenchmarkCandidate = async () => ({
      output: 'Enterprise is a flat 499 dollars per seat and comes with free hardware.',
      toolsInvoked: [],
      promptTokens: 100,
      completionTokens: 40,
      costUsd: 0.00001,
    });
    const report = await BenchmarkRunner.executeBenchmark({ testCases: [testCases[0]], modelId: 'x', candidate: wrong });

    expect(report.passedTestCases).toBe(0);
    const reasons = report.results[0].failureReasons.join(' | ');
    expect(reasons).toContain("Expected tool 'crm_check_lead' was not invoked");
    expect(reasons).toContain('Faithfulness');
    expect(report.verdict).not.toBe('release_approved');
  });

  it('a candidate that throws is a failed case, not a skipped one', async () => {
    const broken: BenchmarkCandidate = async () => {
      throw new Error('provider down');
    };
    const report = await BenchmarkRunner.executeBenchmark({ testCases: [testCases[1]], modelId: 'x', candidate: broken });
    expect(report.passedTestCases).toBe(0);
    expect(report.results[0].failureReasons[0]).toContain('provider down');
  });

  it('labels default runs in sandbox mode so they are never mistaken for real quality evidence', async () => {
    const report = await BenchmarkRunner.executeBenchmark({ testCases, modelId: 'gemini-2.5-flash' });
    expect(report.executionMode).toBe('sandbox');
    expect(report.releaseGateNotes.join(' ')).toContain('SANDBOX');
  });
});

const liveKey = process.env.KRIYA_LIVE_TEST_OPENROUTER_KEY;
describe.skipIf(!liveKey)('Benchmark against a real model (OpenRouter)', () => {
  it('runs the golden cases through the real model and grades its actual answers', async () => {
    const model = process.env.KRIYA_LIVE_TEST_MODEL || 'deepseek/deepseek-v4-flash';
    const router = new ModelRouter(new OpenRouterAdapter({ apiKey: liveKey! }));
    const report = await BenchmarkRunner.executeBenchmark({
      testCases: testCases.map((tc) => ({ ...tc, maxAllowedLatencyMs: 30_000 })),
      modelId: model,
      candidate: modelCandidate(model, router),
    });

    expect(report.executionMode).toBe('live');
    for (const r of report.results) {
      expect(r.candidateOutput.length).toBeGreaterThan(0);
      expect(r.tokensUsed).toBeGreaterThan(0);
    }
    // Real result is recorded, not asserted to pass: the point is an honest measurement.
    console.log('[live benchmark]', JSON.stringify({ passRate: report.passRate, avgFaithfulness: report.avgFaithfulness, costUsd: report.totalCostUsd }));
  }, 120_000);
});
