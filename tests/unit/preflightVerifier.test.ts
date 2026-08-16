import { describe, it, expect } from 'vitest';
import { PreflightVerifier } from '../../src/verification/rules/preflightVerifier.js';

describe('Preflight Verifier Deterministic Rules Unit Tests', () => {
  it('should intercept prohibited unconditional guarantees and promises', () => {
    const prohibited = 'We guarantee 100% refund without questions asked!';
    const result = PreflightVerifier.verify({
      content: prohibited,
      retrievedEvidence: [],
    });

    expect(result.passed).toBe(false);
    expect(result.violations.some((v) => v.category === 'prohibited_guarantee')).toBe(true);
    expect(result.sanitizedContent).toBeUndefined(); // Critical violation
  });

  it('should intercept ungrounded pricing claims not present in evidence or facts', () => {
    const hallucinatedPrice = 'Our premium plan is currently on sale for $49 per month!';
    const result = PreflightVerifier.verify({
      content: hallucinatedPrice,
      retrievedEvidence: ['Our enterprise plan costs $499 per month.'],
      authoritativeFacts: { standardPrice: '$199' },
    });

    expect(result.passed).toBe(false);
    expect(result.violations.some((v) => v.category === 'unauthorized_pricing')).toBe(true);
  });

  it('should allow grounded pricing present in authoritative facts or retrieved evidence', () => {
    const groundedPrice = 'The standard plan is $199 per month.';
    const result = PreflightVerifier.verify({
      content: groundedPrice,
      retrievedEvidence: ['The standard plan is $199 per month.'],
      authoritativeFacts: { standardPrice: '$199' },
    });

    expect(result.passed).toBe(true);
    expect(result.violations.length).toBe(0);
  });

  it('should intercept unverified booking confirmations when no authoritative confirmation exists', () => {
    const fakeConfirmation = 'Your appointment is confirmed for tomorrow at 10 AM.';
    const result = PreflightVerifier.verify({
      content: fakeConfirmation,
      retrievedEvidence: [],
      authoritativeFacts: {},
    });

    expect(result.passed).toBe(false);
    expect(result.violations.some((v) => v.category === 'unverified_booking_confirmation')).toBe(true);
  });
});
