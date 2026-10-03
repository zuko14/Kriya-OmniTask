/**
 * Kriya Omnitask — Error-Budget Autonomy Throttling Service
 * (CLAUDE.md §15, §37; Blueprint §14; docs/kriya WP-6.3, ADR-026)
 *
 * Implements rolling error budgets, SLA targets, automated step-down throttling
 * when error budgets are exhausted, Attention Center escalations, and human-in-the-loop
 * restoration governance.
 */

import { randomUUID } from 'node:crypto';
import { DatabaseClient, db } from '../../storage/db.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';
import { logger } from '../../core/logger/logger.js';
import { ValidationError, NotFoundError } from '../../core/errors/errors.js';
import { ActionTier } from '../../runtime/graph/types.js';
import { AgentCharterInput } from '../../agents/charter/agentCharter.js';
import { AttentionService } from '../../attention/service/attentionService.js';
import { OutcomeKpiRepository } from '../../outcomes/repositories/outcomeKpiRepository.js';
import { EvalsAsCiService } from '../../evaluation/ci/service/evalsAsCiService.js';
import { EvaluationCiRepository } from '../../evaluation/ci/repositories/evaluationCiRepository.js';
import { AutonomyThrottlingRepository } from '../repositories/autonomyThrottlingRepository.js';
import {
  AgentErrorBudgetRecord,
  AutonomyEventRecord,
  DEFAULT_ERROR_BUDGET_CONFIG,
  ErrorBudgetEngineConfig,
  RestoreAutonomyInput,
  RestoreAutonomyRequest,
  RestoreAutonomyRequestSchema,
  TIER_SLA_CONFIG,
  ThrottleEvaluationResult,
} from '../types/autonomyThrottlingTypes.js';

const TIER_RANK: Record<ActionTier, number> = { T0: 0, T1: 1, T2: 2, T3: 3 };
const TIER_STEP_DOWN: Record<ActionTier, ActionTier> = {
  T3: 'T2',
  T2: 'T1',
  T1: 'T0',
  T0: 'T0',
};

export class AutonomyThrottlingService {
  private repo: AutonomyThrottlingRepository;
  private outcomeRepo: OutcomeKpiRepository;
  private attention: AttentionService;
  private evalsCi: EvalsAsCiService;
  private config: ErrorBudgetEngineConfig;
  private client: DatabaseClient;

  constructor(
    client?: DatabaseClient,
    repo?: AutonomyThrottlingRepository,
    outcomeRepo?: OutcomeKpiRepository,
    attention?: AttentionService,
    evalsCi?: EvalsAsCiService,
    config?: Partial<ErrorBudgetEngineConfig>
  ) {
    this.client = client || db.getClient();
    this.repo = repo || new AutonomyThrottlingRepository(this.client);
    this.outcomeRepo = outcomeRepo || new OutcomeKpiRepository(this.client);
    this.attention = attention || new AttentionService(this.client);
    this.evalsCi = evalsCi || new EvalsAsCiService(new EvaluationCiRepository(this.client));
    this.config = { ...DEFAULT_ERROR_BUDGET_CONFIG, ...config };
  }

  public getRepo(): AutonomyThrottlingRepository {
    return this.repo;
  }

  /**
   * Fast path: returns the effective autonomy tier cap for an agent.
   * If the agent's error budget is exhausted and autonomy has stepped down,
   * returns the throttled effective tier cap. Otherwise returns the default tier cap.
   */
  public async getEffectiveTierCap(
    tenantId: string,
    agentSlug: string,
    defaultTierCap: ActionTier
  ): Promise<ActionTier> {
    try {
      const budget = await this.repo.getBudget(tenantId, agentSlug);
      if (budget && budget.is_throttled) {
        return budget.effective_tier_cap;
      }
    } catch (err) {
      logger.warn(`Failed to read error budget for ${tenantId}:${agentSlug}, falling back to default`, { err });
    }
    return defaultTierCap;
  }

