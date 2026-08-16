/**
 * Xylarc AI — Workflow DAG Engine Type Definitions & Schemas
 * Typed contracts for multi-step DAG pipelines, step types, and human approval steps (§13, §15 of CLAUDE.md).
 */

import { z } from 'zod';
import { ConditionExpressionSchema } from '../../policy/types/policyTypes.js';

// ============================================================================
// Step Types & Configurations
// ============================================================================

export const StepTypeEnum = z.enum([
  'agent_task',
  'tool_execution',
  'policy_check',
  'human_approval',
  'conditional_branch',
  'delay',
]);

export type StepType = z.infer<typeof StepTypeEnum>;

export const AgentTaskConfigSchema = z.object({
  agentSlug: z.string().min(1),
  objective: z.string().min(1),
  inputData: z.record(z.unknown()).optional(),
});

export const ToolExecutionConfigSchema = z.object({
  toolName: z.string().min(1),
  params: z.record(z.unknown()).default({}),
});

export const PolicyCheckConfigSchema = z.object({
  category: z.enum(['compliance', 'financial', 'privacy', 'channel_governance', 'operational']).optional(),
  context: z.record(z.unknown()).default({}),
});

export const HumanApprovalConfigSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  requiredRole: z.string().default('admin'),
  payload: z.record(z.unknown()).optional(),
});

export const ConditionalBranchConfigSchema = z.object({
  condition: ConditionExpressionSchema,
  ifTrueNextStepId: z.string().optional(),
  ifFalseNextStepId: z.string().optional(),
});

export const DelayConfigSchema = z.object({
  delayMs: z.number().nonnegative().default(100),
});

export const DAGStepSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: StepTypeEnum,
  dependsOn: z.array(z.string()).default([]),
  config: z.record(z.unknown()),
});

export type DAGStep = z.infer<typeof DAGStepSchema>;

export const DAGDefinitionSchema = z.object({
  steps: z.array(DAGStepSchema).min(1),
});

export type DAGDefinition = z.infer<typeof DAGDefinitionSchema>;

// ============================================================================
// Workflow Definition Schemas
// ============================================================================

export const WorkflowDefinitionSchema = z.object({
  slug: z.string().regex(/^[a-z0-9_-]+$/),
  name: z.string().min(1).max(255),
  description: z.string().min(1).max(1000),
  triggerType: z.enum(['manual', 'webhook', 'event', 'schedule']).default('manual'),
  dag: DAGDefinitionSchema,
  isActive: z.boolean().default(true),
  version: z.string().default('1.0.0'),
});

export type WorkflowDefinitionInput = z.input<typeof WorkflowDefinitionSchema>;

export interface WorkflowDefinitionRecord {
  id: string;
  tenant_id: string;
  slug: string;
  name: string;
  description: string;
  trigger_type: string;
  dag_json: string;
  is_active: number;
  version: string;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// Workflow Execution & Step State
// ============================================================================

export const ExecutionStatusEnum = z.enum([
  'pending',
  'running',
  'waiting_for_approval',
  'completed',
  'failed',
  'cancelled',
  'rejected',
]);

export type ExecutionStatus = z.infer<typeof ExecutionStatusEnum>;

export interface StepExecutionResult {
  stepId: string;
  stepName: string;
  type: StepType;
  status: 'completed' | 'failed' | 'waiting_for_approval' | 'skipped';
  output?: Record<string, unknown> | unknown;
  error?: string;
  durationMs: number;
  executedAt: string;
}

export interface WorkflowExecutionRecord {
  id: string;
  tenant_id: string;
  workflow_id: string;
  correlation_id: string | null;
  status: ExecutionStatus;
  current_step_id: string | null;
  context_data_json: string;
  step_results_json: string;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// Workflow Approval Request
// ============================================================================

export const ApprovalStatusEnum = z.enum(['pending', 'approved', 'rejected']);
export type ApprovalStatus = z.infer<typeof ApprovalStatusEnum>;

export interface WorkflowApprovalRequestRecord {
  id: string;
  tenant_id: string;
  execution_id: string;
  step_id: string;
  status: ApprovalStatus;
  required_role: string;
  step_payload_json: string;
  decision_by: string | null;
  decision_notes: string | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
}
