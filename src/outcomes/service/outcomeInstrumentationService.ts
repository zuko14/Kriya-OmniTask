/**
 * Kriya Omnitask — Outcome Instrumentation & Blueprint KPI Engine Service
 * (docs/kriya WP-6.1, Blueprint §14, CLAUDE.md §35, §39; ADR-024)
 *
 * Implements the mathematical formulas, ground-truth aggregation, zero-fabrication
 * honest baselines, cost cascade (L0-L3) analysis, and Client Value Report generation.
 */

import { DatabaseClient, db } from '../../storage/db.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';
import { CryptoUtils } from '../../core/utils/crypto.js';
import { logger } from '../../core/logger/logger.js';
import { OutcomeKpiRepository } from '../repositories/outcomeKpiRepository.js';
import {
  BlueprintKpiOverview,
  CascadeLevel,
  CascadeLevelStats,
  CascadeMixSummary,
  ClientValueReport,
  CostPerOutcomeReport,
  MetricDefinition,
  MetricKey,
  MetricStatus,
  OutcomeKpiQuery,
  RecordCascadeEvent,
  WindowType,
  AgentKpiRollup,
  WorkflowKpiRollup,
} from '../types/outcomeKpiTypes.js';

// Standard benchmarks for ROI and savings calculations
const L3_BENCHMARK_COST_USD = 0.015; // Benchmark cost if every query went to an L3 frontier model
const HOURLY_LABOR_RATE_USD = 25.0;  // Standard benchmark human operational cost per hour

export class OutcomeInstrumentationService {
  private repo: OutcomeKpiRepository;

  constructor(repo?: OutcomeKpiRepository, client?: DatabaseClient) {
    this.repo = repo || new OutcomeKpiRepository(client || db.getClient());
  }

  public getRepo(): OutcomeKpiRepository {
    return this.repo;
  }

  /**
   * Ingests a cost cascade execution event.
   */
  public async recordCascadeEvent(
    event: RecordCascadeEvent,
    tenantIdOverride?: string
  ) {
    return this.repo.recordCascadeEvent(event, tenantIdOverride);
  }

  /**
   * Evaluates the complete Blueprint KPI Overview for a tenant within the specified window.
   */
  public async getBlueprintKpiOverview(
    query?: OutcomeKpiQuery,
    tenantIdOverride?: string
  ): Promise<BlueprintKpiOverview> {
    const tenantId = tenantIdOverride || TenantContextManager.getTenantId();
    const windowType: WindowType = query?.window || '24h';
    const { since, until } = this.resolveTimeWindow(windowType, query?.startDate, query?.endDate);
    const now = new Date().toISOString();

    // Query all ground-truth tables in parallel for efficiency
    const [
      runs,
      proofs,
      verifications,
      toolCalls,
      attentionItems,
      costRecords,
      businessOutcomes,
      cascadeEvents,
    ] = await Promise.all([
      this.repo.queryWorkflowRuns(tenantId, { workflowId: query?.workflowId, since, until }),
      this.repo.queryProofReceipts(tenantId, { since, until }),
      this.repo.queryVerificationJobs(tenantId, { since, until }),
      this.repo.queryToolExecutions(tenantId, { agentId: query?.agentId, since, until }),
      this.repo.queryAttentionItems(tenantId, { agentId: query?.agentId, since, until }),
      this.repo.queryCostRecords(tenantId, { agentId: query?.agentId, since, until }),
      this.repo.queryBusinessOutcomes(tenantId, { agentId: query?.agentId, since, until }),
      this.repo.listCascadeEvents(tenantId, { agentId: query?.agentId, workflowId: query?.workflowId, since, until }),
    ]);

    // 1. Metric: Verified Action Rate
    const verifiedActionRate = this.calculateVerifiedActionRate(proofs, verifications, toolCalls, windowType);

    // 2. Metric: Resolution Rate
    const resolutionRate = this.calculateResolutionRate(runs, businessOutcomes, windowType);

    // 3. Metric: Tool-Call Reliability
    const toolCallReliability = this.calculateToolCallReliability(toolCalls, windowType);

    // 4. Metric: Recovery Rate
    const recoveryRate = this.calculateRecoveryRate(runs, windowType);

    // 5. Metric: Escalation Rate
    const escalationRate = this.calculateEscalationRate(runs, attentionItems, windowType);

    // 6. Metric: Cost per Verified Outcome
    const costPerVerifiedOutcome = this.calculateCostPerVerifiedOutcome(
      costRecords,
      proofs,
      verifications,
      businessOutcomes,
      windowType
    );

    // 7. Cost Cascade Level Mix (L0-L3)
    const cascadeMix = this.calculateCascadeMix(cascadeEvents);

    // 8. Client Value Report
    const clientValueReport = this.generateClientValueReport(
      tenantId,
      runs,
      proofs,
      verifications,
      businessOutcomes,
      attentionItems,
      costRecords,
      windowType,
      since,
      until
    );

    // 9. Agent & Workflow Rollups
    const byAgent = this.calculateAgentRollups(runs, toolCalls, proofs, attentionItems, costRecords);
    const byWorkflow = this.calculateWorkflowRollups(runs, proofs, attentionItems, costRecords);

    return {
      tenantId,
      window: windowType,
      evaluatedAt: now,
      periodStart: since,
      periodEnd: until,
      metrics: {
        verifiedActionRate,
        resolutionRate,
        toolCallReliability,
        recoveryRate,
        escalationRate,
        costPerVerifiedOutcome,
      },
      cascadeMix,
      clientValueReport,
      byAgent,
      byWorkflow,
    };
  }