  /**
   * Evaluates the rolling error budget for a single agent and executes step-down throttling
   * if the error budget is exhausted or consecutive verification failures breach the tripwire.
   */
  public async evaluateAgent(
    tenantId: string,
    agentSlug: string,
    charter?: AgentCharterInput,
    overrideConfig?: Partial<ErrorBudgetEngineConfig>
  ): Promise<ThrottleEvaluationResult> {
    const cleanOverride = overrideConfig
      ? Object.fromEntries(Object.entries(overrideConfig).filter(([_, v]) => v !== undefined))
      : {};
    const cfg = { ...this.config, ...cleanOverride };
    const now = new Date();
    const evaluatedAt = now.toISOString();
    const sinceDate = new Date(now.getTime() - cfg.windowHours * 3600 * 1000);
    const since = sinceDate.toISOString();

    const configuredTier: ActionTier = charter?.autonomyTierCap ?? 'T2';
    const tierConfig = TIER_SLA_CONFIG[configuredTier] ?? TIER_SLA_CONFIG.T2;
    const targetSlaRate = tierConfig.targetSlaRate;
    const allowedErrorBudget = tierConfig.allowedErrorBudget;

    // Existing budget record
    let budget = await this.repo.getBudget(tenantId, agentSlug);
    let consecutiveFailures = budget?.consecutive_failures ?? 0;

    // Query consequential actions in the rolling window
    const [proofs, verifications, toolCalls] = await Promise.all([
      this.outcomeRepo.queryProofReceipts(tenantId, { since }),
      this.outcomeRepo.queryVerificationJobs(tenantId, { since }),
      this.outcomeRepo.queryToolExecutions(tenantId, { agentId: agentSlug, since }),
    ]);

    // Compute sample count and failures for this agent
    let sampleCount = 0;
    let failureCount = 0;
    let verifiedCount = 0;

    for (const p of proofs) {
      try {
        const body = JSON.parse(p.body_json);
        const actionAgent = body.agentSlug || body.agent_slug;
        if (!actionAgent || actionAgent === agentSlug) {
          sampleCount += 1;
          if (body.verification?.state === 'verified') {
            verifiedCount += 1;
          } else if (body.verification?.state === 'mismatch' || body.verification?.state === 'failed') {
            failureCount += 1;
          }
        }
      } catch {}
    }

    for (const v of verifications) {
      // If verification job belongs to this agent
      sampleCount += 1;
      if (v.status === 'verified') {
        verifiedCount += 1;
      } else if (v.status === 'mismatch' || v.status === 'failed') {
        failureCount += 1;
      }
    }

    for (const t of toolCalls) {
      if (['MEDIUM', 'HIGH', 'CRITICAL', 'T2', 'T3'].includes((t.risk_tier || '').toUpperCase())) {
        if (t.status === 'failed') {
          failureCount += 1;
        }
      }
    }

    const unmeasured = sampleCount === 0;
    const verifiedActionRate = sampleCount > 0 ? verifiedCount / sampleCount : null;
    const currentErrorRate = sampleCount > 0 ? failureCount / sampleCount : 0.0;
    const burnedBudgetPercent =
      allowedErrorBudget > 0 ? (currentErrorRate / allowedErrorBudget) * 100.0 : 0.0;

    // Check throttling trigger conditions
    const isBudgetBurnout =
      sampleCount >= cfg.minSampleSize && burnedBudgetPercent >= cfg.throttleBurnPercent;
    const isTripwireTriggered = consecutiveFailures >= cfg.consecutiveFailureTripwire;

    const shouldThrottle = isBudgetBurnout || isTripwireTriggered;
    const currentEffective = budget?.effective_tier_cap ?? configuredTier;
    const currentlyThrottled = budget?.is_throttled ?? false;

    let stateChanged = false;
    let action: 'throttled' | 'unchanged' | 'warning' = 'unchanged';
    let attentionItemId: string | undefined;
    let throttleReason: string | undefined;

    if (shouldThrottle) {
      const steppedDownTier = TIER_STEP_DOWN[currentEffective];
      throttleReason = isTripwireTriggered
        ? `Immediate tripwire: ${consecutiveFailures} consecutive verification failures`
        : `Error budget exhausted: error rate ${(currentErrorRate * 100).toFixed(1)}% breaches ${((1 - targetSlaRate) * 100).toFixed(1)}% budget (${burnedBudgetPercent.toFixed(1)}% burned, ${sampleCount} samples)`;

      if (!currentlyThrottled || currentEffective !== steppedDownTier) {
        stateChanged = true;
        action = 'throttled';

        // Update budget record
        const updatedRecord: AgentErrorBudgetRecord = {
          id: budget?.id ?? randomUUID(),
          tenant_id: tenantId,
          agent_slug: agentSlug,
          configured_tier_cap: configuredTier,
          effective_tier_cap: steppedDownTier,
          is_throttled: true,
          target_sla_rate: targetSlaRate,
          allowed_error_budget: allowedErrorBudget,
          current_error_rate: Math.round(currentErrorRate * 1000) / 1000,
          burned_budget_percent: Math.round(burnedBudgetPercent * 10) / 10,
          sample_count: sampleCount,
          failure_count: failureCount,
          consecutive_failures: consecutiveFailures,
          throttled_at: evaluatedAt,
          throttled_reason: throttleReason,
          restored_at: null,
          restored_by: null,
          last_evaluated_at: evaluatedAt,
          created_at: budget?.created_at ?? evaluatedAt,
          updated_at: evaluatedAt,
        };
        await this.repo.upsertBudget(updatedRecord);

        // Record audit transition event
        await this.repo.recordEvent({
          id: randomUUID(),
          tenant_id: tenantId,
          agent_slug: agentSlug,
          event_type: 'throttled',
          from_tier: currentEffective,
          to_tier: steppedDownTier,
          burned_budget_percent: Math.round(burnedBudgetPercent * 10) / 10,
          reason: throttleReason,
          actor: 'system:error_budget_engine',
          evidence_json: JSON.stringify({
            sampleCount,
            failureCount,
            verifiedCount,
            currentErrorRate,
            targetSlaRate,
            allowedErrorBudget,
            burnedBudgetPercent,
            consecutiveFailures,
          }),
          created_at: evaluatedAt,
        });

        // Escalate to Attention Center with deterministic routing
        const assignedRole = charter?.owner ?? 'operations_lead';
        const attentionItem = await TenantContextManager.withTenant(
          tenantId,
          'default',
          async () =>
            this.attention.escalateOnce({
              correlationId: `autonomy:throttle:${agentSlug}:${now.getTime()}`,
              sourceAgentId: agentSlug,
              title: `Autonomy Throttled: Agent '${agentSlug}' stepped down to ${steppedDownTier}`,
              description: `Agent '${agentSlug}' exhausted its error budget (${burnedBudgetPercent.toFixed(1)}% burned). Autonomy stepped down from ${currentEffective} to ${steppedDownTier}. Human review required to restore autonomous actions.`,
              reasonCategory: 'policy_violation',
              priority: 'P1_HIGH',
              channel: 'system',
              assignedRole,
              contextData: {
                agentSlug,
                configuredTier,
                previousTier: currentEffective,
                effectiveTier: steppedDownTier,
                burnedBudgetPercent,
                sampleCount,
                failureCount,
                throttleReason,
                assignedRole,
              },
            }),
          { userId: 'system:error_budget_engine', roles: ['admin'] }
        );
        attentionItemId = attentionItem.id;

        logger.warn(
          `[AUTONOMY THROTTLED] Agent '${agentSlug}' stepped down ${currentEffective} -> ${steppedDownTier}: ${throttleReason}`
        );
      }
    } else {
      // Not throttled - check for warning
      if (burnedBudgetPercent >= cfg.warningBurnPercent && !currentlyThrottled) {
        action = 'warning';
        await this.repo.recordEvent({
          id: randomUUID(),
          tenant_id: tenantId,
          agent_slug: agentSlug,
          event_type: 'budget_warning',
          from_tier: currentEffective,
          to_tier: currentEffective,
          burned_budget_percent: Math.round(burnedBudgetPercent * 10) / 10,
          reason: `Error budget warning: ${burnedBudgetPercent.toFixed(1)}% burned (threshold: ${cfg.warningBurnPercent}%)`,
          actor: 'system:error_budget_engine',
          evidence_json: JSON.stringify({ sampleCount, failureCount, burnedBudgetPercent }),
          created_at: evaluatedAt,
        });
      }

      // Upsert unthrottled stats
      const updatedRecord: AgentErrorBudgetRecord = {
        id: budget?.id ?? randomUUID(),
        tenant_id: tenantId,
        agent_slug: agentSlug,
        configured_tier_cap: configuredTier,
        effective_tier_cap: currentlyThrottled ? currentEffective : configuredTier,
        is_throttled: currentlyThrottled,
        target_sla_rate: targetSlaRate,
        allowed_error_budget: allowedErrorBudget,
        current_error_rate: Math.round(currentErrorRate * 1000) / 1000,
        burned_budget_percent: Math.round(burnedBudgetPercent * 10) / 10,
        sample_count: sampleCount,
        failure_count: failureCount,
        consecutive_failures: consecutiveFailures,
        throttled_at: budget?.throttled_at ?? null,
        throttled_reason: budget?.throttled_reason ?? null,
        restored_at: budget?.restored_at ?? null,
        restored_by: budget?.restored_by ?? null,
        last_evaluated_at: evaluatedAt,
        created_at: budget?.created_at ?? evaluatedAt,
        updated_at: evaluatedAt,
      };
      await this.repo.upsertBudget(updatedRecord);
    }

    const finalBudget = (await this.repo.getBudget(tenantId, agentSlug))!;

    return {
      tenantId,
      agentSlug,
      configuredTier,
      effectiveTier: finalBudget.effective_tier_cap,
      isThrottled: finalBudget.is_throttled,
      stateChanged,
      action,
      metrics: {
        sampleCount,
        failureCount,
        consecutiveFailures,
        verifiedActionRate,
        targetSlaRate,
        allowedErrorBudget,
        currentErrorRate,
        burnedBudgetPercent,
        unmeasured,
      },
      reason: throttleReason,
      attentionItemId,
      evaluatedAt,
    };
  }

