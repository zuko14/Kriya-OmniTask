/**
 * Kriya AI — Policy-as-Code Engine Types & Schemas
 * Declarative condition trees, business invariant rules, and evaluation verdicts (§14, §16 of CLAUDE.md).
 */

import { z } from 'zod';

export const PolicyCategoryEnum = z.enum([
  'compliance',
  'financial',
  'privacy',
  'channel_governance',
  'operational',
]);
export type PolicyCategory = z.infer<typeof PolicyCategoryEnum>;

export const PolicySeverityEnum = z.enum(['INFO', 'WARN', 'BLOCK', 'ESCALATE']);
export type PolicySeverity = z.infer<typeof PolicySeverityEnum>;

export const PolicyActionEnum = z.enum([
  'ALLOW',
  'WARN',
  'BLOCK_ACTION',
  'REQUIRE_APPROVAL',
  'ESCALATE_TO_HUMAN',
]);
export type PolicyAction = z.infer<typeof PolicyActionEnum>;

export const ComparisonOperatorEnum = z.enum([
  'EQUALS',
  'NOT_EQUALS',
  'GREATER_THAN',
  'GREATER_THAN_OR_EQUAL',
  'LESS_THAN',
  'LESS_THAN_OR_EQUAL',
  'IN',
  'NOT_IN',
  'CONTAINS',
  'NOT_CONTAINS',
  'REGEX_MATCH',
  'EXISTS',
  'NOT_EXISTS',
]);
export type ComparisonOperator = z.infer<typeof ComparisonOperatorEnum>;

// ============================================================================
// Condition Expression Tree Schema
// ============================================================================

export interface SimpleCondition {
  field: string;
  operator: ComparisonOperator;
  value?: unknown;
}

export interface CompositeCondition {
  logical: 'AND' | 'OR' | 'NOT';
  conditions: Array<SimpleCondition | CompositeCondition>;
}

export type ConditionExpression = SimpleCondition | CompositeCondition;

export const SimpleConditionSchema = z.object({
  field: z.string().min(1),
  operator: ComparisonOperatorEnum,
  value: z.unknown().optional(),
});

export const ConditionExpressionSchema: z.ZodType<ConditionExpression> = z.lazy(() =>
  z.union([
    SimpleConditionSchema,
    z.object({
      logical: z.enum(['AND', 'OR', 'NOT']),
      conditions: z.array(ConditionExpressionSchema).min(1),
    }),
  ])
);

// ============================================================================
// Policy Rule Schema
// ============================================================================

export const PolicyRuleSchema = z.object({
  slug: z.string().min(2).max(64).regex(/^[a-z0-9_-]+$/),
  name: z.string().min(2).max(128),
  description: z.string().max(1024),
  category: PolicyCategoryEnum,
  severity: PolicySeverityEnum.default('BLOCK'),
  action: PolicyActionEnum.default('BLOCK_ACTION'),
  condition: ConditionExpressionSchema,
  isEnabled: z.boolean().default(true),
  isSystem: z.boolean().default(false),
});
export type PolicyRuleInput = z.input<typeof PolicyRuleSchema>;
export type PolicyRule = z.infer<typeof PolicyRuleSchema>;

export interface PolicyRuleRecord {
  id: string;
  tenant_id: string | null;
  slug: string;
  name: string;
  description: string;
  category: PolicyCategory;
  severity: PolicySeverity;
  action: PolicyAction;
  condition_json: string;
  is_enabled: number;
  is_system: number;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// Policy Evaluation & Violation Contracts
// ============================================================================

export interface PolicyViolation {
  ruleSlug: string;
  ruleName: string;
  category: PolicyCategory;
  severity: PolicySeverity;
  action: PolicyAction;
  message: string;
  failedCondition?: Record<string, unknown>;
}

export interface PolicyEvaluationResult {
  allowed: boolean;
  requiresApproval: boolean;
  escalated: boolean;
  verdict: 'PASS' | 'WARN' | 'BLOCKED' | 'ESCALATED';
  violations: PolicyViolation[];
  evaluatedRuleCount: number;
}

export interface PolicyEvaluationRecord {
  id: string;
  tenant_id: string;
  action_type: string;
  resource_id: string | null;
  actor_type: string;
  actor_id: string | null;
  evaluation_result: string;
  violations_json: string;
  context_snapshot_json: string;
  created_at: string;
  updated_at: string;
}