  /**
   * Generates the Cost per Outcome Report tailored for WP-7.5 console screens.
   */
  public async getCostPerOutcomeReport(
    query?: OutcomeKpiQuery,
    tenantIdOverride?: string
  ): Promise<CostPerOutcomeReport> {
    const tenantId = tenantIdOverride || TenantContextManager.getTenantId();
    const windowType: WindowType = query?.window || '24h';
    const { since, until } = this.resolveTimeWindow(windowType, query?.startDate, query?.endDate);

    const [costRecords, proofs, verifications, businessOutcomes, runs, toolCalls, cascadeEvents] =
      await Promise.all([
        this.repo.queryCostRecords(tenantId, { agentId: query?.agentId, since, until }),
        this.repo.queryProofReceipts(tenantId, { since, until }),
        this.repo.queryVerificationJobs(tenantId, { since, until }),
        this.repo.queryBusinessOutcomes(tenantId, { agentId: query?.agentId, since, until }),
        this.repo.queryWorkflowRuns(tenantId, { workflowId: query?.workflowId, since, until }),
        this.repo.queryToolExecutions(tenantId, { agentId: query?.agentId, since, until }),
        this.repo.listCascadeEvents(tenantId, { agentId: query?.agentId, workflowId: query?.workflowId, since, until }),
      ]);

    const totalCostUsd = costRecords.reduce((sum, r) => sum + r.total_cost_usd, 0);

    // Count unique verified outcomes
    const verifiedProofCount = proofs.filter((p) => {
      try {
        const body = JSON.parse(p.body_json);
        return body.verification?.state === 'verified';
      } catch {
        return false;
      }
    }).length;
    const verifiedJobCount = verifications.filter((v) => v.status === 'verified').length;
    const achievedOutcomeCount = businessOutcomes.filter((o) => o.outcome_status === 'achieved').length;
    const verifiedOutcomesCount = Math.max(verifiedProofCount + achievedOutcomeCount, verifiedJobCount);

    const overallCostPerOutcomeUsd =
      verifiedOutcomesCount > 0 ? Math.round((totalCostUsd / verifiedOutcomesCount) * 1000) / 1000 : null;

    // Workflow breakdown
    const workflowGroups = new Map<string, { runs: number; cost: number; verified: number }>();
    for (const run of runs) {
      const g = workflowGroups.get(run.graph_id) || { runs: 0, cost: 0, verified: 0 };
      g.runs += 1;
      workflowGroups.set(run.graph_id, g);
    }
    for (const c of costRecords) {
      if (c.workflow_execution_id) {
        // match workflow
        const matchedRun = runs.find((r) => r.id === c.workflow_execution_id);
        const wfId = matchedRun ? matchedRun.graph_id : 'unassigned';
        const g = workflowGroups.get(wfId) || { runs: 0, cost: 0, verified: 0 };
        g.cost += c.total_cost_usd;
        workflowGroups.set(wfId, g);
      }
    }
    for (const p of proofs) {
      if (p.run_id) {
        const matchedRun = runs.find((r) => r.id === p.run_id);
        const wfId = matchedRun ? matchedRun.graph_id : 'unassigned';
        const g = workflowGroups.get(wfId) || { runs: 0, cost: 0, verified: 0 };
        try {
          const body = JSON.parse(p.body_json);
          if (body.verification?.state === 'verified') g.verified += 1;
        } catch {}
        workflowGroups.set(wfId, g);
      }
    }

    const byWorkflow = Array.from(workflowGroups.entries()).map(([workflowId, stats]) => ({
      workflowId,
      name: this.formatWorkflowName(workflowId),
      outcomesCount: stats.verified,
      totalCostUsd: Math.round(stats.cost * 1000) / 1000,
      costPerOutcomeUsd:
        stats.verified > 0
          ? Math.round((stats.cost / stats.verified) * 1000) / 1000
          : null,
      verifiedActionRate: stats.runs > 0 ? Math.round((stats.verified / stats.runs) * 1000) / 10 : null,
    }));

    // Agent breakdown
    const agentGroups = new Map<string, { outcomes: number; cost: number; toolTotal: number; toolSuccess: number }>();
    for (const c of costRecords) {
      const g = agentGroups.get(c.agent_id) || { outcomes: 0, cost: 0, toolTotal: 0, toolSuccess: 0 };
      g.cost += c.total_cost_usd;
      agentGroups.set(c.agent_id, g);
    }
    for (const t of toolCalls) {
      const aid = t.agent_id || 'unknown';
      const g = agentGroups.get(aid) || { outcomes: 0, cost: 0, toolTotal: 0, toolSuccess: 0 };
      g.toolTotal += 1;
      if (t.status === 'completed') g.toolSuccess += 1;
      agentGroups.set(aid, g);
    }
    for (const o of businessOutcomes) {
      const g = agentGroups.get(o.agent_id) || { outcomes: 0, cost: 0, toolTotal: 0, toolSuccess: 0 };
      if (o.outcome_status === 'achieved') g.outcomes += 1;
      agentGroups.set(o.agent_id, g);
    }

    const byAgent = Array.from(agentGroups.entries()).map(([agentId, stats]) => ({
      agentId,
      name: this.formatAgentName(agentId),
      outcomesCount: stats.outcomes,
      totalCostUsd: Math.round(stats.cost * 1000) / 1000,
      costPerOutcomeUsd: stats.outcomes > 0 ? Math.round((stats.cost / stats.outcomes) * 1000) / 1000 : null,
      toolReliability:
        stats.toolTotal > 0 ? Math.round((stats.toolSuccess / stats.toolTotal) * 1000) / 10 : null,
    }));

    // Model breakdown from cost records & cascade events
    const modelGroups = new Map<string, { calls: number; cost: number; inTokens: number; outTokens: number; latencySum: number }>();
    for (const e of cascadeEvents) {
      if (e.model_id) {
        const m = modelGroups.get(e.model_id) || { calls: 0, cost: 0, inTokens: 0, outTokens: 0, latencySum: 0 };
        m.calls += 1;
        m.cost += e.cost_usd;
        m.inTokens += e.input_tokens;
        m.outTokens += e.output_tokens;
        m.latencySum += e.latency_ms;
        modelGroups.set(e.model_id, m);
      }
    }
    for (const c of costRecords) {
      if (c.provider) {
        const key = c.resource_metric_name.includes('tokens') ? `${c.provider}:model` : c.provider;
        const m = modelGroups.get(key) || { calls: 0, cost: 0, inTokens: 0, outTokens: 0, latencySum: 0 };
        m.calls += 1;
        m.cost += c.total_cost_usd;
        modelGroups.set(key, m);
      }
    }

    const byModel = Array.from(modelGroups.entries()).map(([modelId, stats]) => ({
      modelId,
      callsCount: stats.calls,
      totalCostUsd: Math.round(stats.cost * 1000) / 1000,
      tokensInput: stats.inTokens,
      tokensOutput: stats.outTokens,
      avgLatencyMs: stats.calls > 0 && stats.latencySum > 0 ? Math.round(stats.latencySum / stats.calls) : null,
    }));

    const cascadeMix = this.calculateCascadeMix(cascadeEvents);

    return {
      tenantId,
      window: windowType,
      periodStart: since,
      periodEnd: until,
      overallCostPerOutcomeUsd,
      totalCostUsd: Math.round(totalCostUsd * 1000) / 1000,
      verifiedOutcomesCount,
      byWorkflow,
      byAgent,
      byModel,
      cascadeMix,
    };
  }

