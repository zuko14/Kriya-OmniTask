/**
 * Kriya AI — Evals-as-CI & Regression Gating Type Contracts (WP-6.2)
 * Automated CI evaluation contracts, deterministic golden test cases per agent,
 * model-swap regression gates, charter-change gates, and pass^k consistency (§14, §18 of CLAUDE.md).
 */

import { z } from 'zod';
import { ReleaseGateVerdict, ReleaseGateVerdictEnum } from '../../types/evaluationTypes.js';

export type { ReleaseGateVerdict };
export { ReleaseGateVerdictEnum };

export type AgentSlug = 'intake' | 'scheduling' | 'payments' | 'document' | 'attention' | string;

export type GoldenTestCaseCategory =
  | 'core_flow'
  | 'adversarial'
  | 'safety_emergency'
  | 'multilingual'
  | 'edge_case'
  | 'compliance';

export interface DeterministicOutcomeAssertion {
  /** Expected routing target agent/queue if applicable */
  expectedRoute?: 'scheduling' | 'payments' | 'document' | 'attention' | 'faq' | 'emergency';
  /** Forbidden routing targets */
  forbiddenRoutes?: string[];
  /** Expected tool invocations */
  expectedTools?: string[];
  /** Forbidden tools (e.g. refunding without mandate, leak tools) */
  forbiddenTools?: string[];
  /** Specific state assertions (e.g. appointment status, payment hold amount) */
  stateChecks?: Record<string, unknown>;
  /** Must enforce zero raw data retention (hash only) */
  zeroRetentionCheck?: boolean;
  /** Expected emergency responder role paged (e.g. emergency_on_call) */
  emergencyRolePaged?: string;
  /** Minimum fact grounding / faithfulness score (default 0.70) */
  minFaithfulness?: number;
  /** Custom programmatic validator on final state / response */
  validator?: (state: Record<string, unknown>, response?: unknown) => { passed: boolean; reason?: string };
}

export interface AgentGoldenTestCase {
  id: string;
  name: string;
  agentSlug: AgentSlug;
  category: GoldenTestCaseCategory;
  /** Critical safety/emergency/adversarial: ANY regression or breach is an immediate blocker */
  isCriticalSafety: boolean;
  prompt: string;
  tag?: string;
  referenceEvidence?: string[];
  authoritativeFacts?: Record<string, unknown>;
  expectedOutcome: DeterministicOutcomeAssertion;
}

export interface AgentGoldenSuite {
  agentSlug: AgentSlug;
  suiteVersion: string;
  description: string;
  targetPassRate: number; // default 0.90 for prod, 0.80 for staging
  testCases: AgentGoldenTestCase[];
}

export interface CaseEvaluationResult {
  testCaseId: string;
  name: string;
  agentSlug: AgentSlug;
  category: GoldenTestCaseCategory;
  isCriticalSafety: boolean;
  passed: boolean;
  trialsPassed: number;
  trialsTotal: number;
  passKRatio: number;
  latencyMs: number;
  costUsd: number;
  failureReasons: string[];
  errorCategory?: 'provider' | 'reasoning' | 'budget';
  candidateOutput?: string;
  toolsInvoked?: string[];
}

export interface AgentSuiteEvaluationReport {
  agentSlug: AgentSlug;
  suiteVersion: string;
  totalCases: number;
  passedCases: number;
  failedCases: number;
  passRate: number;
  criticalSafetyBreaches: number;
  avgLatencyMs: number;
  totalCostUsd: number;
  verdict: ReleaseGateVerdict;
  gateNotes: string[];
  results: CaseEvaluationResult[];
}

export interface ModelSwapGateRequest {
  tenantId: string;
  currentModelId: string;
  proposedModelId: string;
  agentSlugs?: AgentSlug[];
  /** S27: Number of repeated trials per test case for pass^k consistency */
  passKTrials?: number;
  strictMode?: boolean;
}

export interface ModelSwapGateResult {
  verdict: ReleaseGateVerdict;
  currentModelId: string;
  proposedModelId: string;
  baselinePassRate: number;
  proposedPassRate: number;
  passRateDelta: number;
  safetyBreachesCount: number;
  latencyDeltaMs: number;
  costDeltaUsd: number;
  reasons: string[];
  agentReports: Record<string, {
    baselinePassRate: number;
    proposedPassRate: number;
    passed: boolean;
    notes: string[];
  }>;
}

export interface CharterUpdateGateRequest {
  tenantId: string;
  agentSlug: AgentSlug;
  currentCharter: Record<string, unknown>;
  proposedCharter: Record<string, unknown>;
  passKTrials?: number;
  strictMode?: boolean;
}

export interface CharterUpdateGateResult {
  verdict: ReleaseGateVerdict;
  agentSlug: AgentSlug;
  currentPassRate: number;
  proposedPassRate: number;
  passRateDelta: number;
  reasons: string[];
  blockedByRegression: boolean;
}

export interface EvaluationCiReport {
  ciRunId: string;
  timestamp: string;
  overallVerdict: ReleaseGateVerdict;
  passed: boolean;
  exitCode: 0 | 1;
  suitesEvaluated: number;
  totalTestCases: number;
  passedTestCases: number;
  passRate: number;
  criticalSafetyPassRate: number;
  agentReports: Record<string, AgentSuiteEvaluationReport>;
  blockers: string[];
  executionMode: 'hermetic' | 'live';
}

// Zod Schemas for REST API validation

export const RunCiSuiteRequestSchema = z.object({
  agentSlugs: z.array(z.string()).optional(),
  modelId: z.string().optional(),
  passKTrials: z.number().int().min(1).max(5).default(1),
  strictMode: z.boolean().default(false),
  executionMode: z.enum(['hermetic', 'live']).default('hermetic'),
});
export type RunCiSuiteRequest = z.infer<typeof RunCiSuiteRequestSchema>;

export const ModelSwapGateRequestSchema = z.object({
  tenantId: z.string().min(1),
  currentModelId: z.string().min(1),
  proposedModelId: z.string().min(1),
  agentSlugs: z.array(z.string()).optional(),
  passKTrials: z.number().int().min(1).max(5).default(1),
  strictMode: z.boolean().default(false),
});

export const CharterUpdateGateRequestSchema = z.object({
  tenantId: z.string().min(1),
  agentSlug: z.string().min(1),
  currentCharter: z.record(z.unknown()),
  proposedCharter: z.record(z.unknown()),
  passKTrials: z.number().int().min(1).max(5).default(1),
  strictMode: z.boolean().default(false),
});
