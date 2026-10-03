import { z } from 'zod';

/**
 * 8 Defined Failure Classes from CLAUDE1.md §5:
 * - transient: network glitches, rate limits, timeouts -> retry with backoff
 * - bad_input: missing parameters, malformed values -> re-request / re-extract, re-dispatch
 * - tool_failure: tool execution error, third-party 500 -> fallback tool or alternate agent
 * - model_failure: model 500, non-JSON response, bad tool call -> fallback certified model
 * - capability_gap: model unable to reason at required tier -> route-up or escalate (never retry same tier)
 * - scope_mismatch: task outside specialist domain -> re-dispatch to correct specialist
 * - policy_block: firewall violation, forbidden action -> STOP; correct refusal, not a bug
 * - critical_action: failure during CRITICAL risk action -> immediate escalation without any retry
 */
export const FailureClassSchema = z.enum([
  'transient',
  'bad_input',
  'tool_failure',
  'model_failure',
  'capability_gap',
  'scope_mismatch',
  'policy_block',
  'critical_action',
]);
export type FailureClass = z.infer<typeof FailureClassSchema>;

export const EscalationLevelSchema = z.enum([
  'specialist',
  'supervisor',
  'orchestrator',
  'attention',
]);
export type EscalationLevel = z.infer<typeof EscalationLevelSchema>;

export const RemediationActionSchema = z.enum([
  'retry_with_backoff',
  're_request_re_extract',
  'fallback_tool_alternate_agent',
  'fallback_certified_model',
  'route_up',
  'redispatch_specialist',
  'policy_stop',
  'immediate_escalate',
]);
export type RemediationAction = z.infer<typeof RemediationActionSchema>;

export const RiskTierSchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
export type RiskTier = z.infer<typeof RiskTierSchema>;

export const StructuredFailureRecordSchema = z.object({
  id: z.string().default(() => `fail_${Date.now()}`),
  tenantId: z.string(),
  taskId: z.string(),
  correlationId: z.string(),
  agentId: z.string(),
  agentSlug: z.string(),
  failureClass: FailureClassSchema,
  stage: z.string(),
  errorMessage: z.string(),
  attemptsCount: z.number().int().min(1).default(1),
  inputsHash: z.string(),
  toolResponses: z.record(z.unknown()).default({}),
  confidence: z.number().min(0).max(1).default(0.0),
  recoverable: z.boolean().default(true),
  riskTier: RiskTierSchema.default('LOW'),
  isIdempotent: z.boolean().default(true),
  remediationStatus: z.enum([
    'pending',
    'remediated',
    'escalated_to_supervisor',
    'escalated_to_orchestrator',
    'escalated_to_attention',
    'stopped_by_policy',
  ]).default('pending'),
  escalationLevel: EscalationLevelSchema.default('specialist'),
  metadata: z.record(z.unknown()).default({}),
  createdAt: z.string().default(() => new Date().toISOString()),
  updatedAt: z.string().default(() => new Date().toISOString()),
});
export type StructuredFailureRecord = z.infer<typeof StructuredFailureRecordSchema>;
export type CreateStructuredFailureInput = z.input<typeof StructuredFailureRecordSchema>;

export const EscalationTraceStepSchema = z.object({
  stepNumber: z.number().int().min(1),
  timestamp: z.string(),
  level: EscalationLevelSchema,
  actor: z.string(),
  action: z.string(),
  failureClass: FailureClassSchema.optional(),
  remediationAttempted: RemediationActionSchema.optional(),
  outcome: z.enum(['success', 'failure', 'escalated', 'stopped']),
  evidence: z.record(z.unknown()).default({}),
  reason: z.string().optional(),
  durationMs: z.number().default(0),
  costUsd: z.number().default(0.0),
});
export type EscalationTraceStep = z.infer<typeof EscalationTraceStepSchema>;

export const EscalationTraceRecordSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  taskId: z.string(),
  correlationId: z.string(),
  currentLevel: EscalationLevelSchema,
  status: z.enum(['in_progress', 'resolved', 'escalated_to_attention', 'stopped_by_policy']),
  totalAttempts: z.number().int().min(0).default(0),
  totalDurationMs: z.number().default(0),
  totalCostUsd: z.number().default(0.0),
  steps: z.array(EscalationTraceStepSchema).default([]),
  attentionItemId: z.string().optional().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type EscalationTraceRecord = z.infer<typeof EscalationTraceRecordSchema>;

/**
 * Enforced attempt, duration, and cost ceilings per level (§5, §23)
 */
export interface LevelBudgetLimits {
  maxAttempts: number;
  maxDurationMs: number;
  maxCostUsd: number;
}

export const DEFAULT_BUDGET_CEILINGS: Record<EscalationLevel, LevelBudgetLimits> = {
  specialist: {
    maxAttempts: 3,
    maxDurationMs: 10000,
    maxCostUsd: 0.05,
  },
  supervisor: {
    maxAttempts: 2,
    maxDurationMs: 15000,
    maxCostUsd: 0.10,
  },
  orchestrator: {
    maxAttempts: 1,
    maxDurationMs: 20000,
    maxCostUsd: 0.20,
  },
  attention: {
    maxAttempts: 0,
    maxDurationMs: 0,
    maxCostUsd: 0.0,
  },
};

export interface RemediationResult {
  success: boolean;
  actionTaken: RemediationAction;
  nextLevel: EscalationLevel;
  remediatedOutput?: Record<string, unknown>;
  remediationNotes: string;
  costUsd: number;
  durationMs: number;
  attentionItemId?: string;
}