  // ---------------------------------------------------------------------------
  // Metric Calculation Engines (Strict Zero-Fabrication Guarantees per S53)
  // ---------------------------------------------------------------------------

  private calculateVerifiedActionRate(
    proofs: Array<{ action_type: string; risk_tier: string; body_json: string }>,
    verifications: Array<{ status: string }>,
    toolCalls: Array<{ risk_tier: string; status: string }>,
    window: WindowType
  ): MetricDefinition {
    // Consequential actions are those with T2 (MEDIUM), T3 (HIGH/CRITICAL), or explicit verification
    let consequentialCount = 0;
    let verifiedCount = 0;

    // Check proof receipts
    for (const p of proofs) {
      if (['MEDIUM', 'HIGH', 'CRITICAL', 'T2', 'T3'].includes(p.risk_tier.toUpperCase())) {
        consequentialCount += 1;
        try {
          const body = JSON.parse(p.body_json);
          if (body.verification?.state === 'verified') {
            verifiedCount += 1;
          }
        } catch {}
      }
    }

    // Also check verification jobs
    for (const v of verifications) {
      consequentialCount += 1;
      if (v.status === 'verified') {
        verifiedCount += 1;
      }
    }

    // S53 zero-fabrication: if sampleCount === 0, return null
    const actualValue = consequentialCount > 0 ? Math.round((verifiedCount / consequentialCount) * 1000) / 10 : null;
    const status: MetricStatus =
      actualValue === null
        ? 'unmeasured'
        : actualValue >= 99.0
        ? 'healthy'
        : actualValue >= 95.0
        ? 'warning'
        : 'critical';

    return {
      key: 'verified_action_rate',
      name: 'Verified-Action Rate',
      description: 'Proportion of executed consequential actions verified by system read-back or signed proof receipt.',
      source: 'proof_receipts, verification_jobs, tool_executions',
      calculation: '(verified_consequential_actions / total_consequential_actions) * 100',
      unit: 'percentage',
      window,
      targetRange: {
        min: 99.0,
        healthyThreshold: 99.0,
        higherIsBetter: true,
      },
      actualValue,
      numerator: verifiedCount,
      sampleCount: consequentialCount,
      status,
      drillDown: {
        verified_proofs: verifiedCount,
        total_consequential: consequentialCount,
      },
    };
  }

