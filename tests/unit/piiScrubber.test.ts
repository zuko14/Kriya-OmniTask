import { describe, it, expect } from 'vitest';
import { PiiScrubber, PiiQueryBlockedError } from '../../src/retrieval/external/scrubber/piiScrubber.js';

describe('PII Scrubber Unit Tests (§10.3, §10.4)', () => {
  it('should allow clean business search queries without PII', () => {
    const cleanQuery = 'Acme Corp quarterly revenue 2025 financial report';
    const result = PiiScrubber.scan(cleanQuery);
    expect(result.isClean).toBe(true);
    expect(result.blocked).toBe(false);
    expect(result.violations).toHaveLength(0);

    expect(() => PiiScrubber.assertNoPii(cleanQuery)).not.toThrow();
  });

  it('should block queries containing customer email addresses (never sanitize-and-send)', () => {
    const queryWithEmail = 'search prospect contact at john.doe@example.com for partnership';
    const result = PiiScrubber.scan(queryWithEmail);

    expect(result.isClean).toBe(false);
    expect(result.blocked).toBe(true);
    expect(result.violations.some((v) => v.category === 'email')).toBe(true);

    expect(() => PiiScrubber.assertNoPii(queryWithEmail)).toThrow(PiiQueryBlockedError);
  });

  it('should block queries containing Indian mobile phone numbers (+91 / 10-digits)', () => {
    const queryWithPhone = 'lookup customer records for +91 9876543210 status';
    const result = PiiScrubber.scan(queryWithPhone);

    expect(result.isClean).toBe(false);
    expect(result.blocked).toBe(true);
    expect(result.violations.some((v) => v.category === 'phone')).toBe(true);

    expect(() => PiiScrubber.assertNoPii(queryWithPhone)).toThrow(PiiQueryBlockedError);
  });

  it('should block queries containing Indian Aadhaar numbers', () => {
    const queryWithAadhaar = 'verify KYC identity 4532 8912 3456 background check';
    const result = PiiScrubber.scan(queryWithAadhaar);

    expect(result.isClean).toBe(false);
    expect(result.blocked).toBe(true);
    expect(result.violations.some((v) => v.category === 'aadhaar')).toBe(true);

    expect(() => PiiScrubber.assertNoPii(queryWithAadhaar)).toThrow(PiiQueryBlockedError);
  });

  it('should block queries containing Indian PAN numbers', () => {
    const queryWithPan = 'tax filing details for ABCDE1234F GST records';
    const result = PiiScrubber.scan(queryWithPan);

    expect(result.isClean).toBe(false);
    expect(result.blocked).toBe(true);
    expect(result.violations.some((v) => v.category === 'pan')).toBe(true);

    expect(() => PiiScrubber.assertNoPii(queryWithPan)).toThrow(PiiQueryBlockedError);
  });

  it('should block queries containing US SSN or Credit Card numbers', () => {
    const queryWithSsn = 'client verification for 123-45-6789 credit report';
    const result = PiiScrubber.scan(queryWithSsn);

    expect(result.isClean).toBe(false);
    expect(result.blocked).toBe(true);
    expect(result.violations.some((v) => v.category === 'ssn')).toBe(true);

    expect(() => PiiScrubber.assertNoPii(queryWithSsn)).toThrow(PiiQueryBlockedError);
  });
});
