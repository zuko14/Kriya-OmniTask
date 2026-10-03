/**
 * Kriya AI — Agent Simulation & Dry-Run Sandbox Type Definitions
 * Typed contracts for mock scenarios, virtual sandbox executions, and behavioral regression reports (§14, §17 of CLAUDE.md).
 */

import { z } from 'zod';
import { BaseEntity } from '../../storage/repositories/baseRepository.js';

export const ScenarioCategoryEnum = z.enum([
  'lead_qualification',
  'customer_support',
  'calendar_booking',
  'reactivation',
  'adversarial_test',
  'edge_case',
]);
export type ScenarioCategory = z.infer<typeof ScenarioCategoryEnum>;

export const SimulationRunModeEnum = z.enum(['dry_run', 'replay', 'synthetic']);
export type SimulationRunMode = z.infer<typeof SimulationRunModeEnum>;

export const SimulationRunStatusEnum = z.enum(['running', 'passed', 'failed', 'regression_detected']);
export type SimulationRunStatus = z.infer<typeof SimulationRunStatusEnum>;

export interface ExpectedOutcomes {
  expectedToolsCalled?: string[];
  forbiddenTools?: string[];
  expectedKeywords?: string[];
  prohibitedKeywords?: string[];
  expectedPolicyVerdict?: 'approved' | 'revise' | 'reject_escalate';
  maxAllowedLatencyMs?: number;
  maxAllowedCostUsd?: number;
}

export interface SimulatedToolCall {
  toolName: string;
  inputParameters: Record<string, unknown>;
  mockResponse: Record<string, unknown>;
  timestamp: string;
}

export interface ComparisonReport {
  overallResult: SimulationRunStatus;
  checksPassed: number;
  checksFailed: number;
  failureDetails: string[];
  toolSequenceMatch: boolean;
  policyComplianceMatch: boolean;
  latencyWithinBudget: boolean;
  costWithinBudget: boolean;
  metrics: {
    latencyMs: number;
    tokensUsed: number;
    costUsd: number;
  };
}

export interface SimulationScenarioRecord extends BaseEntity {
  organization_id: string;
  name: string;
  description: string;
  category: ScenarioCategory;
  target_agent_id: string;
  mock_customer_json: string;
  initial_message: string;
  conversation_history_json: string;
  mock_tool_responses_json: string;
  expected_outcomes_json: string;
}

export interface SimulationRunRecord extends BaseEntity {
  organization_id: string;
  scenario_id: string;
  run_mode: SimulationRunMode;
  status: SimulationRunStatus;
  simulated_output: string;
  simulated_tool_calls_json: string;
  policy_verdicts_json: string;
  comparison_report_json: string;
  latency_ms: number;
  tokens_used: number;
  cost_usd: number;
  started_at: string;
  completed_at?: string;
}

export const CreateScenarioRequestSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  category: ScenarioCategoryEnum,
  targetAgentId: z.string().min(1),
  mockCustomer: z.record(z.unknown()).default({}),
  initialMessage: z.string().min(1),
  conversationHistory: z.array(z.record(z.unknown())).default([]),
  mockToolResponses: z.record(z.unknown()).default({}),
  expectedOutcomes: z.object({
    expectedToolsCalled: z.array(z.string()).optional(),
    forbiddenTools: z.array(z.string()).optional(),
    expectedKeywords: z.array(z.string()).optional(),
    prohibitedKeywords: z.array(z.string()).optional(),
    expectedPolicyVerdict: z.enum(['approved', 'revise', 'reject_escalate']).optional(),
    maxAllowedLatencyMs: z.number().optional(),
    maxAllowedCostUsd: z.number().optional(),
  }).default({}),
});
export type CreateScenarioRequest = z.infer<typeof CreateScenarioRequestSchema>;

export const RunScenarioRequestSchema = z.object({
  runMode: SimulationRunModeEnum.default('dry_run'),
  overridePrompt: z.string().optional(),
  overrideModelId: z.string().optional(),
});
export type RunScenarioRequest = z.infer<typeof RunScenarioRequestSchema>;

export const ListScenariosQuerySchema = z.object({
  category: ScenarioCategoryEnum.optional(),
  targetAgentId: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
});
export type ListScenariosQuery = z.infer<typeof ListScenariosQuerySchema>;

export const ListRunsQuerySchema = z.object({
  scenarioId: z.string().optional(),
  status: SimulationRunStatusEnum.optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
});
export type ListRunsQuery = z.infer<typeof ListRunsQuerySchema>;