  private calculateResolutionRate(
    runs: Array<{ status: string; outcome: string | null }>,
    outcomes: Array<{ outcome_status: string }>,
    window: WindowType
  ): MetricDefinition {
    let totalRuns = runs.length + outcomes.length;
    let resolvedRuns = 0;

    for (const r of runs) {
      if (r.status === 'completed' && r.outcome !== 'failed' && r.outcome !== 'aborted') {
        resolvedRuns += 1;
      }
    }
    for (const o of outcomes) {
      if (o.outcome_status === 'achieved') {
        resolvedRuns += 1;
      }
    }

    const actualValue = totalRuns > 0 ? Math.round((resolvedRuns / totalRuns) * 1000) / 10 : null;
    const status: MetricStatus =
      actualValue === null
        ? 'unmeasured'
        : actualValue >= 90.0
        ? 'healthy'
        : actualValue >= 80.0
        ? 'warning'
        : 'critical';

    return {
      key: 'resolution_rate',
      name: 'Resolution Rate',
      description: 'Proportion of workflow runs and customer interactions resolved without unrecovered error or takeover.',
      source: 'graph_runs, business_outcomes',
      calculation: '(resolved_runs / total_started_runs) * 100',
      unit: 'percentage',
      window,
      targetRange: {
        min: 90.0,
        healthyThreshold: 90.0,
        higherIsBetter: true,
      },
      actualValue,
      numerator: resolvedRuns,
      sampleCount: totalRuns,
      status,
      drillDown: {
        completed_runs: resolvedRuns,
        total_runs: totalRuns,
      },
    };
  }

