/**
 * Kriya Omnitask — Error-Budget Autonomy Throttling Types & Contracts
 * (CLAUDE.md §15, §37; Blueprint §14; docs/kriya WP-6.3, ADR-026)
 *
 * Defines mathematical error-budget boundaries, SLA targets per risk tier,
 * stateful budget tracking, automated step-down throttling, and human review restoration.
 */

import { z } from 'zod';
import { ActionTier, ActionTierSchema } from '../../runtime/graph/types.js';

/**
 * Standard SLA targets and allowed error budgets per risk tier.
 * Based on CLAUDE.md §37:
 * - T0 (Inform): 100% (read-only, no consequential actions)
 * - T1 (Reversible): 95.0% SLA (5.0% error budget)
 * - T2 (Consequential / Pre-approved): 99.0% SLA (1.0% error budget)
 * - T3 (Irreversible / Critical): 99.9% SLA (0.1% error budget)
 */
export const TIER_SLA_CONFIG: Record<ActionTier, { targetSlaRate: number; allowedErrorBudget: number }> = {
  T0: { targetSlaRate: 1.0, allowedErrorBudget: 0.0 },
  T1: { targetSlaRate: 0.95, allowedErrorBudget: 0.05 },
  T2: { targetSlaRate: 0.99, allowedErrorBudget: 0.01 },
  T3: { targetSlaRate: 0.999, allowedErrorBudget: 0.001 },
};

/**
 * Configuration options for the error budget evaluation engine.
 */
export interface ErrorBudgetEngineConfig {
  /** Minimum sample count in the window before budget exhaustion triggers a step-down (default: 3). */
  minSampleSize: number;
  /** Consecutive verification failures triggering an immediate tripwire throttle regardless of sample size (default: 2). */
  consecutiveFailureTripwire: number;
  /** Budget burn rate percentage that triggers throttling (default: 100%). */
  throttleBurnPercent: number;
  /** Budget burn rate percentage that triggers an audited warning (default: 75%). */
  warningBurnPercent: number;
  /** Rolling window duration in hours for computing error rate (default: 24). */
  windowHours: number;
}

export const DEFAULT_ERROR_BUDGET_CONFIG: ErrorBudgetEngineConfig = {
  minSampleSize: 3,
  consecutiveFailureTripwire: 2,
  throttleBurnPercent: 100.0,
  warningBurnPercent: 75.0,
  windowHours: 24,
};

/**
 * Database record representing the current error budget and autonomy state for an agent.
 */
export interface AgentErrorBudgetRecord {
  id: string;
  tenant_id: string;
  agent_slug: string;
  configured_tier_cap: ActionTier;
  effective_tier_cap: ActionTier;
  is_throttled: boolean;
  target_sla_rate: number;
  allowed_error_budget: number;
  current_error_rate: number;
  burned_budget_percent: number;
  sample_count: number;
  failure_count: number;
  consecutive_failures: number;
  throttled_at: string | null;
  throttled_reason: string | null;
  restored_at: string | null;
  restored_by: string | null;
  last_evaluated_at: string;
  created_at: string;
  updated_at: string;
}

export type AutonomyEventType = 'throttled' | 'restored' | 'budget_warning' | 'evaluated';

/**
 * Immutable audit trail of autonomy transitions.
 */
export interface AutonomyEventRecord {
  id: string;
  tenant_id: string;
  agent_slug: string;
  event_type: AutonomyEventType;
  from_tier: ActionTier;
  to_tier: ActionTier;
  burned_budget_percent: number;
  reason: string;
  actor: string;
  evidence_json: string;
  created_at: string;
}

/**
 * Result of evaluating an agent's error budget.
 */
export interface ThrottleEvaluationResult {
  tenantId: string;
  agentSlug: string;
  configuredTier: ActionTier;
  effectiveTier: ActionTier;
  isThrottled: boolean;
  stateChanged: boolean;
  action: 'throttled' | 'unchanged' | 'warning';
  metrics: {
    sampleCount: number;
    failureCount: number;
    consecutiveFailures: number;
    verifiedActionRate: number | null;
    targetSlaRate: number;
    allowedErrorBudget: number;
    currentErrorRate: number;
    burnedBudgetPercent: number;
    unmeasured: boolean;
  };
  reason?: string;
  attentionItemId?: string;
  evaluatedAt: string;
}

/**
 * Request schema for human restoration of autonomy.
 */
export const RestoreAutonomyRequestSchema = z.object({
  agentSlug: z.string().min(1),
  restoredBy: z.string().min(1),
  reason: z.string().min(5, { message: 'Restoration reason must be at least 5 characters explaining human review' }),
  targetTier: ActionTierSchema.optional(),
  verifyFirst: z.boolean().default(false),
});
export type RestoreAutonomyRequest = z.infer<typeof RestoreAutonomyRequestSchema>;
export type RestoreAutonomyInput = z.input<typeof RestoreAutonomyRequestSchema>;

/**
 * Request schema for evaluating an agent or fleet.
 */
export const EvaluateAutonomyRequestSchema = z.object({
  agentSlug: z.string().optional(),
  windowHours: z.number().positive().max(168).optional(),
  force: z.boolean().default(false),
});
export type EvaluateAutonomyRequest = z.infer<typeof EvaluateAutonomyRequestSchema>;
