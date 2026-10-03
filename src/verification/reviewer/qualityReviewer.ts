/**
 * Kriya AI — Quality Reviewer Engine (Dual-Pass Verification & LLM Judge)
 * Multi-dimensional quality evaluation and verdict generation (§14, §15 of CLAUDE.md).
 */

import {
  QualityReviewRequest,
  QualityReviewResult,
  QualityVerdict,
  ReviewerType,
} from '../types/verificationTypes.js';
import { PreflightVerifier } from '../rules/preflightVerifier.js';
import { DriftDetector } from '../../observability/drift/driftDetector.js';

export class QualityReviewer {
  /**
   * Reviews target content through deterministic pre-flight verification and grounding analysis.
   */
  public static evaluate(request: QualityReviewRequest): QualityReviewResult {
    const { targetContent, retrievedEvidence, declaredFacts, strictMode } = request;
    const flaggedIssues: string[] = [];

    // 1. Run deterministic pre-flight checks
    const preflight = PreflightVerifier.verify({
      content: targetContent,
      retrievedEvidence,
      authoritativeFacts: declaredFacts as Record<string, unknown> | undefined,
    });

    let policyComplianceScore = 1.0;
    for (const v of preflight.violations) {
      flaggedIssues.push(`[${v.severity}] ${v.message}`);
      if (v.severity === 'CRITICAL') {
        policyComplianceScore -= 0.50;
      } else if (v.severity === 'HIGH') {
        policyComplianceScore -= 0.25;
      } else {
        policyComplianceScore -= 0.10;
      }
    }
    policyComplianceScore = Math.max(0, policyComplianceScore);

    // 2. Compute Faithfulness / Fact Grounding Score (S24: Claim-level and paraphrase-tolerant)
    const faithfulnessScore = DriftDetector.evaluateGrounding(
      targetContent,
      retrievedEvidence,
      declaredFacts as Record<string, unknown> | undefined
    );
    if (faithfulnessScore < 0.60 && (retrievedEvidence.length > 0 || (declaredFacts && Object.keys(declaredFacts).length > 0))) {
      flaggedIssues.push(`[HIGH] Content fact grounding score is low (${Math.round(faithfulnessScore * 100)}%). Potential hallucination.`);
    }

    // 3. Evaluate Tone & Clarity Score
    let toneClarityScore = 1.0;
    const textLower = targetContent.toLowerCase();

    // Check for negative or abrasive language
    if (/\b(shut up|stupid|idiot|hate|terrible customer|screw you)\b/i.test(textLower)) {
      toneClarityScore -= 0.60;
      flaggedIssues.push('[CRITICAL] Unprofessional or hostile tone detected.');
    }

    // Check for excessive capitalization (screaming)
    const upperCount = (targetContent.match(/[A-Z]/g) || []).length;
    const totalLetters = (targetContent.match(/[a-zA-Z]/g) || []).length;
    if (totalLetters > 20 && upperCount / totalLetters > 0.50) {
      toneClarityScore -= 0.25;
      flaggedIssues.push('[MEDIUM] Excessive uppercase text detected.');
    }

    toneClarityScore = Math.max(0, toneClarityScore);

    // 4. Calculate Overall Weighted Score
    const overallScore = Math.round(
      (0.45 * faithfulnessScore + 0.35 * policyComplianceScore + 0.20 * toneClarityScore) * 100
    ) / 100;

    // 5. Determine Verdict
    let verdict: QualityVerdict = 'approved';
    let correctedContent: string | undefined = undefined;

    const hasCriticalViolation = preflight.violations.some((v) => v.severity === 'CRITICAL') || toneClarityScore < 0.50;

    if (hasCriticalViolation || overallScore < (strictMode ? 0.70 : 0.55)) {
      verdict = 'reject_escalate';
    } else if (overallScore < (strictMode ? 0.85 : 0.80) || preflight.violations.length > 0) {
      verdict = 'revise';
      correctedContent = preflight.sanitizedContent || targetContent.trim();
    } else {
      verdict = 'approved';
    }

    const reviewerType: ReviewerType = 'hybrid';

    return {
      verdict,
      faithfulnessScore,
      policyComplianceScore,
      toneClarityScore,
      overallScore,
      flaggedIssues,
      correctedContent,
      reviewerType,
    };
  }
}
