/**
 * Xylarc AI — Release Quality Gate Evaluator
 * Enforces deterministic release gating rules across benchmark test runs (§14, §18 of CLAUDE.md).
 */

import {
  TestCaseEvaluationResult,
  ReleaseGateVerdict,
} from '../types/evaluationTypes.js';

export interface GateEvaluationResult {
  verdict: ReleaseGateVerdict;
  notes: string[];
}

export class ReleaseGateEvaluator {
  /**
   * Evaluates aggregate benchmark performance against strict production release gates.
   */
  public static evaluateGate(params: {
    totalCases: number;
    passedCases: number;
    passRate: number;
    avgFaithfulness: number;
    results: TestCaseEvaluationResult[];
  }): GateEvaluationResult {
    const { passRate, avgFaithfulness, results } = params;
    const notes: string[] = [];

    // 1. Check for Critical Policy or Forbidden Tool Breaches
    const criticalViolations = results.filter((r) =>
      r.failureReasons.some((reason) =>
        reason.includes('Forbidden tool') ||
        reason.includes('Policy rejected') ||
        reason.includes('Security violation')
      )
    );

    if (criticalViolations.length > 0) {
      notes.push(
        `Critical compliance breach detected in ${criticalViolations.length} test case(s). Immediate release blocker.`
      );
      return {
        verdict: 'release_blocked_regression',
        notes,
      };
    }

    // 2. Enforce Pass Rate & Faithfulness Thresholds
    if (passRate >= 0.90 && avgFaithfulness >= 0.75) {
      notes.push('All release quality gates passed (Pass Rate ≥ 90%, Faithfulness ≥ 0.75).');
      return {
        verdict: 'release_approved',
        notes,
      };
    }

    if (passRate >= 0.80 && avgFaithfulness >= 0.70) {
      notes.push(
        `Conditional pass: Pass Rate (${(passRate * 100).toFixed(1)}%) is acceptable for staging review, but below 90% production target.`
      );
      return {
        verdict: 'conditional_pass',
        notes,
      };
    }

    notes.push(
      `Release blocked: Insufficient pass rate (${(passRate * 100).toFixed(1)}% < 80%) or low average faithfulness (${avgFaithfulness.toFixed(2)} < 0.70).`
    );
    return {
      verdict: 'release_blocked_regression',
      notes,
    };
  }
}
