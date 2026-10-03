/**
 * Kriya AI — Agent Types & Zod Validation Schemas
 * Defines formal agent specifications, lifecycle states, and structured output contracts (§12, §15, §17, §39 of CLAUDE.md).
 */

import { z } from 'zod';
import { BaseEntity } from '../../storage/repositories/baseRepository.js';

// ============================================================================
// Enums and Constant Unions
// ============================================================================

export const AgentCategoryEnum = z.enum(['orchestrator', 'manager', 'specialist', 'verifier']);
export type AgentCategory = z.infer<typeof AgentCategoryEnum>;

export const DepartmentEnum = z.enum([
  'executive',
  'sales',
  'support',
  'operations',
  'marketing',
  'finance',
  'general',
]);
export type Department = z.infer<typeof DepartmentEnum>;

export const AutonomyLevelEnum = z.union([
  z.literal(0), // Observe: Analyze, summarize, recommend — no external action
  z.literal(1), // Suggest: Prepares actions, requires human approval
  z.literal(2), // Low-risk Autonomous: Executes pre-approved low-risk actions
  z.literal(3), // Conditional Autonomous: Executes within explicit thresholds
  z.literal(4), // High Autonomy: Executes multi-step workflows within strict policy boundaries
  z.literal(5), // Strategic Autonomy: Reserved for carefully governed enterprise use cases
]);
export type AutonomyLevel = z.infer<typeof AutonomyLevelEnum>;

export const RiskTierEnum = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
export type RiskTier = z.infer<typeof RiskTierEnum>;

export const AgentLifecycleStateEnum = z.enum(['draft', 'idle', 'active', 'paused', 'error']);
export type AgentLifecycleState = z.infer<typeof AgentLifecycleStateEnum>;

export const AgentTransitionActionEnum = z.enum([
  'publish',       // draft -> idle
  'activate',      // idle -> active
  'complete_task', // active -> idle
  'pause',         // active | idle -> paused
  'resume',        // paused -> idle
  'trip_error',    // * -> error
  'recover',       // error -> idle
]);
export type AgentTransitionAction = z.infer<typeof AgentTransitionActionEnum>;

// ============================================================================
// Agent Configuration Specification Schema (§39 of CLAUDE.md)
// ============================================================================

export const ModelPolicySchema = z.object({
  primaryModel: z.string().default('gemini-2.5-pro'),
  fallbackModel: z.string().default('gemini-2.5-flash').optional(),
  temperature: z.number().min(0).max(2).default(0.2),
  maxTokens: z.number().int().positive().default(4096),
});
export type ModelPolicy = z.infer<typeof ModelPolicySchema>;

export const EscalationRulesSchema = z.object({
  triggers: z.array(z.string()).default([
    'confidence_below_threshold',
    'policy_violation_detected',
    'high_risk_action_unapproved',
    'customer_sentiment_critical',
  ]),
  escalationTarget: z.enum(['human', 'manager_agent']).default('human'),
  minConfidenceThreshold: z.number().min(0).max(1).default(0.75),
});
export type EscalationRules = z.infer<typeof EscalationRulesSchema>;

export const AgentLimitsSchema = z.object({
  maxConcurrentTasks: z.number().int().positive().default(10),
  maxCostPerExecutionUsd: z.number().positive().default(0.50),
  timeoutMs: z.number().int().positive().default(30000),
  maxDailyOutreachPerCustomer: z.number().int().positive().default(3),
});
export type AgentLimits = z.infer<typeof AgentLimitsSchema>;

export const AgentConfigSchema = z.object({
  systemPrompt: z.string().min(10),
  tools: z.array(z.string()).default([]),
  dataAccessScope: z.array(z.string()).default(['public', 'crm_read']),
  modelPolicy: ModelPolicySchema.default({}),
  /** Capability tier the agent's work needs; the Model Gateway only uses models certified for it. */
  capabilityTier: z.enum(['T1', 'T2', 'T3', 'T4']).default('T2'),
  escalationRules: EscalationRulesSchema.default({}),
  limits: AgentLimitsSchema.default({}),
  verificationApproach: z.enum(['deterministic', 'llm_evaluator', 'dual_model']).default('deterministic'),
  owner: z.string().default('platform_admin'),
  rollbackVersion: z.string().optional(),
});
export type AgentConfig = z.infer<typeof AgentConfigSchema>;
export type AgentConfigInput = z.input<typeof AgentConfigSchema>;

export const AgentSpecificationSchema = z.object({
  slug: z.string().min(2).max(64).regex(/^[a-z0-9_-]+$/),
  name: z.string().min(2).max(128),
  description: z.string().max(1024).optional(),
  category: AgentCategoryEnum,
  department: DepartmentEnum.default('general'),
  autonomyLevel: AutonomyLevelEnum.default(1),
  riskTier: RiskTierEnum.default('LOW'),
  version: z.string().regex(/^\d+\.\d+\.\d+$/).default('1.0.0'),
  isSystem: z.boolean().default(false),
  config: AgentConfigSchema,
});
export type AgentSpecification = z.infer<typeof AgentSpecificationSchema>;
export type AgentSpecificationInput = z.input<typeof AgentSpecificationSchema>;
export type ModelPolicyInput = z.input<typeof ModelPolicySchema>;

// ============================================================================
// Structured Agent Output Contract (§12 of CLAUDE.md)
// ============================================================================

export const EvidenceItemSchema = z.object({
  source: z.string(),
  timestamp: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  referenceId: z.string().optional(),
});
export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;

export const StructuredAgentOutputSchema = z.object({
  taskId: z.string(),
  status: z.enum(['completed', 'failed', 'escalated', 'needs_approval']),
  facts: z.array(z.string()).default([]),
  evidence: z.array(EvidenceItemSchema).default([]),
  confidence: z.number().min(0).max(1),
  recommendedAction: z.string(),
  risks: z.array(z.string()).default([]),
  policyFlags: z.array(z.string()).default([]),
  requiresApproval: z.boolean().default(false),
  details: z.record(z.unknown()).default({}),
});
export type StructuredAgentOutput = z.infer<typeof StructuredAgentOutputSchema>;

// ============================================================================
// Database Entity Records
// ============================================================================

export interface AgentRecord extends BaseEntity {
  slug: string;
  name: string;
  description?: string;
  category: AgentCategory;
  department: Department;
  autonomy_level: AutonomyLevel;
  risk_tier: RiskTier;
  status: AgentLifecycleState;
  version: string;
  is_system: number;
  config_json: string;
}

export interface AgentLifecycleEventRecord extends BaseEntity {
  agent_id: string;
  from_state: AgentLifecycleState;
  to_state: AgentLifecycleState;
  transition: AgentTransitionAction;
  reason: string;
  actor_type: 'human_operator' | 'agent' | 'system' | 'circuit_breaker';
  actor_id?: string;
  metadata_json: string;
}

export interface AgentExecutionRecord extends BaseEntity {
  agent_id: string;
  correlation_id: string;
  task_id: string;
  input_json: string;
  output_json?: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'escalated';
  confidence_score?: number;
  cost_usd: number;
  duration_ms: number;
  error_message?: string;
}
