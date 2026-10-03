/**
 * Kriya AI — Deterministic Business Invariant Verifier
 * Rigorous deterministic validation for financial, communication, privacy, autonomy, and structured output invariants (§14, §16 of CLAUDE.md).
 */

import { StructuredAgentOutput, RiskTier, AutonomyLevel } from '../../agents/types/agentTypes.js';
import { PolicyViolationError, ValidationError } from '../../core/errors/errors.js';

export interface FinancialInvariantInput {
  basePriceUsd: number;
  offeredPriceUsd: number;
  discountPercent?: number;
  maxDiscountAllowedPercent?: number;
  refundAmountUsd?: number;
  maxAutonomousRefundUsd?: number;
}

export interface CommunicationInvariantInput {
  recipientPhone: string;
  isQuietHours: boolean;
  hasOptInConsent: boolean;
  messageCountLast24Hours: number;
  maxAllowedDailyMessages?: number;
}

export interface PrivacyInvariantInput {
  content: string;
  allowedDataScopes: string[];
  requestedDataScopes?: string[];
}

export interface InvariantVerificationResult {
  valid: boolean;
  invariantName: string;
  violations: string[];
  requiresHumanApproval: boolean;
}

export class DeterministicVerifier {
  /**
   * 1. Verifies Financial Invariants (No unauthorized discounts, price below floor, or unbounded refunds).
   */
  public static verifyFinancial(input: FinancialInvariantInput): InvariantVerificationResult {
    const violations: string[] = [];
    const maxDiscount = input.maxDiscountAllowedPercent ?? 20.0;
    const maxRefund = input.maxAutonomousRefundUsd ?? 50.0;
    let requiresApproval = false;

    // Check discount percent
    const calculatedDiscount =
      input.discountPercent ??
      ((input.basePriceUsd - input.offeredPriceUsd) / input.basePriceUsd) * 100;

    if (calculatedDiscount > maxDiscount) {
      violations.push(
        `Discount ${calculatedDiscount.toFixed(1)}% exceeds maximum allowable autonomous discount of ${maxDiscount}%.`
      );
      requiresApproval = true;
    }

    if (input.offeredPriceUsd < 0) {
      violations.push(`Offered price cannot be negative ($${input.offeredPriceUsd}).`);
    }

    if (input.refundAmountUsd && input.refundAmountUsd > maxRefund) {
      violations.push(
        `Refund amount $${input.refundAmountUsd} exceeds autonomous limit of $${maxRefund}.`
      );
      requiresApproval = true;
    }

    return {
      valid: violations.length === 0,
      invariantName: 'financial_invariant',
      violations,
      requiresHumanApproval: requiresApproval,
    };
  }

  /**
   * 2. Verifies Communication Invariants (Anti-spam frequency, quiet hours, opt-in consent).
   */
  public static verifyCommunication(input: CommunicationInvariantInput): InvariantVerificationResult {
    const violations: string[] = [];
    const maxDaily = input.maxAllowedDailyMessages ?? 3;

    if (input.isQuietHours) {
      violations.push('Proactive outreach during quiet hours (21:00-08:00) is strictly prohibited.');
    }

    if (!input.hasOptInConsent) {
      violations.push('Customer has not provided active opt-in consent for marketing outreach.');
    }

    if (input.messageCountLast24Hours >= maxDaily) {
      violations.push(
        `Daily frequency limit reached (${input.messageCountLast24Hours} >= max ${maxDaily} messages in 24h).`
      );
    }

    return {
      valid: violations.length === 0,
      invariantName: 'communication_invariant',
      violations,
      requiresHumanApproval: false,
    };
  }

  /**
   * 3. Verifies Privacy & Data Scope Invariants.
   */
  public static verifyPrivacy(input: PrivacyInvariantInput): InvariantVerificationResult {
    const violations: string[] = [];

    // Check for raw Credit Card numbers (13-16 digits)
    if (/\b(?:\d{4}[ -]?){3}\d{4}\b/.test(input.content)) {
      violations.push('Unmasked Credit Card Number detected in content.');
    }

    // Check for raw SSN (XXX-XX-XXXX)
    if (/\b\d{3}-\d{2}-\d{4}\b/.test(input.content)) {
      violations.push('Unmasked Social Security Number (SSN) detected in content.');
    }

    // Check data scopes
    if (input.requestedDataScopes) {
      for (const scope of input.requestedDataScopes) {
        if (!input.allowedDataScopes.includes(scope)) {
          violations.push(`Unauthorized data scope access: '${scope}'. Allowed: [${input.allowedDataScopes.join(', ')}]`);
        }
      }
    }

    return {
      valid: violations.length === 0,
      invariantName: 'privacy_invariant',
      violations,
      requiresHumanApproval: false,
    };
  }

  /**
   * 4. Verifies Agent Autonomy vs Action Risk Tier Invariant (§15 of CLAUDE.md).
   */
  public static verifyAutonomy(
    autonomyLevel: AutonomyLevel,
    riskTier: RiskTier
  ): InvariantVerificationResult {
    const violations: string[] = [];
    let requiresApproval = false;

    // Autonomy Level 0: Observe only
    if (autonomyLevel === 0 && riskTier !== 'LOW') {
      violations.push(`Agent is at Autonomy Level 0 (Observe Only) and cannot perform '${riskTier}' risk action.`);
    }

    // Autonomy Level 1-2: Requires approval for HIGH or CRITICAL
    if (autonomyLevel <= 2 && (riskTier === 'HIGH' || riskTier === 'CRITICAL')) {
      requiresApproval = true;
    }

    // All Autonomy levels require approval for CRITICAL actions (§37)
    if (riskTier === 'CRITICAL') {
      requiresApproval = true;
    }

    return {
      valid: violations.length === 0,
      invariantName: 'autonomy_invariant',
      violations,
      requiresHumanApproval: requiresApproval,
    };
  }

  /**
   * 5. Verifies Structured Agent Output Schema & Confidence Invariant (§12 & §16).
   */
  public static verifyStructuredOutput(
    output: StructuredAgentOutput,
    minConfidenceThreshold: number = 0.75
  ): InvariantVerificationResult {
    const violations: string[] = [];
    let requiresApproval = output.requiresApproval;

    if (!output.facts || output.facts.length === 0) {
      violations.push('Agent output facts list cannot be empty.');
    }

    if (output.confidence < minConfidenceThreshold) {
      violations.push(
        `Confidence score (${output.confidence}) is below required verification threshold (${minConfidenceThreshold}).`
      );
      requiresApproval = true;
    }

    if (!output.recommendedAction || output.recommendedAction.trim().length === 0) {
      violations.push('Agent recommended action cannot be empty.');
    }

    return {
      valid: violations.length === 0,
      invariantName: 'structured_output_invariant',
      violations,
      requiresHumanApproval: requiresApproval,
    };
  }
}
