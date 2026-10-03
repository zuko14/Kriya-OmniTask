/**
 * Kriya AI — Human Attention Center & Priority Exception Queue Type Definitions
 * Typed contracts for human escalation items, SLAs, and live conversation takeovers (§14, §16 of CLAUDE.md).
 */

import { z } from 'zod';
import { BaseEntity } from '../../storage/repositories/baseRepository.js';

export const AttentionReasonCategoryEnum = z.enum([
  'policy_violation',
  'low_confidence',
  'financial_threshold',
  'sensitive_complaint',
  'security_anomaly',
  'agent_disagreement',
  'workflow_suspended',
  'manual_flag',
  'slo_burn',
]);
export type AttentionReasonCategory = z.infer<typeof AttentionReasonCategoryEnum>;

export const AttentionPriorityEnum = z.enum(['P0_CRITICAL', 'P1_HIGH', 'P2_MEDIUM', 'P3_LOW']);
export type AttentionPriority = z.infer<typeof AttentionPriorityEnum>;

export const AttentionStatusEnum = z.enum(['pending', 'claimed', 'resolved', 'dismissed', 'timed_out']);
export type AttentionStatus = z.infer<typeof AttentionStatusEnum>;

export const ResolutionActionEnum = z.enum(['approved', 'rejected', 'overridden', 'taken_over', 'dismissed']);
export type ResolutionAction = z.infer<typeof ResolutionActionEnum>;

export interface AttentionItemRecord extends BaseEntity {
  organization_id: string;
  correlation_id: string;
  trace_id?: string;
  customer_id?: string;
  channel: string;
  source_agent_id: string;
  title: string;
  description: string;
  reason_category: AttentionReasonCategory;
  priority: AttentionPriority;
  status: AttentionStatus;
  assigned_user_id?: string;
  assigned_role?: string;
  branch_id?: string;
  routed_at?: string;
  routing_rule_id?: string;
  after_hours?: number;
  next_available_at?: string;
  context_data_json: string;
  recommended_action?: string;
  resolution_action?: ResolutionAction;
  resolution_notes?: string;
  sla_expires_at: string;
  resolved_at?: string;
}

export interface ConversationTakeoverRecord extends BaseEntity {
  organization_id: string;
  customer_id: string;
  channel: string;
  taken_over_by_user_id: string;
  is_active: number | boolean;
  reason: string;
  started_at: string;
  ended_at?: string;
}

export const CreateAttentionItemRequestSchema = z.object({
  correlationId: z.string().min(1),
  traceId: z.string().optional(),
  customerId: z.string().optional(),
  channel: z.string().default('whatsapp'),
  sourceAgentId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  reasonCategory: AttentionReasonCategoryEnum,
  priority: AttentionPriorityEnum.optional(),
  contextData: z.record(z.unknown()).default({}),
  recommendedAction: z.string().optional(),
  financialValueUsd: z.number().optional(),
  assignedRole: z.string().optional(),
  branchId: z.string().optional(),
});
export type CreateAttentionItemRequest = z.input<typeof CreateAttentionItemRequestSchema>;

export const ResolveAttentionItemRequestSchema = z.object({
  action: ResolutionActionEnum,
  notes: z.string().optional(),
  overridePayload: z.record(z.unknown()).optional(),
});
export type ResolveAttentionItemRequest = z.infer<typeof ResolveAttentionItemRequestSchema>;

export const StartTakeoverRequestSchema = z.object({
  customerId: z.string().min(1),
  channel: z.string().default('whatsapp'),
  reason: z.string().min(1),
});
export type StartTakeoverRequest = z.infer<typeof StartTakeoverRequestSchema>;

export interface AttentionMetricsOverview {
  totalItems: number;
  pendingCount: number;
  claimedCount: number;
  resolvedCount: number;
  slaBreachCount: number;
  activeTakeoversCount: number;
  avgResolutionMinutes: number;
}

export const ListAttentionItemsQuerySchema = z.object({
  status: AttentionStatusEnum.optional(),
  priority: AttentionPriorityEnum.optional(),
  reasonCategory: AttentionReasonCategoryEnum.optional(),
  assignedUserId: z.string().optional(),
  assignedRole: z.string().optional(),
  branchId: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
});
export type ListAttentionItemsQuery = z.infer<typeof ListAttentionItemsQuerySchema>;

// ============================================================================
// Branch & Location Contracts (docs/kriya WP-4.6)
// ============================================================================

export interface BranchRecord extends BaseEntity {
  name: string;
  code?: string | null;
  timezone: string;
  working_hours_json: string;
  emergency_role: string;
  active: number;
}

export const CreateBranchSchema = z.object({
  name: z.string().min(1).max(120),
  code: z.string().max(32).optional(),
  timezone: z.string().default('Asia/Kolkata'),
  workingHours: z.record(
    z.array(z.tuple([z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)]))
  ),
  emergencyRole: z.string().default('emergency_on_call'),
});
export type CreateBranchInput = z.input<typeof CreateBranchSchema>;

// ============================================================================
// Attention Routing Rule Contracts (docs/kriya WP-4.6)
// ============================================================================

export interface RoutingCondition {
  reasonCategories?: AttentionReasonCategory[];
  sourceAgents?: string[];
  priorities?: AttentionPriority[];
  departments?: string[];
  intents?: string[];
}

export interface AttentionRoutingRuleRecord extends BaseEntity {
  name: string;
  priority_order: number;
  conditions_json: string;
  target_role: string;
  target_user_id?: string | null;
  branch_id?: string | null;
  active: number;
}

export const CreateRoutingRuleSchema = z.object({
  name: z.string().min(1).max(120),
  priorityOrder: z.number().int().default(100),
  conditions: z.object({
    reasonCategories: z.array(AttentionReasonCategoryEnum).optional(),
    sourceAgents: z.array(z.string()).optional(),
    priorities: z.array(AttentionPriorityEnum).optional(),
    departments: z.array(z.string()).optional(),
    intents: z.array(z.string()).optional(),
  }),
  targetRole: z.string().min(1).max(64),
  targetUserId: z.string().optional(),
  branchId: z.string().optional(),
});
export type CreateRoutingRuleInput = z.input<typeof CreateRoutingRuleSchema>;

// ============================================================================
// Verification Job Contracts (docs/kriya WP-4.6, WP-3.4)
// ============================================================================

export const VerificationJobStatusEnum = z.enum(['pending', 'verified', 'mismatch', 'expired']);
export type VerificationJobStatus = z.infer<typeof VerificationJobStatusEnum>;

export interface VerificationJobRecord extends BaseEntity {
  run_id: string;
  tool_slug: string;
  action_input_json: string;
  action_output_json: string;
  idempotency_key: string;
  status: VerificationJobStatus;
  attempts: number;
  max_attempts: number;
  deadline_at: string;
  next_check_at: string;
  observed_state_json?: string | null;
  error_message?: string | null;
}

export const CreateVerificationJobSchema = z.object({
  runId: z.string().min(1),
  toolSlug: z.string().min(1),
  actionInput: z.record(z.unknown()),
  actionOutput: z.record(z.unknown()),
  idempotencyKey: z.string().min(1),
  maxAttempts: z.number().int().default(5),
  deadlineMinutes: z.number().int().default(60),
  intervalSeconds: z.number().int().default(30),
});
export type CreateVerificationJobInput = z.input<typeof CreateVerificationJobSchema>;

