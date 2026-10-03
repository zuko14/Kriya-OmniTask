/**
 * Kriya Omnitask — Governed Adaptation Types & Zod Schemas (§6, §23 M12)
 * Defines typed contracts for failure signature clustering, typed remediation proposals,
 * golden suite simulation validation, canary deployment, and automatic rollback.
 */

import { z } from 'zod';

export const FailureClassEnum = z.enum([
  'transient',
  'bad_input',
  'tool_failure',
  'model_failure',
  'capability_gap',
  'scope_mismatch',
  'policy_block',
  'critical_action',
]);
export type FailureClass = z.infer<typeof FailureClassEnum>;

export const RemediationProposalTypeEnum = z.enum([
  'new_skill',            // "Convert model judgment to a Skill" (§6, §9.3)
  'knowledge_gap',        // Add verified knowledge schema/facts
  'routing_rule',         // Fallback ordering / certified model routing
  'retry_timing',         // Auto-adaptable retry delays / exponential backoff
  'policy_tightening',    // Tighten risk threshold / firewall rule
  'extraction_correction' // Correct structured schema extraction rule
]);
export type RemediationProposalType = z.infer<typeof RemediationProposalTypeEnum>;

export const ProposalScopeEnum = z.enum(['platform', 'tenant']);
export type ProposalScope = z.infer<typeof ProposalScopeEnum>;

export const AdaptationSimulationStatusEnum = z.enum(['pending', 'passed', 'regressed', 'failed']);
export type AdaptationSimulationStatus = z.infer<typeof AdaptationSimulationStatusEnum>;

export const AdaptationApprovalStatusEnum = z.enum(['pending', 'approved', 'rejected']);
export type AdaptationApprovalStatus = z.infer<typeof AdaptationApprovalStatusEnum>;

export const AdaptationCanaryStatusEnum = z.enum(['canary_active', 'promoted', 'rolled_back']);
export type AdaptationCanaryStatus = z.infer<typeof AdaptationCanaryStatusEnum>;

export interface FailureSignature {
  id: string;
  tenantId: string;
  failureClass: FailureClass;
  businessType: string;
  agentId: string;
  agentSlug: string;
  stage: string;
  rootCause: string;
  frequency: number;
  costUsd: number;
  customerImpact: 'low' | 'medium' | 'high' | 'critical';
  modelTier: 'T1' | 'T2' | 'T3' | 'T4';
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface FailureCluster {
  clusterId: string;
  failureClass: FailureClass;
  agentSlug: string;
  rootCause: string;
  signatureIds: string[];
  totalOccurrences: number;
  totalCostUsd: number;
  dominantModelTier: 'T1' | 'T2' | 'T3' | 'T4';
  candidateReady: boolean;
}

export interface AdaptationGoldenTestCase {
  testId: string;
  scenario: string;
  input: Record<string, unknown>;
  expectedOutput: Record<string, unknown>;
  isTargetFailureRepro?: boolean;
}

export interface AdaptationGoldenSuiteValidationResult {
  suiteId: string;
  executedAt: string;
  totalTestCases: number;
  passedCount: number;
  failedCount: number;
  fixedTargetFailureCount: number;
  goldenSuiteRegressions: number;
  passed: boolean;
  /** Set when the suite was not executed (e.g. no replay evaluator); the proposal stays pending. */
  notRunReason?: string;
  details: Array<{
    testId: string;
    scenario: string;
    passed: boolean;
    regression: boolean;
    outputDelta?: string;
  }>;
}

export interface RemediationProposal {
  id: string;
  tenantId: string;
  scope: ProposalScope;
  proposalType: RemediationProposalType;
  title: string;
  description: string;
  targetFailureClass: FailureClass;
  clusterSignatureId?: string;
  requiresHumanApproval: boolean;
  proposedChanges: Record<string, unknown>;
  goldenSuiteValidation?: AdaptationGoldenSuiteValidationResult;
  simulationStatus: AdaptationSimulationStatus;
  approvalStatus: AdaptationApprovalStatus;
  approvedBy?: string | null;
  approvedAt?: string | null;
  deployedVersionTag?: string | null;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CanaryTelemetryMetrics {
  totalRequests: number;
  errorCount: number;
  escalationCount: number;
  errorRatePct: number;
  escalationRatePct: number;
  p99LatencyMs: number;
  customerSatisfactionScore?: number;
}

export interface AdaptationCanaryEvaluationResult {
  id: string;
  tenantId: string;
  proposalId: string;
  versionTag: string;
  canaryWeightPct: number;
  status: AdaptationCanaryStatus;
  baselineMetrics: CanaryTelemetryMetrics;
  canaryMetrics: CanaryTelemetryMetrics;
  regressionDetected: boolean;
  rollbackReason?: string | null;
  createdAt: string;
  updatedAt: string;
}

export const IngestFailureSignatureSchema = z.object({
  failureClass: FailureClassEnum,
  businessType: z.string().min(1),
  agentId: z.string().min(1),
  agentSlug: z.string().min(1),
  stage: z.string().min(1),
  rootCause: z.string().min(3),
  frequency: z.number().int().min(1).default(1),
  costUsd: z.number().min(0).default(0.0),
  customerImpact: z.enum(['low', 'medium', 'high', 'critical']).default('low'),
  modelTier: z.enum(['T1', 'T2', 'T3', 'T4']).default('T2'),
  metadata: z.record(z.unknown()).optional(),
});

export const GenerateProposalSchema = z.object({
  clusterId: z.string().min(1),
  proposalType: RemediationProposalTypeEnum,
  title: z.string().min(3),
  description: z.string().min(5),
  proposedChanges: z.record(z.unknown()),
});

export const ApproveProposalSchema = z.object({
  reason: z.string().min(3),
  canaryInitialWeightPct: z.number().int().min(1).max(50).default(10),
});

export const EvaluateCanarySchema = z.object({
  proposalId: z.string().min(1),
  canaryMetrics: z.object({
    totalRequests: z.number().int().min(1),
    errorCount: z.number().int().min(0),
    escalationCount: z.number().int().min(0),
    p99LatencyMs: z.number().min(0),
    customerSatisfactionScore: z.number().min(0).max(5).optional(),
  }),
  baselineMetrics: z.object({
    totalRequests: z.number().int().min(1),
    errorCount: z.number().int().min(0),
    escalationCount: z.number().int().min(0),
    p99LatencyMs: z.number().min(0),
    customerSatisfactionScore: z.number().min(0).max(5).optional(),
  }),
});

export const HarvestSignaturesSchema = z.object({
  windowHours: z.number().int().min(1).max(720).default(168),
  candidateThreshold: z.number().int().min(1).default(3),
});

export const RejectProposalSchema = z.object({
  reason: z.string().min(3),
});

