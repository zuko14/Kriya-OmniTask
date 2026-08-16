import { describe, it, expect } from 'vitest';
import { PriorityCalculator } from '../../src/attention/priority/priorityCalculator.js';

describe('Human Attention Priority & SLA Calculator Unit Tests', () => {
  it('should assign P0_CRITICAL and 15m SLA for security anomalies and high-value transactions', () => {
    const secPriority = PriorityCalculator.calculatePriority({
      reasonCategory: 'security_anomaly',
    });
    expect(secPriority).toBe('P0_CRITICAL');

    const highValuePriority = PriorityCalculator.calculatePriority({
      reasonCategory: 'financial_threshold',
      financialValueUsd: 15000,
    });
    expect(highValuePriority).toBe('P0_CRITICAL');

    const slaExpiry = PriorityCalculator.calculateSlaExpiry('P0_CRITICAL');
    const diffMinutes = (new Date(slaExpiry).getTime() - Date.now()) / (1000 * 60);
    expect(diffMinutes).toBeGreaterThanOrEqual(14);
    expect(diffMinutes).toBeLessThanOrEqual(16);
  });

  it('should assign P1_HIGH for sensitive complaints, policy violations, and agent disagreements', () => {
    const complaintPriority = PriorityCalculator.calculatePriority({
      reasonCategory: 'sensitive_complaint',
    });
    expect(complaintPriority).toBe('P1_HIGH');

    const policyPriority = PriorityCalculator.calculatePriority({
      reasonCategory: 'policy_violation',
    });
    expect(policyPriority).toBe('P1_HIGH');

    const disagreementPriority = PriorityCalculator.calculatePriority({
      reasonCategory: 'agent_disagreement',
    });
    expect(disagreementPriority).toBe('P1_HIGH');

    const slaExpiry = PriorityCalculator.calculateSlaExpiry('P1_HIGH');
    const diffMinutes = (new Date(slaExpiry).getTime() - Date.now()) / (1000 * 60);
    expect(diffMinutes).toBeGreaterThanOrEqual(58);
    expect(diffMinutes).toBeLessThanOrEqual(62);
  });

  it('should assign P2_MEDIUM for low confidence and workflow suspensions', () => {
    const confPriority = PriorityCalculator.calculatePriority({
      reasonCategory: 'low_confidence',
    });
    expect(confPriority).toBe('P2_MEDIUM');

    const workflowPriority = PriorityCalculator.calculatePriority({
      reasonCategory: 'workflow_suspended',
    });
    expect(workflowPriority).toBe('P2_MEDIUM');
  });
});
