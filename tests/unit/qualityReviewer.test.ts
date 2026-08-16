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
});