  /**
   * Evaluates the entire fleet of agents for a tenant.
   */
  public async evaluateFleet(
    tenantId: string,
    agentSlugs: string[] = ['intake', 'scheduling', 'payments', 'document', 'attention'],
    charters?: Record<string, AgentCharterInput>,
    opts?: Partial<ErrorBudgetEngineConfig>
  ): Promise<ThrottleEvaluationResult[]> {
    const results: ThrottleEvaluationResult[] = [];
    for (const slug of agentSlugs) {
      const res = await this.evaluateAgent(tenantId, slug, charters?.[slug], opts);
      results.push(res);
    }
    return results;
  }

  /**
   * Restores an agent's autonomy back to its charter tier cap after human review.
   * Autonomy NEVER self-restores on live traffic without explicit human authorization.
   */
  public async restoreAutonomy(
    tenantId: string,
    request: RestoreAutonomyInput,
    charter?: AgentCharterInput
  ): Promise<AgentErrorBudgetRecord> {
    const parsed = RestoreAutonomyRequestSchema.parse(request);
    const now = new Date().toISOString();

    const budget = await this.repo.getBudget(tenantId, parsed.agentSlug);
    if (!budget) {
      throw new NotFoundError(`No error budget found for agent '${parsed.agentSlug}' in tenant '${tenantId}'`);
    }

    if (!budget.is_throttled) {
      throw new ValidationError(`Agent '${parsed.agentSlug}' is not currently throttled (effective tier: ${budget.effective_tier_cap})`);
    }

    // If pre-restoration verification is requested, run the agent's golden test suite
    if (parsed.verifyFirst) {
      logger.info(`Running golden test suite verification for agent '${parsed.agentSlug}' before restoring autonomy...`);
      const suiteResult = await this.evalsCi.evaluateAgentSuite(parsed.agentSlug as any);
      if (suiteResult.verdict !== 'release_approved' || suiteResult.criticalSafetyBreaches > 0) {
        throw new ValidationError(
          `Cannot restore autonomy: Agent '${parsed.agentSlug}' failed verification test suite (${suiteResult.passedCases}/${suiteResult.totalCases} passed, ${suiteResult.criticalSafetyBreaches} safety breaches)`
        );
      }
    }

    const targetTier = parsed.targetTier ?? budget.configured_tier_cap;
    const previousTier = budget.effective_tier_cap;

    const updatedRecord: AgentErrorBudgetRecord = {
      ...budget,
      effective_tier_cap: targetTier,
      is_throttled: false,
      consecutive_failures: 0,
      current_error_rate: 0.0,
      burned_budget_percent: 0.0,
      restored_at: now,
      restored_by: parsed.restoredBy,
      last_evaluated_at: now,
      updated_at: now,
    };

    await this.repo.upsertBudget(updatedRecord);

    // Record audited restoration event
    await this.repo.recordEvent({
      id: randomUUID(),
      tenant_id: tenantId,
      agent_slug: parsed.agentSlug,
      event_type: 'restored',
      from_tier: previousTier,
      to_tier: targetTier,
      burned_budget_percent: 0.0,
      reason: parsed.reason,
      actor: parsed.restoredBy,
      evidence_json: JSON.stringify({
        restoredBy: parsed.restoredBy,
        reason: parsed.reason,
        verifiedFirst: parsed.verifyFirst,
        restoredTier: targetTier,
      }),
      created_at: now,
    });

    logger.info(
      `[AUTONOMY RESTORED] Agent '${parsed.agentSlug}' restored from ${previousTier} -> ${targetTier} by ${parsed.restoredBy}: ${parsed.reason}`
    );

    return updatedRecord;
  }

