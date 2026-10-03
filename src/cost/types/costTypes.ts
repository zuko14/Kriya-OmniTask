/**
 * Kriya AI — Cost Intelligence Contracts & Types
 * Ground-truth cost attribution, business outcome unit economics, and hard budget policies.
 */

import { z } from 'zod';

export const CostCategorySchema = z.enum([
  'token_llm',
  'voice_telephony',
  'api_tool',
  'vector_search',
  'compute_sandbox',
]);
export type CostCategory = z.infer<typeof CostCategorySchema>;

export const CostProviderSchema = z.enum([
  'google',
  'openai',
  'anthropic',
  'deepseek',
  'local',
  'openrouter',
  'meta',
  'twilio',
  'elevenlabs',
  'livekit',
  'clearbit',
  'stripe',
  'custom_api',
]);
export type CostProvider = z.infer<typeof CostProviderSchema>;

export const OutcomeTypeSchema = z.enum([
  'lead_qualified',
  'invoice_processed',
  'incident_resolved',
  'meeting_scheduled',
  'support_ticket_closed',
  'contract_analyzed',
  'custom_outcome',
]);
export type OutcomeType = z.infer<typeof OutcomeTypeSchema>;

export const OutcomeStatusSchema = z.enum(['achieved', 'failed', 'aborted']);
export type OutcomeStatus = z.infer<typeof OutcomeStatusSchema>;

export const HardCapActionSchema = z.enum([
  'circuit_break_reject',
  'degrade_to_cheapest_model',
  'notify_only',
]);
export type HardCapAction = z.infer<typeof HardCapActionSchema>;

// Record Ingestion Schema
export const RecordCostRequestSchema = z.object({
  agentId: z.string().min(1),
  workflowExecutionId: z.string().optional(),
  taskId: z.string().min(1),
  costCategory: CostCategorySchema,
  provider: CostProviderSchema,
  resourceMetricName: z.string().min(1), // e.g. 'prompt_tokens', 'voice_minutes'
  resourceQuantity: z.number().positive(),
  unitCostUsd: z.number().nonnegative(),
  outcomeId: z.string().optional(),
});
export type RecordCostRequest = z.infer<typeof RecordCostRequestSchema>;

export interface CostAttributionRecord {
  id: string;
  tenantId: string;
  organizationId: string;
  agentId: string;
  workflowExecutionId?: string;
  taskId: string;
  costCategory: CostCategory;
  provider: CostProvider;
  resourceMetricName: string;
  resourceQuantity: number;
  unitCostUsd: number;
  totalCostUsd: number;
  outcomeId?: string;
  createdAt: string;
}

// Business Outcome Schema
export const RecordOutcomeRequestSchema = z.object({
  agentId: z.string().min(1),
  workflowExecutionId: z.string().optional(),
  outcomeType: OutcomeTypeSchema,
  outcomeStatus: OutcomeStatusSchema.default('achieved'),
  valueGeneratedUsd: z.number().nonnegative().default(0.0),
  taskIds: z.array(z.string()).default([]), // Tasks to attribute to this outcome
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export type RecordOutcomeRequest = z.infer<typeof RecordOutcomeRequestSchema>;

export interface BusinessOutcomeRecord {
  id: string;
  tenantId: string;
  organizationId: string;
  agentId: string;
  workflowExecutionId?: string;
  outcomeType: OutcomeType;
  outcomeStatus: OutcomeStatus;
  valueGeneratedUsd: number;
  totalCostUsd: number;
  roiMultiplier: number;
  outcomeMetadata: Record<string, unknown>;
  createdAt: string;
}

// Budget Policy Schema
export const UpdateBudgetPolicyRequestSchema = z.object({
  monthlyBudgetUsd: z.number().positive(),
  dailyBudgetUsd: z.number().positive(),
  warningThresholdPct: z.number().min(1).max(100).default(80.0),
  hardCapAction: HardCapActionSchema.default('circuit_break_reject'),
});
export type UpdateBudgetPolicyRequest = z.infer<typeof UpdateBudgetPolicyRequestSchema>;

export interface TenantBudgetPolicy {
  id: string;
  tenantId: string;
  organizationId: string;
  monthlyBudgetUsd: number;
  dailyBudgetUsd: number;
  warningThresholdPct: number;
  hardCapAction: HardCapAction;
  currentMonthSpendUsd: number;
  currentDaySpendUsd: number;
  isCircuitBroken: boolean;
  lastResetAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface BudgetEvaluationResult {
  allowed: boolean;
  reason?: string;
  actionTaken: 'proceed' | 'warning' | 'circuit_break' | 'degraded_mode';
  monthlyUtilizationPct: number;
  dailyUtilizationPct: number;
}

export interface UnitEconomicsSummary {
  outcomeType: OutcomeType;
  totalCount: number;
  achievedCount: number;
  successRatePct: number;
  totalCostUsd: number;
  totalValueGeneratedUsd: number;
  avgCostPerOutcomeUsd: number;
  avgRoiMultiplier: number;
}

export interface SpendBreakdown {
  totalSpendUsd: number;
  byCategory: Record<CostCategory, number>;
  byProvider: Record<CostProvider, number>;
  byAgent: Record<string, number>;
  activePolicy: TenantBudgetPolicy | null;
  utilization: {
    monthlyPct: number;
    dailyPct: number;
    status: 'normal' | 'warning' | 'circuit_broken';
  };
}