  private calculateToolCallReliability(
    toolCalls: Array<{ status: string }>,
    window: WindowType
  ): MetricDefinition {
    const totalCalls = toolCalls.length;
    const successfulCalls = toolCalls.filter((t) => t.status === 'completed').length;

    const actualValue = totalCalls > 0 ? Math.round((successfulCalls / totalCalls) * 1000) / 10 : null;
    const status: MetricStatus =
      actualValue === null
        ? 'unmeasured'
        : actualValue >= 99.0
        ? 'healthy'
        : actualValue >= 95.0
        ? 'warning'
        : 'critical';

    return {
      key: 'tool_call_reliability',
      name: 'Tool-Call Reliability',
      description: 'Proportion of tool execution attempts that succeed without infrastructure timeout or code failure.',
      source: 'tool_executions',
      calculation: '(successful_tool_executions / total_tool_execution_attempts) * 100',
      unit: 'percentage',
      window,
      targetRange: {
        min: 99.0,
        healthyThreshold: 99.0,
        higherIsBetter: true,
      },
      actualValue,
      numerator: successfulCalls,
      sampleCount: totalCalls,
      status,
      drillDown: {
        successful_calls: successfulCalls,
        total_attempts: totalCalls,
      },
    };
  }

  private calculateRecoveryRate(
    runs: Array<{ status: string; error_message: string | null; step_count: number }>,
    window: WindowType
  ): MetricDefinition {
    // Runs that encountered an error or required retry steps
    let failedOrRetriedCount = 0;
    let recoveredCount = 0;

    for (const r of runs) {
      if (r.error_message || r.step_count > 3) {
        failedOrRetriedCount += 1;
        if (r.status === 'completed') {
          recoveredCount += 1;
        }
      }
    }

    const actualValue =
      failedOrRetriedCount > 0 ? Math.round((recoveredCount / failedOrRetriedCount) * 1000) / 10 : null;
    const status: MetricStatus =
      actualValue === null
        ? 'unmeasured'
        : actualValue >= 85.0
        ? 'healthy'
        : actualValue >= 70.0
        ? 'warning'
        : 'critical';

    return {
      key: 'recovery_rate',
      name: 'Recovery Rate',
      description: 'Proportion of initially degraded, retried, or compensated tasks that ultimately recover.',
      source: 'graph_runs, durable_jobs',
      calculation: '(recovered_runs / total_degraded_runs) * 100',
      unit: 'percentage',
      window,
      targetRange: {
        min: 85.0,
        healthyThreshold: 85.0,
        higherIsBetter: true,
      },
      actualValue,
      numerator: recoveredCount,
      sampleCount: failedOrRetriedCount,
      status,
      drillDown: {
        recovered_count: recoveredCount,
        degraded_count: failedOrRetriedCount,
      },
    };
  }

  private calculateEscalationRate(
    runs: Array<{ id: string }>,
    attentionItems: Array<{ id: string }>,
    window: WindowType
  ): MetricDefinition {
    const totalRuns = runs.length;
    const totalEscalations = attentionItems.length;

    // Escalation rate is escalations / totalRuns. If totalRuns === 0, null
    const actualValue = totalRuns > 0 ? Math.round((totalEscalations / totalRuns) * 1000) / 10 : null;
    const status: MetricStatus =
      actualValue === null
        ? 'unmeasured'
        : actualValue <= 10.0
        ? 'healthy'
        : actualValue <= 20.0
        ? 'warning'
        : 'critical';

    return {
      key: 'escalation_rate',
      name: 'Escalation Rate',
      description: 'Proportion of workflow runs requiring human attention escalation or manual intervention.',
      source: 'attention_items, graph_runs',
      calculation: '(attention_items_count / total_workflow_runs) * 100',
      unit: 'percentage',
      window,
      targetRange: {
        max: 10.0,
        healthyThreshold: 10.0,
        higherIsBetter: false, // Lower is better
      },
      actualValue,
      numerator: totalEscalations,
      sampleCount: totalRuns,
      status,
      drillDown: {
        escalations: totalEscalations,
        total_runs: totalRuns,
      },
    };
  }

