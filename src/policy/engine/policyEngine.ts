/**
 * Kriya AI — Deterministic Policy-as-Code Engine
 * Evaluates business policies, enforces compliance boundaries, and records verifiable audit trails (§14, §16 of CLAUDE.md).
 */

import { ConditionEvaluator } from '../evaluator/conditionEvaluator.js';
import {
  PolicyRuleRepository,
  PolicyEvaluationRepository,
} from '../repositories/policyRepository.js';
import {
  PolicyRuleRecord,
  PolicyEvaluationResult,
  PolicyViolation,
  PolicyCategory,
  PolicyRuleInput,
  PolicyRuleSchema,
} from '../types/policyTypes.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';
import { logger } from '../../core/logger/logger.js';

import { DatabaseClient } from '../../storage/db.js';

export interface EvaluatePolicyRequest {
  actionType: 'tool_execution' | 'agent_output' | 'outbound_message' | 'financial_transaction' | 'consent_check' | 'custom';
  context: Record<string, unknown>;
  category?: PolicyCategory;
  resourceId?: string;
  actorType?: 'agent' | 'user' | 'system';
  actorId?: string;
}

export class PolicyEngine {
  private ruleRepo: PolicyRuleRepository;
  private evalRepo: PolicyEvaluationRepository;

  constructor(
    ruleRepoOrClient?: PolicyRuleRepository | DatabaseClient,
    evalRepo?: PolicyEvaluationRepository
  ) {
    if (ruleRepoOrClient && 'query' in ruleRepoOrClient && typeof (ruleRepoOrClient as any).query === 'function') {
      const client = ruleRepoOrClient as DatabaseClient;
      this.ruleRepo = new PolicyRuleRepository(client);
      this.evalRepo = evalRepo || new PolicyEvaluationRepository(client);
    } else {
      this.ruleRepo = (ruleRepoOrClient as PolicyRuleRepository) || new PolicyRuleRepository();
      this.evalRepo = evalRepo || new PolicyEvaluationRepository();
    }
  }

  /**
   * Evaluates target context against active policy rules.
   */
  public async evaluate(req: EvaluatePolicyRequest): Promise<PolicyEvaluationResult> {
    const tenantId = TenantContextManager.getTenantId();
    const rules = await this.ruleRepo.listActiveRules(tenantId, req.category);

    const violations: PolicyViolation[] = [];
    let hasBlock = false;
    let hasRequireApproval = false;
    let hasEscalate = false;

    for (const rule of rules) {
      let condition: any;
      try {
        condition = JSON.parse(rule.condition_json);
      } catch {
        continue;
      }

      // ConditionEvaluator returns true if the prohibited/restricted condition is met (rule trips)
      const isTripped = ConditionEvaluator.evaluate(condition, req.context);

      if (isTripped) {
        const violation: PolicyViolation = {
          ruleSlug: rule.slug,
          ruleName: rule.name,
          category: rule.category,
          severity: rule.severity,
          action: rule.action,
          message: `Policy rule '${rule.name}' violated. Action: ${rule.action}`,
          failedCondition: condition,
        };

        violations.push(violation);

        if (rule.action === 'BLOCK_ACTION' || rule.severity === 'BLOCK') {
          hasBlock = true;
        }
        if (rule.action === 'REQUIRE_APPROVAL') {
          hasRequireApproval = true;
        }
        if (rule.action === 'ESCALATE_TO_HUMAN' || rule.severity === 'ESCALATE') {
          hasEscalate = true;
        }
      }
    }

    let verdict: PolicyEvaluationResult['verdict'] = 'PASS';
    if (hasBlock) {
      verdict = 'BLOCKED';
    } else if (hasRequireApproval) {
      verdict = 'WARN'; // Action permitted with approval flag
    } else if (hasEscalate) {
      verdict = 'ESCALATED';
    } else if (violations.length > 0) {
      verdict = 'WARN';
    }

    const result: PolicyEvaluationResult = {
      allowed: !hasBlock,
      requiresApproval: hasRequireApproval,
      escalated: hasEscalate,
      verdict,
      violations,
      evaluatedRuleCount: rules.length,
    };

    // Record evaluation audit log
    await this.evalRepo.recordEvaluation({
      actionType: req.actionType,
      resourceId: req.resourceId,
      actorType: req.actorType || 'system',
      actorId: req.actorId,
      evaluationResult: verdict,
      violations: violations as any,
      contextSnapshot: req.context,
    });

    if (violations.length > 0) {
      logger.warn(`Policy evaluation completed with ${violations.length} violations (Verdict: ${verdict})`, {
        tenantId,
        actionType: req.actionType,
        verdict,
        violations: violations.map((v) => v.ruleSlug),
      });
    }

    return result;
  }

  /**
   * Bootstraps standard system policy rules.
   */
  public async bootstrapDefaultSystemPolicies(): Promise<void> {
    const defaultPolicies: PolicyRuleInput[] = [
      {
        slug: 'max_discount_threshold',
        name: 'Maximum Unauthorized Discount Limit',
        description: 'Blocks unauthorized commercial discounts exceeding 20% without manager override.',
        category: 'financial',
        severity: 'BLOCK',
        action: 'BLOCK_ACTION',
        condition: {
          field: 'discountPercent',
          operator: 'GREATER_THAN',
          value: 20,
        },
        isEnabled: true,
        isSystem: true,
      },
      {
        slug: 'quiet_hours_governance',
        name: 'Quiet Hours Messaging Restriction',
        description: 'Restricts proactive marketing messages during night quiet hours (21:00-08:00).',
        category: 'channel_governance',
        severity: 'BLOCK',
        action: 'BLOCK_ACTION',
        condition: {
          field: 'isQuietHours',
          operator: 'EQUALS',
          value: true,
        },
        isEnabled: true,
        isSystem: true,
      },
      {
        slug: 'gdpr_explicit_consent_required',
        name: 'GDPR / DPDP Explicit Consent Verification',
        description: 'Requires documented opt-in consent before initiating marketing outreach.',
        category: 'privacy',
        severity: 'BLOCK',
        action: 'BLOCK_ACTION',
        condition: {
          field: 'hasActiveConsent',
          operator: 'EQUALS',
          value: false,
        },
        isEnabled: true,
        isSystem: true,
      },
      {
        slug: 'large_refund_approval_gate',
        name: 'Large Financial Refund Approval Gate',
        description: 'Requires human manager authorization for refunds exceeding $100.',
        category: 'financial',
        severity: 'WARN',
        action: 'REQUIRE_APPROVAL',
        condition: {
          field: 'amountUsd',
          operator: 'GREATER_THAN',
          value: 100,
        },
        isEnabled: true,
        isSystem: true,
      },
    ];

    for (const policy of defaultPolicies) {
      const parsed = PolicyRuleSchema.parse(policy);
      await this.ruleRepo.saveRule({
        tenantId: null, // Global default
        slug: parsed.slug,
        name: parsed.name,
        description: parsed.description,
        category: parsed.category,
        severity: parsed.severity,
        action: parsed.action,
        condition: parsed.condition,
        isEnabled: parsed.isEnabled,
        isSystem: true,
      });
    }
  }
}
