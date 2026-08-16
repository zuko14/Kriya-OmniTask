import { describe, it, expect } from 'vitest';
import { DeploymentGateEvaluator } from '../../src/deployment/gates/deploymentGateEvaluator.js';

describe('DeploymentGateEvaluator Unit Tests', () => {
  it('should approve deployment when all quality, drift, security, and latency gates pass', () => {
    const output = DeploymentGateEvaluator.evaluate({
      testPassRate: 0.995, // 99.5%
      semanticDriftScore: 0.015, // 1.5%
      criticalSecurityVulnerabilitiesCount: 0,
      p95LatencyMs: 380,
      p95LatencyBudgetMs: 500,
    });

    expect(output.verdict).toBe('approved');
    expect(output.scorePct).toBe(100);
    expect(output.checks.every((c) => c.passed)).toBe(true);
  });

  it('should block deployment immediately when critical security vulnerabilities are detected', () => {
    const output = DeploymentGateEvaluator.evaluate({
      testPassRate: 1.0,
      semanticDriftScore: 0.01,
      criticalSecurityVulnerabilitiesCount: 2, // Blocked
      p95LatencyMs: 300,
      p95LatencyBudgetMs: 500,
    });

    expect(output.verdict).toBe('blocked');
    const secCheck = output.checks.find((c) => c.checkName === 'zero_critical_security_vulnerabilities')!;
    expect(secCheck.passed).toBe(false);
    expect(output.notes.some((n) => n.includes('security vulnerabilities'))).toBe(true);
  });

  it('should grant conditional verdict when pass rate is acceptable for staging but below production target', () => {
    const output = DeploymentGateEvaluator.evaluate({
      testPassRate: 0.92, // 92% (below 98% approved, above 90% conditional)
      semanticDriftScore: 0.04,
      criticalSecurityVulnerabilitiesCount: 0,
      p95LatencyMs: 400,
      p95LatencyBudgetMs: 500,
    });

    expect(output.verdict).toBe('conditional');
  });
});