  private calculateCostPerVerifiedOutcome(
    costRecords: Array<{ total_cost_usd: number }>,
    proofs: Array<{ body_json: string }>,
    verifications: Array<{ status: string }>,
    outcomes: Array<{ outcome_status: string }>,
    window: WindowType
  ): MetricDefinition {
    const totalCostUsd = costRecords.reduce((sum, r) => sum + r.total_cost_usd, 0);

    let verifiedCount = 0;
    for (const p of proofs) {
      try {
        const body = JSON.parse(p.body_json);
        if (body.verification?.state === 'verified') verifiedCount += 1;
      } catch {}
    }
    for (const v of verifications) {
      if (v.status === 'verified') verifiedCount += 1;
    }
    for (const o of outcomes) {
      if (o.outcome_status === 'achieved') verifiedCount += 1;
    }

    const actualValue = verifiedCount > 0 ? Math.round((totalCostUsd / verifiedCount) * 1000) / 1000 : null;
    const status: MetricStatus =
      actualValue === null ? 'unmeasured' : actualValue <= 1.5 ? 'healthy' : 'warning';

    return {
      key: 'cost_per_verified_outcome',
      name: 'Cost per Verified Outcome',
      description: 'Total platform and inference spend divided by the count of verified business outcomes delivered.',
      source: 'cost_attribution_records, proof_receipts, business_outcomes',
      calculation: 'total_spend_usd / verified_outcomes_count',
      unit: 'usd',
      window,
      targetRange: {
        max: 1.5,
        healthyThreshold: 1.5,
        higherIsBetter: false, // Lower is better
      },
      actualValue,
      numerator: Math.round(totalCostUsd * 1000) / 1000,
      sampleCount: verifiedCount,
      status,
      drillDown: {
        total_spend_usd: Math.round(totalCostUsd * 1000) / 1000,
        verified_outcomes: verifiedCount,
      },
    };
  }

  private calculateCascadeMix(events: Array<{ cascade_level: CascadeLevel; cost_usd: number; latency_ms: number; resolved: number }>): CascadeMixSummary {
    const levelsMap: Record<CascadeLevel, CascadeLevelStats> = {
      L0_rule: { level: 'L0_rule', count: 0, percentage: 0, costUsd: 0, avgLatencyMs: 0, resolvedCount: 0 },
      L1_cache: { level: 'L1_cache', count: 0, percentage: 0, costUsd: 0, avgLatencyMs: 0, resolvedCount: 0 },
      L2_fast_model: { level: 'L2_fast_model', count: 0, percentage: 0, costUsd: 0, avgLatencyMs: 0, resolvedCount: 0 },
      L3_reasoning_model: { level: 'L3_reasoning_model', count: 0, percentage: 0, costUsd: 0, avgLatencyMs: 0, resolvedCount: 0 },
      human_review: { level: 'human_review', count: 0, percentage: 0, costUsd: 0, avgLatencyMs: 0, resolvedCount: 0 },
    };

    const validEvents = events.filter((e) => Boolean(levelsMap[e.cascade_level]));
    const totalInvocations = validEvents.length;

    let actualCostSum = 0;
    let l0L1ResolvedSum = 0;

    for (const e of validEvents) {
      const stats = levelsMap[e.cascade_level];
      stats.count += 1;
      stats.costUsd += e.cost_usd;
      stats.avgLatencyMs += e.latency_ms;
      if (e.resolved === 1) {
        stats.resolvedCount += 1;
        if (e.cascade_level === 'L0_rule' || e.cascade_level === 'L1_cache') {
          l0L1ResolvedSum += 1;
        }
      }
      actualCostSum += e.cost_usd;
    }

    for (const lvl of Object.values(levelsMap)) {
      if (totalInvocations > 0) {
        lvl.percentage = Math.round((lvl.count / totalInvocations) * 1000) / 10;
      }
      if (lvl.count > 0) {
        lvl.avgLatencyMs = Math.round(lvl.avgLatencyMs / lvl.count);
        lvl.costUsd = Math.round(lvl.costUsd * 1000) / 1000;
      }
    }

    const baselineL3Cost = totalInvocations * L3_BENCHMARK_COST_USD;
    const estimatedSavingsUsd = Math.max(0, Math.round((baselineL3Cost - actualCostSum) * 1000) / 1000);
    const l0L1DeflectionRate =
      totalInvocations > 0 ? Math.round((l0L1ResolvedSum / totalInvocations) * 1000) / 10 : null;

    return {
      totalInvocations,
      levels: levelsMap,
      estimatedSavingsUsd,
      l0L1DeflectionRate,
    };
  }

