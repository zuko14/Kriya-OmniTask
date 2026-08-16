/**
 * Xylarc AI — Deterministic Invariant Verifier Unit Tests
 * Verifies mathematical, privacy, communication, autonomy, and structured output invariants (§14, §16 of CLAUDE.md).
 */

import { describe, it, expect } from 'vitest';
import { DeterministicVerifier } from '../../src/policy/verifier/deterministicVerifier.js';
import { StructuredAgentOutput } from '../../src/agents/types/agentTypes.js';

describe('Deterministic Invariant Verifier Unit Tests', () => {
  it('should verify financial invariants and flag excessive discounts or refunds', () => {
    // 1. Valid financial offer
    const valid = DeterministicVerifier.verifyFinancial({
      basePriceUsd: 100,
      offeredPriceUsd: 85, // 15% discount (<= 20%)
      refundAmountUsd: 20,
    });
    expect(valid.valid).toBe(true);
    expect(valid.violations).toHaveLength(0);

    // 2. Excessive discount (30% > 20%)
    const invalidDiscount = DeterministicVerifier.verifyFinancial({
      basePriceUsd: 100,
      offeredPriceUsd: 70, // 30% discount
    });
    expect(invalidDiscount.valid).toBe(false);
    expect(invalidDiscount.requiresHumanApproval).toBe(true);
    expect(invalidDiscount.violations[0]).toContain('exceeds maximum allowable autonomous discount');

    // 3. Negative price
    const negativePrice = DeterministicVerifier.verifyFinancial({
      basePriceUsd: 100,
      offeredPriceUsd: -10,
    });
    expect(negativePrice.valid).toBe(false);
    expect(negativePrice.violations.some((v) => v.includes('negative'))).toBe(true);
  });

  it('should verify communication invariants for quiet hours, consent, and frequency', () => {
    // 1. Valid communication
    const valid = DeterministicVerifier.verifyCommunication({
      recipientPhone: '+919988112233',
      isQuietHours: false,
      hasOptInConsent: true,
      messageCountLast24Hours: 1,
    });
    expect(valid.valid).toBe(true);

    // 2. Quiet hours violation
    const quietHours = DeterministicVerifier.verifyCommunication({
      recipientPhone: '+919988112233',
      isQuietHours: true,
      hasOptInConsent: true,
      messageCountLast24Hours: 1,
    });
    expect(quietHours.valid).toBe(false);
    expect(quietHours.violations[0]).toContain('quiet hours');

    // 3. Missing consent violation
    const noConsent = DeterministicVerifier.verifyCommunication({
      recipientPhone: '+919988112233',
      isQuietHours: false,
      hasOptInConsent: false,
      messageCountLast24Hours: 0,
    });
    expect(noConsent.valid).toBe(false);
    expect(noConsent.violations[0]).toContain('opt-in consent');
  });

  it('should verify privacy invariants and detect unmasked credit cards and SSNs', () => {
    const leakCheck = DeterministicVerifier.verifyPrivacy({
      content: 'Client SSN is 000-12-3456 and CC is 4111 2222 3333 4444',
      allowedDataScopes: ['public'],
      requestedDataScopes: ['payroll_records'], // Unauthorized scope
    });

    expect(leakCheck.valid).toBe(false);
    expect(leakCheck.violations.some((v) => v.includes('Credit Card'))).toBe(true);
    expect(leakCheck.violations.some((v) => v.includes('Social Security'))).toBe(true);
    expect(leakCheck.violations.some((v) => v.includes('Unauthorized data scope'))).toBe(true);
  });

  it('should verify autonomy level invariants against action risk tiers', () => {
    // Level 0 cannot mutate (HIGH risk)
    const level0 = DeterministicVerifier.verifyAutonomy(0, 'HIGH');
    expect(level0.valid).toBe(false);

    // Level 2 requires human approval for HIGH
    const level2High = DeterministicVerifier.verifyAutonomy(2, 'HIGH');
    expect(level2High.valid).toBe(true);
    expect(level2High.requiresHumanApproval).toBe(true);

    // CRITICAL action always requires human approval (§37)
    const level5Critical = DeterministicVerifier.verifyAutonomy(5, 'CRITICAL');
    expect(level5Critical.requiresHumanApproval).toBe(true);
  });

  it('should verify structured agent output contracts', () => {
    const validOutput: StructuredAgentOutput = {
      taskId: 'task-1',
      status: 'completed',
      facts: ['Lead expressed interest in Enterprise plan'],
      evidence: [{ source: 'whatsapp_conversation' }],
      confidence: 0.95,
      recommendedAction: 'Schedule executive demo',
      risks: [],
      policyFlags: [],
      requiresApproval: false,
      details: {},
    };

    const validCheck = DeterministicVerifier.verifyStructuredOutput(validOutput);
    expect(validCheck.valid).toBe(true);

    // Low confidence output (< 0.75)
    const lowConfidenceOutput: StructuredAgentOutput = {
      ...validOutput,
      confidence: 0.60,
    };
    const lowConfCheck = DeterministicVerifier.verifyStructuredOutput(lowConfidenceOutput);
    expect(lowConfCheck.valid).toBe(false);
    expect(lowConfCheck.requiresHumanApproval).toBe(true);
  });
});
