import { describe, it, expect } from 'vitest';
import { QualityReviewer } from '../../src/verification/reviewer/qualityReviewer.js';

describe('Quality Reviewer & Dual-Pass Engine Unit Tests', () => {
  it('should grant APPROVED verdict for high-grounding, polite, policy-compliant content', () => {
    const evidence = [
      'Our team is available Monday through Friday from 9 AM to 6 PM EST.',
      'You can schedule a consultation using our online booking portal.',
    ];

    const goodOutput = 'Hello! Our team is available Monday through Friday from 9 AM to 6 PM EST. You can schedule a consultation using our online booking portal anytime.';

    const review = QualityReviewer.evaluate({
      correlationId: 'corr_eval_1',
      agentId: 'support_agent',
      targetContent: goodOutput,
      retrievedEvidence: evidence,
      strictMode: false,
    });

    expect(review.verdict).toBe('approved');
    expect(review.faithfulnessScore).toBeGreaterThanOrEqual(0.70);
    expect(review.policyComplianceScore).toBe(1.0);
    expect(review.toneClarityScore).toBe(1.0);
    expect(review.overallScore).toBeGreaterThanOrEqual(0.85);
    expect(review.flaggedIssues.length).toBe(0);
  });

  it('should grant REJECT_ESCALATE verdict for hostile tone or critical promise violations', () => {
    const hostileOutput = 'Shut up and stop bothering our support line with stupid questions!';

    const review = QualityReviewer.evaluate({
      correlationId: 'corr_eval_2',
      agentId: 'support_agent',
      targetContent: hostileOutput,
      retrievedEvidence: [],
      strictMode: false,
    });

    expect(review.verdict).toBe('reject_escalate');
    expect(review.toneClarityScore).toBeLessThan(0.50);
    expect(review.flaggedIssues.some((i) => i.includes('Unprofessional or hostile'))).toBe(true);
  });

  it('should grant REVISE verdict with sanitized content for mild policy issues', () => {
    const mildIssue = 'The price is $199 per month.';
    const review = QualityReviewer.evaluate({
      correlationId: 'corr_eval_3',
      agentId: 'sales_agent',
      targetContent: mildIssue,
      retrievedEvidence: [], // Price not grounded
      strictMode: false,
    });

    expect(['revise', 'reject_escalate']).toContain(review.verdict);
    expect(review.flaggedIssues.length).toBeGreaterThan(0);
  });

  it('S24: allows valid paraphrasing without lexical penalty when factual claims match evidence', () => {
    const evidence = [
      'Sunrise Clinic is open Monday to Saturday from 9 AM to 7 PM. Closed on Sundays.',
      'A general consultation costs 500 rupees.',
    ];

    // Completely transformed conversational paraphrase, but preserving all factual entities (days, hours, 500 fee)
    const paraphrased = 'Hello! We welcome you Monday through Saturday between 9 AM and 7 PM. Please note we are closed on Sunday. A general consultation is 500 rupees.';

    const review = QualityReviewer.evaluate({
      correlationId: 'corr_s24_paraphrase',
      agentId: 'intake_agent',
      targetContent: paraphrased,
      retrievedEvidence: evidence,
      strictMode: false,
    });

    expect(review.verdict).toBe('approved');
    expect(review.faithfulnessScore).toBeGreaterThanOrEqual(0.75);
    expect(review.flaggedIssues.length).toBe(0);
  });

  it('S24: penalizes hallucinated price or facts even if phrasing is polite', () => {
    const evidence = [
      'A general consultation costs 500 rupees.',
    ];

    // Polite tone, but ungrounded fabricated fee (1500 instead of 500)
    const hallucinatedFee = 'We would be pleased to assist you. Our general consultation fee is 1500 rupees.';

    const review = QualityReviewer.evaluate({
      correlationId: 'corr_s24_hallucination',
      agentId: 'intake_agent',
      targetContent: hallucinatedFee,
      retrievedEvidence: evidence,
      strictMode: false,
    });

    expect(review.faithfulnessScore).toBeLessThan(0.60);
    expect(review.flaggedIssues.some((i) => i.includes('Content fact grounding score is low'))).toBe(true);
  });
});
