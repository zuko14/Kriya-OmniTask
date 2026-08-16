/**
 * Xylarc AI — Human Attention Center & Priority Exception Queue Type Definitions
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
});
export type CreateAttentionItemRequest = z.infer<typeof CreateAttentionItemRequestSchema>;

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
  limit: z.coerce.number().min(1).max(100).default(50),
});
export type ListAttentionItemsQuery = z.infer<typeof ListAttentionItemsQuerySchema>;
