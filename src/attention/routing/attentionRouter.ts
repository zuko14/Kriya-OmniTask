/**
 * Kriya AI — Deterministic Attention Router
 * Evaluates routing rules, branch operating hours, emergency bypass, and role assignment (§14 of CLAUDE.md, docs/kriya WP-4.6).
 */

import { DatabaseClient } from '../../storage/db.js';
import {
  CreateAttentionItemRequest,
  AttentionPriority,
  RoutingCondition,
  BranchRecord,
  AttentionRoutingRuleRecord,
} from '../types/attentionTypes.js';
import { BranchRepository } from '../repositories/branchRepository.js';
import { RoutingRuleRepository } from '../repositories/routingRuleRepository.js';
import { logger } from '../../core/logger/logger.js';

export interface RoutingDecision {
  assignedRole: string;
  assignedUserId?: string | null;
  branchId?: string | null;
  routingRuleId?: string | null;
  afterHours: number;
  nextAvailableAt?: string | null;
  routedAt: string;
  reason: string;
}

export class AttentionRouter {
  private branchRepo: BranchRepository;
  private ruleRepo: RoutingRuleRepository;

  constructor(client?: DatabaseClient) {
    this.branchRepo = new BranchRepository(client);
    this.ruleRepo = new RoutingRuleRepository(client);
  }

  /**
   * Deterministically evaluates the destination role, human user, branch, and operating hours for an attention item.
   */
  public async route(
    request: CreateAttentionItemRequest,
    priority: AttentionPriority,
    now = new Date()
  ): Promise<RoutingDecision> {
    const routedAt = now.toISOString();

    // 1. Resolve Branch (if provided)
    let branch: BranchRecord | null = null;
    if (request.branchId) {
      branch = await this.branchRepo.findById(request.branchId);
    }

    // 2. Emergency / P0 Bypass (Life-safety & Critical Exceptions)
    // S37 & D7: Emergency triage routes immediately with 0 delay and bypasses ordinary hours gating.
    if (priority === 'P0_CRITICAL') {
      const emergencyRole = branch?.emergency_role || 'emergency_on_call';
      logger.warn(
        `[ATTENTION ROUTER] P0_CRITICAL item routed immediately to emergency role '${emergencyRole}' (bypassing working hours).`
      );
      return {
        assignedRole: emergencyRole,
        assignedUserId: null,
        branchId: branch?.id || null,
        routingRuleId: 'system_p0_emergency_bypass',
        afterHours: 0,
        nextAvailableAt: null,
        routedAt,
        reason: 'P0 critical emergency bypass to on-call role',
      };
    }

    // 3. Explicit Role or User Override
    if (request.assignedRole) {
      const hoursStatus = this.checkHours(branch, now);
      return {
        assignedRole: request.assignedRole,
        assignedUserId: null,
        branchId: branch?.id || null,
        routingRuleId: 'explicit_request_assignment',
        afterHours: hoursStatus.afterHours,
        nextAvailableAt: hoursStatus.nextAvailableAt,
        routedAt,
        reason: 'Explicit role requested',
      };
    }

    // 4. Evaluate Dynamic Routing Rules
    const activeRules = await this.ruleRepo.listActiveRules();
    for (const rule of activeRules) {
      if (this.matchesRule(rule, request, priority)) {
        // Resolve effective branch for rule
        const effectiveBranch = branch || (rule.branch_id ? await this.branchRepo.findById(rule.branch_id) : null);
        const hoursStatus = this.checkHours(effectiveBranch, now);

        return {
          assignedRole: rule.target_role,
          assignedUserId: rule.target_user_id || null,
          branchId: effectiveBranch?.id || null,
          routingRuleId: rule.id,
          afterHours: hoursStatus.afterHours,
          nextAvailableAt: hoursStatus.nextAvailableAt,
          routedAt,
          reason: `Matched routing rule '${rule.name}' (#${rule.priority_order})`,
        };
      }
    }

    // 5. Deterministic Category-Specific Defaults
    const defaultRole = this.resolveDefaultRole(request);
    const hoursStatus = this.checkHours(branch, now);

    return {
      assignedRole: defaultRole,
      assignedUserId: null,
      branchId: branch?.id || null,
      routingRuleId: 'system_default_fallback',
      afterHours: hoursStatus.afterHours,
      nextAvailableAt: hoursStatus.nextAvailableAt,
      routedAt,
      reason: `Default fallback for category '${request.reasonCategory}'`,
    };
  }

  /**
   * Checks whether a routing rule's conditions match the attention item request.
   */
  private matchesRule(
    rule: AttentionRoutingRuleRecord,
    request: CreateAttentionItemRequest,
    priority: AttentionPriority
  ): boolean {
    let conditions: RoutingCondition = {};
    try {
      conditions = JSON.parse(rule.conditions_json || '{}');
    } catch {
      return false;
    }

    // Branch match (if rule is branch-specific)
    if (rule.branch_id && request.branchId && rule.branch_id !== request.branchId) {
      return false;
    }

    // Reason category condition
    if (conditions.reasonCategories && conditions.reasonCategories.length > 0) {
      if (!conditions.reasonCategories.includes(request.reasonCategory)) {
        return false;
      }
    }

    // Source agent condition
    if (conditions.sourceAgents && conditions.sourceAgents.length > 0) {
      if (!conditions.sourceAgents.includes(request.sourceAgentId)) {
        return false;
      }
    }

    // Priority condition
    if (conditions.priorities && conditions.priorities.length > 0) {
      if (!conditions.priorities.includes(priority)) {
        return false;
      }
    }

    // Context department condition
    const context = request.contextData || {};
    if (conditions.departments && conditions.departments.length > 0) {
      const dept = typeof context.department === 'string' ? context.department.toLowerCase() : '';
      const matches = conditions.departments.some((d) => d.toLowerCase() === dept);
      if (!matches) return false;
    }

    // Context intent condition
    if (conditions.intents && conditions.intents.length > 0) {
      const intent = typeof context.intent === 'string' ? context.intent.toLowerCase() : '';
      const matches = conditions.intents.some((i) => i.toLowerCase() === intent);
      if (!matches) return false;
    }

    return true;
  }

  /**
   * Checks operating hours for a branch, calculating next available window if after-hours.
   */
  private checkHours(
    branch: BranchRecord | null,
    now: Date
  ): { afterHours: number; nextAvailableAt: string | null } {
    if (!branch) {
      return { afterHours: 0, nextAvailableAt: null };
    }

    const { inHours } = this.branchRepo.isWithinWorkingHours(branch, now);
    if (inHours) {
      return { afterHours: 0, nextAvailableAt: null };
    }

    const nextAvailableAt = this.branchRepo.getNextAvailableTime(branch, now);
    return {
      afterHours: 1,
      nextAvailableAt,
    };
  }

  /**
   * Deterministic category-to-role fallback.
   */
  private resolveDefaultRole(request: CreateAttentionItemRequest): string {
    switch (request.reasonCategory) {
      case 'financial_threshold':
        return 'billing_lead';
      case 'policy_violation':
      case 'security_anomaly':
        return 'compliance_officer';
      case 'sensitive_complaint':
        return 'clinical_lead';
      case 'low_confidence':
      case 'agent_disagreement':
      case 'workflow_suspended':
      case 'manual_flag':
      default:
        return 'operations_lead';
    }
  }
}
