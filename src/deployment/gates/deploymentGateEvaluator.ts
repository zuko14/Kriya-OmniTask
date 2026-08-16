/**
 * Xylarc AI — Production Deployment Gate Evaluator
 * Multi-dimensional quality gate scoring test pass rates, drift tolerance, zero security vulnerabilities, and latency budgets.
 */

import { GateEvaluationInput, GateEvaluationOutput, GateCheckResult, DeploymentGateVerdict } from '../types/deploymentTypes.js';

export class DeploymentGateEvaluator {
  /**
   * Evaluates deployment artifacts against strict enterprise production release gates.
   */
  public static evaluate(input: GateEvaluationInput): GateEvaluationOutput {
    const checks: GateCheckResult[] = [];
    const notes: string[] = [];

    // 1. Critical Security Vulnerabilities Check (Must be 0)
    const securityPassed = input.criticalSecurityVulnerabilitiesCount === 0;
    checks.push({
      checkName: 'zero_critical_security_vulnerabilities',
      passed: securityPassed,
      message: securityPassed
        ? 'Zero critical security vulnerabilities detected.'
        : `Blocked: Found ${input.criticalSecurityVulnerabilitiesCount} critical unaddressed security vulnerability(ies).`,
    });

    // 2. Test Pass Rate Check (≥ 98.0% for approved, ≥ 90.0% for conditional)
    const testPassed = input.testPassRate >= 0.98;
    checks.push({
      checkName: 'golden_test_pass_rate',
      passed: testPassed,
      message: `Test Pass Rate: ${(input.testPassRate * 100).toFixed(1)}% (Threshold: ≥98.0%)`,
    });

    // 3. Semantic Drift Score Check (≤ 0.05 / 5%)
    const driftPassed = input.semanticDriftScore <= 0.05;
    checks.push({
      checkName: 'semantic_drift_tolerance',
      passed: driftPassed,
      message: `Semantic Drift Score: ${(input.semanticDriftScore * 100).toFixed(1)}% (Tolerance: ≤5.0%)`,
    });

    // 4. Latency Budget Check (P95 latency ≤ budget)
    const latencyPassed = input.p95LatencyMs <= input.p95LatencyBudgetMs;
    checks.push({
      checkName: 'p95_latency_budget',
      passed: latencyPassed,
      message: `P95 Latency: ${input.p95LatencyMs}ms (Budget: ${input.p95LatencyBudgetMs}ms)`,
    });

    // Determine aggregate verdict and score
    const passedCount = checks.filter((c) => c.passed).length;
    const scorePct = Math.round((passedCount / checks.length) * 100);

    let verdict: DeploymentGateVerdict = 'blocked';

    if (!securityPassed) {
      verdict = 'blocked';
      notes.push('Deployment blocked immediately due to unresolved critical security vulnerabilities.');
    } else if (passedCount === checks.length) {
      verdict = 'approved';
      notes.push('All enterprise deployment gates passed. Ready for automated production promotion.');
    } else if (input.testPassRate >= 0.90 && input.semanticDriftScore <= 0.10 && latencyPassed) {
      verdict = 'conditional';
      notes.push('Conditional approval: Staging verification allowed, but manual operator sign-off required for production.');
    } else {
      verdict = 'blocked';
      notes.push('Deployment blocked: Multiple release quality gate thresholds were breached.');
    }

    return {
      verdict,
      scorePct,
      checks,
      notes,
    };
  }
}
