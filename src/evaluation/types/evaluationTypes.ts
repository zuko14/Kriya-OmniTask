/**
 * Kriya AI — Agent Evaluation Benchmark & Golden Test Suite Type Definitions
 * Typed contracts for golden test datasets, benchmark executions, and release gating (§14, §18 of CLAUDE.md).
 */

import { z } from 'zod';
import { BaseEntity } from '../../storage/repositories/baseRepository.js';

export const ReleaseGateVerdictEnum = z.enum([
  'release_approved',
  'release_blocked_regression',
  'conditional_pass',
]);
export type ReleaseGateVerdict = z.infer<typeof ReleaseGateVerdictEnum>;

export const BenchmarkStatusEnum = z.enum(['running', 'completed', 'failed']);
export type BenchmarkStatus = z.infer<typeof BenchmarkStatusEnum>;

export interface GoldenTestCase {
  id: string;
  name: string;
  category: 'core_flow' | 'adversarial' | 'edge_case' | 'compliance' | 'multilingual';
  prompt: string;
  referenceEvidence: string[];
  expectedTools?: string[];
  forbiddenTools?: string[];
  groundTruthOutput?: string;
  minFaithfulness?: number;
  maxAllowedLatencyMs?: number;
}

export interface TestCaseEvaluationResult {
  testCaseId: string;
  name: string;
  passed: boolean;
  faithfulnessScore: number;
  policyVerdict: 'approved' | 'revise' | 'reject_escalate';
  toolsInvoked: string[];
  /** The candidate's actual answer that was graded. */
  candidateOutput: string;
  latencyMs: number;
  tokensUsed: number;
  costUsd: number;
  failureReasons: string[];
}

export interface BenchmarkSummaryReport {
  totalTestCases: number;
  passedTestCases: number;
  failedTestCases: number;
  passRate: number;
  avgFaithfulness: number;
  avgLatencyMs: number;
  totalCostUsd: number;
  verdict: ReleaseGateVerdict;
  releaseGateNotes: string[];
  /** 'sandbox' = answers came from the simulated adapter and prove nothing about real quality. */
  executionMode: 'live' | 'sandbox';
  results: TestCaseEvaluationResult[];
}

export interface EvaluationDatasetRecord extends BaseEntity {
  organization_id: string;
  name: string;
  description: string;
  version: string;
  target_agent_id: string;
  test_cases_json: string;
}

export interface EvaluationBenchmarkRecord extends BaseEntity {
  organization_id: string;
  dataset_id: string;
  model_id: string;
  prompt_version: string;
  status: BenchmarkStatus;
  verdict: ReleaseGateVerdict;
  total_test_cases: number;
  passed_test_cases: number;
  failed_test_cases: number;
  pass_rate: number;
  avg_faithfulness: number;
  avg_latency_ms: number;
  total_cost_usd: number;
  detailed_results_json: string;
  started_at: string;
  completed_at?: string;
}

export const GoldenTestCaseSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  category: z.enum(['core_flow', 'adversarial', 'edge_case', 'compliance', 'multilingual']).default('core_flow'),
  prompt: z.string().min(1),
  referenceEvidence: z.array(z.string()).default([]),
  expectedTools: z.array(z.string()).optional(),
  forbiddenTools: z.array(z.string()).optional(),
  groundTruthOutput: z.string().optional(),
  minFaithfulness: z.number().min(0).max(1).default(0.70),
  maxAllowedLatencyMs: z.number().min(50).default(3000),
});

export const CreateDatasetRequestSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  version: z.string().default('1.0.0'),
  targetAgentId: z.string().min(1),
  testCases: z.array(GoldenTestCaseSchema).min(1),
});
export type CreateDatasetRequest = z.infer<typeof CreateDatasetRequestSchema>;

export const RunBenchmarkRequestSchema = z.object({
  modelId: z.string().default('gemini-2.5-flash'),
  promptVersion: z.string().default('v1.0'),
  concurrencyLimit: z.number().min(1).max(20).default(5),
});
export type RunBenchmarkRequest = z.infer<typeof RunBenchmarkRequestSchema>;

export const ListDatasetsQuerySchema = z.object({
  targetAgentId: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
});
export type ListDatasetsQuery = z.infer<typeof ListDatasetsQuerySchema>;

export const ListBenchmarksQuerySchema = z.object({
  datasetId: z.string().optional(),
  verdict: ReleaseGateVerdictEnum.optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
});
export type ListBenchmarksQuery = z.infer<typeof ListBenchmarksQuerySchema>;