  private generateClientValueReport(
    tenantId: string,
    runs: Array<{ graph_id: string; status: string }>,
    proofs: Array<{ body_json: string }>,
    verifications: Array<{ status: string }>,
    outcomes: Array<{ value_generated_usd: number; outcome_status: string }>,
    attentionItems: Array<{ id: string }>,
    costRecords: Array<{ total_cost_usd: number }>,
    window: WindowType,
    periodStart: string,
    periodEnd: string
  ): ClientValueReport {
    const tasksCompleted = runs.filter((r) => r.status === 'completed').length;
    let verifiedOutcomesCount = 0;
    for (const p of proofs) {
      try {
        const b = JSON.parse(p.body_json);
        if (b.verification?.state === 'verified') verifiedOutcomesCount += 1;
      } catch {}
    }
    for (const v of verifications) {
      if (v.status === 'verified') verifiedOutcomesCount += 1;
    }
    for (const o of outcomes) {
      if (o.outcome_status === 'achieved') verifiedOutcomesCount += 1;
    }

    // Benchmark human hours avoided:
    // 0.25 hrs for intake/triage, 0.33 hrs for booking, 0.5 hrs for doctor leave/refund, 0.2 hrs generic
    let humanHoursAvoided = 0;
    for (const r of runs) {
      if (r.status === 'completed') {
        if (r.graph_id.includes('intake')) humanHoursAvoided += 0.25;
        else if (r.graph_id.includes('scheduling') || r.graph_id.includes('booking')) humanHoursAvoided += 0.33;
        else if (r.graph_id.includes('leave') || r.graph_id.includes('refund')) humanHoursAvoided += 0.5;
        else humanHoursAvoided += 0.2;
      }
    }
    humanHoursAvoided = Math.round(humanHoursAvoided * 10) / 10;

    const revenueInfluencedUsd = outcomes.reduce((sum, o) => sum + o.value_generated_usd, 0);
    const totalCostUsd = Math.round(costRecords.reduce((sum, c) => sum + c.total_cost_usd, 0) * 1000) / 1000;
    const escalationsCount = attentionItems.length;

    const costPerOutcomeUsd =
      verifiedOutcomesCount > 0 ? Math.round((totalCostUsd / verifiedOutcomesCount) * 1000) / 1000 : null;

    const laborValueUsd = humanHoursAvoided * HOURLY_LABOR_RATE_USD;
    const totalValueDeliveredUsd = revenueInfluencedUsd + laborValueUsd;
    const netRoiMultiplier =
      totalCostUsd > 0 ? Math.round((totalValueDeliveredUsd / totalCostUsd) * 10) / 10 : null;

    return {
      tenantId,
      periodStart,
      periodEnd,
      window,
      tasksCompleted,
      verifiedOutcomesCount,
      humanHoursAvoided,
      revenueInfluencedUsd: Math.round(revenueInfluencedUsd * 100) / 100,
      escalationsCount,
      totalCostUsd,
      costPerOutcomeUsd,
      netRoiMultiplier,
      topPerformingAgents: [],
    };
  }

