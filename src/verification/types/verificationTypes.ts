/**
 * Xylarc AI — Deterministic Verification & Quality Reviewer Type Definitions
 * Typed contracts for pre-flight assertions, dual-pass quality evaluations, and verdicts (§14, §15 of CLAUDE.md).
 */

import { z } from 'zod';
import { BaseEntity } from '../../storage/repositories/baseRepository.js';

export const QualityVerdictEnum = z.enum(['approved', 'revise', 'reject_escalate']);
export type QualityVerdict = z.infer<typeof QualityVerdictEnum>;

export const ReviewerTypeEnum = z.enum(['deterministic_rule', 'dual_pass_judge', 'hybrid']);
export type ReviewerType = z.infer<typeof ReviewerTypeEnum>;

export interface QualityReviewRecord extends BaseEntity {
  organization_id: string;
  correlation_id: string;
  trace_id?: string;
  agent_id: string;
  target_content: string;
  retrieved_evidence_json: string;
  verdict: QualityVerdict;
  faithfulness_score: number;
  policy_compliance_score: number;
  tone_clarity_score: number;
  overall_score: number;
  flagged_issues_json: string;
  corrected_content?: string;
  reviewer_type: ReviewerType;
  reviewed_at: string;
}

export const PreflightRuleViolationCategoryEnum = z.enum([
  'unverified_promise',
  'unauthorized_pricing',
  'unverified_booking_confirmation',
  'prohibited_guarantee',
  'missing_evidence_grounding',
  'pii_leakage',
]);
export type PreflightRuleViolationCategory = z.infer<typeof PreflightRuleViolationCategoryEnum>;

export interface PreflightViolation {
  category: PreflightRuleViolationCategory;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM';
  message: string;
  detectedText?: string;
}

export interface PreflightCheckResult {
  passed: boolean;
  violations: PreflightViolation[];
  sanitizedContent?: string;
}

export const QualityReviewRequestSchema = z.object({
  correlationId: z.string().min(1),
  traceId: z.string().optional(),
  agentId: z.string().min(1),
  targetContent: z.string().min(1),
  retrievedEvidence: z.array(z.string()).default([]),
  declaredFacts: z.record(z.unknown()).optional(),
  strictMode: z.boolean().default(false),
});
export type QualityReviewRequest = z.infer<typeof QualityReviewRequestSchema>;

export interface QualityReviewResult {
  verdict: QualityVerdict;
  faithfulnessScore: number;
  policyComplianceScore: number;
  toneClarityScore: number;
  overallScore: number;
  flaggedIssues: string[];
  correctedContent?: string;
  reviewerType: ReviewerType;
}

export interface VerificationMetricsOverview {
  totalReviews: number;
  approvedCount: number;
  revisedCount: number;
  rejectedCount: number;
  approvalRatePct: number;
  avgFaithfulness: number;
  avgOverallScore: number;
}

export const ListReviewsQuerySchema = z.object({
  agentId: z.string().optional(),
  verdict: QualityVerdictEnum.optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
});
export type ListReviewsQuery = z.infer<typeof ListReviewsQuerySchema>;
