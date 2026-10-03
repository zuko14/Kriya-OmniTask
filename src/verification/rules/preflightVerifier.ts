/**
 * Kriya AI — Deterministic Pre-flight Output Verifier
 * High-speed deterministic rules enforcing zero unauthorized guarantees, ungrounded pricing, or unverified confirmations (§14, §15 of CLAUDE.md).
 */

import { PreflightCheckResult, PreflightViolation } from '../types/verificationTypes.js';

export class PreflightVerifier {
  // Regex rules for prohibited promises and unconditional guarantees
  private static readonly PROHIBITED_GUARANTEE_PATTERNS = [
    /\b(i|we)\s+(guarantee|promise)\s+(100%|complete|unconditional|lifetime|free)\b/i,
    /\b(i|we)\s+(guarantee|promise)\s+100%/i,
    /\b(money\s*back\s*guarantee|(?:no|without)\s*questions\s*asked\s*refund)\b/i,
    /\bguaranteed\s+(return\s*on\s*investment|roi|success|results)\b/i,
    /\b(you\s*will\s*never\s*(pay|be\s*charged|have\s*issues))\b/i,
  ];

  // Regex patterns detecting pricing inventions (e.g. "$XX" or "XX USD" or "XX% off")
  private static readonly PRICING_CLAIM_PATTERN = /(\$\s*\d+(?:,\d{3})*(?:\.\d+)?|\b\d+\s*(?:usd|inr|eur|dollars|rupees)\b|\b\d+%\s*(?:discount|off)\b)/gi;

  // Regex patterns detecting appointment booking assertions
  private static readonly BOOKING_CONFIRMATION_PATTERN = /\b(your\s+appointment\s+is\s+confirmed|successfully\s+booked\s+your\s+slot|reservation\s+is\s+confirmed)\b/i;

  /**
   * Evaluates text against deterministic pre-flight rules.
   */
  public static verify(params: {
    content: string;
    retrievedEvidence: string[];
    authoritativeFacts?: Record<string, unknown>;
  }): PreflightCheckResult {
    const { content, retrievedEvidence, authoritativeFacts } = params;
    const violations: PreflightViolation[] = [];
    let sanitizedContent: string | undefined = content;

    // 1. Check for Prohibited Guarantees & False Promises
    for (const pattern of this.PROHIBITED_GUARANTEE_PATTERNS) {
      const match = pattern.exec(content);
      if (match) {
        violations.push({
          category: 'prohibited_guarantee',
          severity: 'CRITICAL',
          message: `Prohibited unconditional guarantee detected: "${match[0]}"`,
          detectedText: match[0],
        });
      }
    }

    // 2. Check for Pricing Inventions
    const pricingMatches = content.match(this.PRICING_CLAIM_PATTERN);
    if (pricingMatches && pricingMatches.length > 0) {
      const combinedEvidence = retrievedEvidence.join(' ');
      const factsString = JSON.stringify(authoritativeFacts || {});

      // Extract all price tokens from evidence and facts
      const evidencePrices = new Set<string>();
      const evidenceMatches = (combinedEvidence + ' ' + factsString).match(this.PRICING_CLAIM_PATTERN) || [];
      for (const ep of evidenceMatches) {
        evidencePrices.add(ep.toLowerCase().replace(/\s+/g, ''));
      }

      for (const price of pricingMatches) {
        const cleanPrice = price.toLowerCase().replace(/\s+/g, '');
        if (!evidencePrices.has(cleanPrice)) {
          violations.push({
            category: 'unauthorized_pricing',
            severity: 'HIGH',
            message: `Ungrounded pricing claim '${price}' not found in retrieved knowledge or authoritative facts.`,
            detectedText: price,
          });
        }
      }
    }

    // 3. Check for Unverified Booking Confirmations
    if (this.BOOKING_CONFIRMATION_PATTERN.test(content)) {
      const hasBookingConfirmation =
        authoritativeFacts?.bookingId ||
        authoritativeFacts?.appointmentId ||
        authoritativeFacts?.status === 'confirmed' ||
        retrievedEvidence.some((e) => e.toLowerCase().includes('booking confirmed') || e.toLowerCase().includes('appointment confirmed'));

      if (!hasBookingConfirmation) {
        violations.push({
          category: 'unverified_booking_confirmation',
          severity: 'CRITICAL',
          message: 'Output claims appointment is confirmed, but no authoritative booking record or confirmation evidence exists.',
          detectedText: 'appointment is confirmed',
        });
      }
    }

    // If only non-critical violations or fixable text, create sanitized fallback
    const hasCritical = violations.some((v) => v.severity === 'CRITICAL');
    if (hasCritical) {
      sanitizedContent = undefined;
    }

    return {
      passed: violations.length === 0,
      violations,
      sanitizedContent,
    };
  }
}
