/**
 * Kriya Omnitask — Golden Test Suite Benchmark Runner
 * Executes batch evaluation across curated golden test datasets (§14, §18 of CLAUDE.md).
 *
 * A CANDIDATE produces each answer (by default: the real model via ModelRouter, given only the
 * reference evidence). The grader then judges that actual answer. The runner never grades the
 * answer key against itself and never measures fabricated latency/tokens (docs/kriya S19).
 */

import {
  GoldenTestCase,
  TestCaseEvaluationResult,
  BenchmarkSummaryReport,
} from '../types/evaluationTypes.js';
import { QualityReviewer } from '../../verification/reviewer/qualityReviewer.js';
import { ReleaseGateEvaluator } from '../gate/releaseGateEvaluator.js';
import { ModelRouter } from '../../orchestration/routing/modelRouter.js';
import { isSandboxMode } from '../../core/config/runtimeMode.js';

export interface CandidateResponse {
  output: string;
  /** Tools the candidate actually invoked; null = candidate is not tool-instrumented. */
  toolsInvoked: string[] | null;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
}

export type BenchmarkCandidate = (testCase: GoldenTestCase) => Promise<CandidateResponse>;

const EVIDENCE_ONLY_SYSTEM_PROMPT =
  'You are a business assistant. Answer the customer using ONLY the facts in the provided context. ' +
  'If the context does not contain the answer, say you cannot verify it and offer to connect a human. ' +
  'Reply in plain text, concisely.';

/** Default candidate: the real model (through ModelRouter) answering from the reference evidence. */
export function modelCandidate(modelId: string, router: ModelRouter = new ModelRouter()): BenchmarkCandidate {
  return async (testCase) => {
    const res = await router.complete({
      systemPrompt: EVIDENCE_ONLY_SYSTEM_PROMPT,
      userPrompt: testCase.prompt,
      contextData: { evidence: testCase.referenceEvidence },
      policy: { primaryModel: modelId, fallbackModel: modelId, temperature: 0 },
    });
    return {
      output: res.content,
      toolsInvoked: null,
      promptTokens: res.promptTokens,
      completionTokens: res.completionTokens,
      costUsd: res.estimatedCostUsd,
    };
  };
}

export class BenchmarkRunner {
  /**
   * Executes a batch evaluation against a list of golden test cases.
   */
  public static async executeBenchmark(params: {
    testCases: GoldenTestCase[];
    modelId: string;
    promptVersion?: string;
    candidate?: BenchmarkCandidate;
  }): Promise<BenchmarkSummaryReport> {
    const { testCases, modelId } = params;
    const candidate = params.candidate ?? modelCandidate(modelId);
    const results: TestCaseEvaluationResult[] = [];

    let totalLatencyMs = 0;
    let totalFaithfulness = 0;
    let totalCostUsd = 0;
    let passedCount = 0;

    for (const testCase of testCases) {
      const failureReasons: string[] = [];
      const startTime = Date.now();

      // 1. Run the candidate for real. An execution error is a failed case, not a skipped one.
      let response: CandidateResponse;
      try {
        response = await candidate(testCase);
      } catch (err) {
        response = { output: '', toolsInvoked: null, promptTokens: 0, completionTokens: 0, costUsd: 0 };
        failureReasons.push(`Candidate execution failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      const latencyMs = Date.now() - startTime;

      // 2. Tool expectations — only judged when the candidate reports its tool calls.
      const toolsInvoked = response.toolsInvoked ?? [];
      if (response.toolsInvoked !== null) {
        for (const expected of testCase.expectedTools ?? []) {
          if (!toolsInvoked.includes(expected)) failureReasons.push(`Expected tool '${expected}' was not invoked.`);
        }
        for (const forbidden of testCase.forbiddenTools ?? []) {
          if (toolsInvoked.includes(forbidden)) failureReasons.push(`Forbidden tool '${forbidden}' was invoked.`);
        }
      }

      // 3. Faithfulness against REFERENCE evidence (never against the output itself).
      const evidence = testCase.referenceEvidence.length > 0
        ? testCase.referenceEvidence
        : testCase.groundTruthOutput ? [testCase.groundTruthOutput] : [];

      let faithfulnessScore = 0;
      let policyVerdict: TestCaseEvaluationResult['policyVerdict'] = 'reject_escalate';
      if (evidence.length === 0) {
        failureReasons.push('Test case has no reference evidence or ground truth; faithfulness cannot be judged.');
      } else if (response.output) {
        const qualityReview = QualityReviewer.evaluate({
          correlationId: `bench_${testCase.id}`,
          agentId: 'benchmark_candidate',
          targetContent: response.output,
          retrievedEvidence: evidence,
          strictMode: false,
        });
        faithfulnessScore = qualityReview.faithfulnessScore;
        policyVerdict = qualityReview.verdict;

        const minFaith = testCase.minFaithfulness ?? 0.70;
        if (faithfulnessScore < minFaith) {
          failureReasons.push(
            `Faithfulness score (${faithfulnessScore.toFixed(2)}) below required threshold (${minFaith.toFixed(2)}).`
          );
        }
        if (policyVerdict === 'reject_escalate') {
          failureReasons.push('Policy rejected output with escalation requirement.');
        }
      }

      const maxLatency = testCase.maxAllowedLatencyMs ?? 3000;
      if (latencyMs > maxLatency) {
        failureReasons.push(`Latency (${latencyMs}ms) exceeded maximum allowed (${maxLatency}ms).`);
      }

      const passed = failureReasons.length === 0;
      if (passed) passedCount++;

      totalLatencyMs += latencyMs;
      totalFaithfulness += faithfulnessScore;
      totalCostUsd += response.costUsd;

      results.push({
        testCaseId: testCase.id,
        name: testCase.name,
        passed,
        faithfulnessScore,
        policyVerdict,
        toolsInvoked,
        candidateOutput: response.output,
        latencyMs,
        tokensUsed: response.promptTokens + response.completionTokens,
        costUsd: response.costUsd,
        failureReasons,
      });
    }

    const totalTestCases = testCases.length;
    const failedTestCases = totalTestCases - passedCount;
    const passRate = totalTestCases > 0 ? passedCount / totalTestCases : 0.0;
    const avgFaithfulness = totalTestCases > 0 ? totalFaithfulness / totalTestCases : 0.0;
    const avgLatencyMs = totalTestCases > 0 ? Math.round(totalLatencyMs / totalTestCases) : 0;

    const gateResult = ReleaseGateEvaluator.evaluateGate({
      totalCases: totalTestCases,
      passedCases: passedCount,
      passRate,
      avgFaithfulness,
      results,
    });

    const executionMode: BenchmarkSummaryReport['executionMode'] = isSandboxMode() && !params.candidate ? 'sandbox' : 'live';
    const notes = [...gateResult.notes];
    if (executionMode === 'sandbox') {
      notes.push('SANDBOX: candidate answers came from the simulated model adapter; this report is not evidence of real model quality.');
    }

    return {
      totalTestCases,
      passedTestCases: passedCount,
      failedTestCases,
      passRate: Number(passRate.toFixed(4)),
      avgFaithfulness: Number(avgFaithfulness.toFixed(4)),
      avgLatencyMs,
      totalCostUsd: Number(totalCostUsd.toFixed(6)),
      verdict: gateResult.verdict,
      releaseGateNotes: notes,
      executionMode,
      results,
    };
  }
}