  /**
   * Direct tripwire: records an immediate verification failure or critical error
   * for an agent, incrementing consecutive failures and triggering immediate throttling if the threshold is met.
   */
  public async recordDirectExecutionFailure(
    tenantId: string,
    agentSlug: string,
    reason: string,
    charter?: AgentCharterInput
  ): Promise<ThrottleEvaluationResult> {
    const budget = await this.repo.getBudget(tenantId, agentSlug);
    const consecutive = (budget?.consecutive_failures ?? 0) + 1;

    const configuredTier = charter?.autonomyTierCap ?? budget?.configured_tier_cap ?? 'T2';
    const tierConfig = TIER_SLA_CONFIG[configuredTier] ?? TIER_SLA_CONFIG.T2;

    const updated: AgentErrorBudgetRecord = {
      id: budget?.id ?? randomUUID(),
      tenant_id: tenantId,
      agent_slug: agentSlug,
      configured_tier_cap: configuredTier,
      effective_tier_cap: budget?.effective_tier_cap ?? configuredTier,
      is_throttled: budget?.is_throttled ?? false,
      target_sla_rate: tierConfig.targetSlaRate,
      allowed_error_budget: tierConfig.allowedErrorBudget,
      current_error_rate: budget?.current_error_rate ?? 0.0,
      burned_budget_percent: budget?.burned_budget_percent ?? 0.0,
      sample_count: (budget?.sample_count ?? 0) + 1,
      failure_count: (budget?.failure_count ?? 0) + 1,
      consecutive_failures: consecutive,
      throttled_at: budget?.throttled_at ?? null,
      throttled_reason: budget?.throttled_reason ?? null,
      restored_at: budget?.restored_at ?? null,
      restored_by: budget?.restored_by ?? null,
      last_evaluated_at: new Date().toISOString(),
      created_at: budget?.created_at ?? new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    await this.repo.upsertBudget(updated);

    // Re-evaluate to trip immediately if threshold is reached
    return this.evaluateAgent(tenantId, agentSlug, charter);
  }
}
