/**
 * Kriya Omnitask — Outcome Instrumentation & Blueprint KPI Framework Types
 * (docs/kriya WP-6.1, Blueprint §14, CLAUDE.md §35, §39; ADR-024)
 *
 * Defines the Blueprint KPI metric definitions, calculations, target ranges,
 * zero-fabrication honest baselines, cost-per-outcome data shapes, and
 * cost cascade (L0-L3) breakdown types.
 */

import { z } from 'zod';

export const MetricKeySchema = z.enum([
  'verified_action_rate',
  'resolution_rate',
  'tool_call_reliability',
  'recovery_rate',
  'escalation_rate',
  'cost_per_verified_outcome',
]);
export type MetricKey = z.infer<typeof MetricKeySchema>;

export const CascadeLevelSchema = z.enum([
  'L0_rule',
  'L1_cache',
  'L2_fast_model',
  'L3_reasoning_model',
  'human_review',
]);
export type CascadeLevel = z.infer<typeof CascadeLevelSchema>;

export const WindowTypeSchema = z.enum(['1h', '24h', '7d', '30d', 'custom']);
export type WindowType = z.infer<typeof WindowTypeSchema>;

export const MetricStatusSchema = z.enum(['healthy', 'warning', 'critical', 'unmeasured']);
export type MetricStatus = z.infer<typeof MetricStatusSchema>;

export const MetricUnitSchema = z.enum(['percentage', 'usd', 'count', 'ms', 'ratio']);
export type MetricUnit = z.infer<typeof MetricUnitSchema>;

/**
 * Metadata and evaluated result for a single KPI metric per CLAUDE.md §39
 */
export interface MetricDefinition {
  key: MetricKey;
  name: string;
  description: string;
  source: string;
  calculation: string;
  unit: MetricUnit;
  window: WindowType;
  targetRange: {
    min?: number;
    max?: number;
    healthyThreshold?: number;
    higherIsBetter: boolean;
  };
  /**
   * Actual evaluated value.
   * STRICT ZERO-FABRICATION RULE (S53): Must be null if sampleCount === 0.
   * Never fabricate 1.0 or 100% when no events occurred.
   */
  actualValue: number | null;
  numerator: number;
  sampleCount: number; // Denominator
  status: MetricStatus;
  drillDown?: Record<string, number | null>;
}

export interface CascadeLevelStats {
  level: CascadeLevel;
  count: number;
  percentage: number;
  costUsd: number;
  avgLatencyMs: number;
  resolvedCount: number;
}

export interface CascadeMixSummary {
  totalInvocations: number;
  levels: Record<CascadeLevel, CascadeLevelStats>;
  /**
   * Estimated USD saved by resolving with L0/L1/L2 instead of routing 100% to L3 frontier model.
   * Baseline assumed average L3 cost: $0.015 per call.
   */
  estimatedSavingsUsd: number;
  /**
   * Deflection rate: proportion of invocations resolved by $0 deterministic L0/L1 rules/cache.
   */
  l0L1DeflectionRate: number | null;
}

export interface AgentKpiRollup {
  agentId: string;
  name: string;
  runsCount: number;
  completedCount: number;
  resolutionRate: number | null;
  toolCallsCount: number;
  toolReliability: number | null;
  verifiedActionsCount: number;
  verifiedActionRate: number | null;
  escalationCount: number;
  escalationRate: number | null;
  totalCostUsd: number;
  costPerOutcomeUsd: number | null;
}

export interface WorkflowKpiRollup {
  workflowId: string;
  name: string;
  runsCount: number;
  completedCount: number;
  resolutionRate: number | null;
  recoveredCount: number;
  recoveryRate: number | null;
  escalationsCount: number;
  escalationRate: number | null;
  verifiedActionsCount: number;
  verifiedActionRate: number | null;
  totalCostUsd: number;
  costPerOutcomeUsd: number | null;
}