  private calculateAgentRollups(
    runs: Array<{ graph_id: string; status: string }>,
    toolCalls: Array<{ agent_id: string | null; status: string }>,
    proofs: Array<{ body_json: string }>,
    attentionItems: Array<{ source_agent_id: string }>,
    costRecords: Array<{ agent_id: string; total_cost_usd: number }>
  ): Record<string, AgentKpiRollup> {
    const map = new Map<string, AgentKpiRollup>();

    const getOrCreate = (agentId: string): AgentKpiRollup => {
      let r = map.get(agentId);
      if (!r) {
        r = {
          agentId,
          name: this.formatAgentName(agentId),
          runsCount: 0,
          completedCount: 0,
          resolutionRate: null,
          toolCallsCount: 0,
          toolReliability: null,
          verifiedActionsCount: 0,
          verifiedActionRate: null,
          escalationCount: 0,
          escalationRate: null,
          totalCostUsd: 0,
          costPerOutcomeUsd: null,
        };
        map.set(agentId, r);
      }
      return r;
    };

    for (const t of toolCalls) {
      if (t.agent_id) {
        const r = getOrCreate(t.agent_id);
        r.toolCallsCount += 1;
      }
    }
    for (const a of attentionItems) {
      if (a.source_agent_id) {
        const r = getOrCreate(a.source_agent_id);
        r.escalationCount += 1;
      }
    }
    for (const c of costRecords) {
      if (c.agent_id) {
        const r = getOrCreate(c.agent_id);
        r.totalCostUsd += c.total_cost_usd;
      }
    }

    // Finalize rates
    for (const r of map.values()) {
      r.totalCostUsd = Math.round(r.totalCostUsd * 1000) / 1000;
    }

    return Object.fromEntries(map.entries());
  }

  private calculateWorkflowRollups(
    runs: Array<{ graph_id: string; status: string; error_message: string | null }>,
    proofs: Array<{ run_id: string | null; body_json: string }>,
    attentionItems: Array<{ id: string }>,
    costRecords: Array<{ workflow_execution_id: string | null; total_cost_usd: number }>
  ): Record<string, WorkflowKpiRollup> {
    const map = new Map<string, WorkflowKpiRollup>();

    for (const run of runs) {
      let r = map.get(run.graph_id);
      if (!r) {
        r = {
          workflowId: run.graph_id,
          name: this.formatWorkflowName(run.graph_id),
          runsCount: 0,
          completedCount: 0,
          resolutionRate: null,
          recoveredCount: 0,
          recoveryRate: null,
          escalationsCount: 0,
          escalationRate: null,
          verifiedActionsCount: 0,
          verifiedActionRate: null,
          totalCostUsd: 0,
          costPerOutcomeUsd: null,
        };
        map.set(run.graph_id, r);
      }
      r.runsCount += 1;
      if (run.status === 'completed') r.completedCount += 1;
      if (run.error_message && run.status === 'completed') r.recoveredCount += 1;
    }

    for (const r of map.values()) {
      r.resolutionRate = r.runsCount > 0 ? Math.round((r.completedCount / r.runsCount) * 1000) / 10 : null;
    }

    return Object.fromEntries(map.entries());
  }

  private resolveTimeWindow(
    window: WindowType,
    customStart?: string,
    customEnd?: string
  ): { since: string; until: string } {
    const now = new Date();
    const until = customEnd ? new Date(customEnd).toISOString() : now.toISOString();

    if (window === 'custom' && customStart) {
      return { since: new Date(customStart).toISOString(), until };
    }

    const start = new Date(now);
    switch (window) {
      case '1h':
        start.setHours(start.getHours() - 1);
        break;
      case '24h':
        start.setHours(start.getHours() - 24);
        break;
      case '7d':
        start.setDate(start.getDate() - 7);
        break;
      case '30d':
        start.setDate(start.getDate() - 30);
        break;
      default:
        start.setHours(start.getHours() - 24);
    }

    return { since: start.toISOString(), until };
  }

  private formatAgentName(slug: string): string {
    return slug
      .split('_')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }

  private formatWorkflowName(slug: string): string {
    return slug
      .split('_')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }
}
