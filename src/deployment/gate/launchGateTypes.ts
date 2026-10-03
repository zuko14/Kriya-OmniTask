/**
 * Kriya Omnitask — Launch Gate Review Types (WP-8.6, docs/kriya/03_IMPLEMENTATION_PLAN.md § Launch Gate)
 *
 * Production Readiness Protocol:
 * Evaluates all 10 non-negotiable launch criteria with executable verification
 * and signed cryptographic Ed25519 proof receipts before real tenant onboarding.
 */

import { z } from 'zod';

export const LAUNCH_GATES = [
  'G1_NO_SIMULATED_ADAPTERS',
  'G2_POSTGRES_PITR_VERIFIED',
  'G3_CONSEQUENTIAL_ACTION_CHAIN',
  'G4_MODEL_PROVIDER_FALLBACK',
  'G5_WHATSAPP_PAYMENT_TESTMODE',
  'G6_GOLDEN_EVAL_HONESTY',
  'G7_TENANT_ISOLATION_VERIFIED',
  'G8_KILL_SWITCHES_OPERATIONAL',
  'G9_ROLLBACK_REHEARSED',
  'G10_NO_SUPERLATIVES_COPY',
] as const;

export type LaunchGateId = (typeof LAUNCH_GATES)[number];

export type LaunchGateStatus = 'PASS' | 'FAIL' | 'WARN';

export interface LaunchGateCheck {
  gateId: LaunchGateId;
  title: string;
  description: string;
  status: LaunchGateStatus;
  evidence: Record<string, unknown>;
  errors: string[];
  evaluatedAt: string;
}

export interface VerifiedActionTierMetrics {
  measured: boolean;
  rate: number | null;
  totalSamples: number;
  unmeasuredReason?: string;
}

export interface LaunchGateReviewSummary {
  totalGates: number;
  passedCount: number;
  failedCount: number;
  warnCount: number;
  verifiedActionRateByTier: {
    T0: VerifiedActionTierMetrics;
    T1: VerifiedActionTierMetrics;
    T2: VerifiedActionTierMetrics;
    T3: VerifiedActionTierMetrics;
  };
}

export interface LaunchGateReviewReport {
  reviewId: string;
  appMode: string;
  environment: string;
  evaluatedAt: string;
  reviewer: string;
  overallStatus: 'PASSED' | 'FAILED' | 'CONDITIONAL';
  gates: LaunchGateCheck[];
  summary: LaunchGateReviewSummary;
  proofReceiptId?: string;
  signedPayloadHash: string;
  signature: string;
}

export const LaunchGateEvaluationRequestSchema = z.object({
  reviewer: z.string().min(2).default('kriya_ops_director'),
  enforceAllGates: z.boolean().default(true),
  targetEnvironment: z.enum(['production', 'staging', 'sandbox', 'test']).optional(),
});

export type LaunchGateEvaluationRequest = z.infer<typeof LaunchGateEvaluationRequestSchema>;