export interface ClientValueReport {
  tenantId: string;
  periodStart: string;
  periodEnd: string;
  window: WindowType;
  tasksCompleted: number;
  verifiedOutcomesCount: number;
  humanHoursAvoided: number;
  revenueInfluencedUsd: number;
  escalationsCount: number;
  totalCostUsd: number;
  costPerOutcomeUsd: number | null;
  netRoiMultiplier: number | null;
  topPerformingAgents: Array<{
    agentId: string;
    completedCount: number;
    verifiedRate: number | null;
    costUsd: number;
  }>;
}

export interface CostPerOutcomeReport {
  tenantId: string;
  window: WindowType;
  periodStart: string;
  periodEnd: string;
  overallCostPerOutcomeUsd: number | null;
  totalCostUsd: number;
  verifiedOutcomesCount: number;
  byWorkflow: Array<{
    workflowId: string;
    name: string;
    outcomesCount: number;
    totalCostUsd: number;
    costPerOutcomeUsd: number | null;
    verifiedActionRate: number | null;
  }>;
  byAgent: Array<{
    agentId: string;
    name: string;
    outcomesCount: number;
    totalCostUsd: number;
    costPerOutcomeUsd: number | null;
    toolReliability: number | null;
  }>;
  byModel: Array<{
    modelId: string;
    callsCount: number;
    totalCostUsd: number;
    tokensInput: number;
    tokensOutput: number;
    avgLatencyMs: number | null;
  }>;
  cascadeMix: CascadeMixSummary;
}

export interface BlueprintKpiOverview {
  tenantId: string;
  window: WindowType;
  evaluatedAt: string;
  periodStart: string;
  periodEnd: string;
  metrics: {
    verifiedActionRate: MetricDefinition;
    resolutionRate: MetricDefinition;
    toolCallReliability: MetricDefinition;
    recoveryRate: MetricDefinition;
    escalationRate: MetricDefinition;
    costPerVerifiedOutcome: MetricDefinition;
  };
  cascadeMix: CascadeMixSummary;
  clientValueReport: ClientValueReport;
  byAgent: Record<string, AgentKpiRollup>;
  byWorkflow: Record<string, WorkflowKpiRollup>;
}

// REST Request / Query Schemas
export const OutcomeKpiQuerySchema = z.object({
  window: WindowTypeSchema.default('24h'),
  agentId: z.string().optional(),
  workflowId: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  riskTier: z.enum(['T0', 'T1', 'T2', 'T3']).optional(),
});
export type OutcomeKpiQuery = z.infer<typeof OutcomeKpiQuerySchema>;

export const RecordCascadeEventSchema = z.object({
  runId: z.string().optional(),
  correlationId: z.string().optional(),
  agentId: z.string().min(1),
  workflowId: z.string().optional(),
  cascadeLevel: CascadeLevelSchema,
  modelId: z.string().optional(),
  resolved: z.boolean().default(true),
  latencyMs: z.number().nonnegative().default(0),
  inputTokens: z.number().int().nonnegative().default(0),
  outputTokens: z.number().int().nonnegative().default(0),
  costUsd: z.number().nonnegative().default(0),
  ruleName: z.string().optional(),
  details: z.record(z.string(), z.unknown()).default({}),
});
export type RecordCascadeEvent = z.input<typeof RecordCascadeEventSchema>;

export interface CascadeExecutionEventRecord {
  id: string;
  tenant_id: string;
  run_id?: string;
  correlation_id?: string;
  agent_id: string;
  workflow_id?: string;
  cascade_level: CascadeLevel;
  model_id?: string;
  resolved: number;
  latency_ms: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  rule_name?: string;
  details_json: string;
  created_at: string;
}

export interface OutcomeMetricsSnapshotRecord {
  id: string;
  tenant_id: string;
  window_type: WindowType;
  window_start: string;
  window_end: string;
  dimension_type: 'tenant' | 'agent' | 'workflow' | 'overall';
  dimension_id: string;
  metrics_json: string;
  calculated_at: string;
}
