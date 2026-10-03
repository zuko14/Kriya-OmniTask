/**
 * Kriya Omnitask — Outcome Instrumentation & Blueprint KPI Framework Unit Tests
 * (docs/kriya WP-6.1, Blueprint §14, CLAUDE.md §35, §39; S53; ADR-024)
 *
 * Comprehensive test suite validating:
 * 1. Metric metadata completeness per CLAUDE.md §39 (source, calculation, window, drill-down).
 * 2. Zero-fabrication honest baselines (null values when unmeasured, S53 rule).
 * 3. Verified-action rate calculation with proof receipts and verification states.
 * 4. Resolution rate calculation across workflow runs and business outcomes.
 * 5. Tool-call reliability calculation from tool execution attempts.
 * 6. Recovery rate calculation from error/retry runs that completed.
 * 7. Escalation rate calculation from human Attention Center items.
 * 8. Cost per verified outcome calculation joining spend with verified proofs.
 * 9. Cost cascade (L0-L3) level mix, deflection rate, and estimated savings.
 * 10. Client Value Report calculation (human hours avoided, revenue, net ROI).
 * 11. Multi-tenant isolation (zero metric cross-contamination).
 * 12. Fastify REST API routes (/api/v1/outcomes/*).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteDatabaseClient, db } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { TenantRepository } from '../../src/storage/repositories/tenantRepository.js';
import { TenantContextManager } from '../../src/core/context/tenantContext.js';
import { OutcomeKpiRepository } from '../../src/outcomes/repositories/outcomeKpiRepository.js';
import { OutcomeInstrumentationService } from '../../src/outcomes/service/outcomeInstrumentationService.js';
import { JwtService } from '../../src/security/auth/jwt.js';
import { buildServer } from '../../src/api/server.js';
import { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';

describe('WP-6.1 Outcome Instrumentation & Blueprint KPI Framework Tests', () => {
  let client: SQLiteDatabaseClient;
  let tenantId: string;
  let tenantIdB: string;
  let repo: OutcomeKpiRepository;
  let service: OutcomeInstrumentationService;
  let server: FastifyInstance;

  beforeEach(async () => {
    client = new SQLiteDatabaseClient(':memory:');
    db.setClientForTesting(client);

    const migrator = new SchemaMigrator(client);
    await migrator.applyMigrations();

    const tenantRepo = new TenantRepository(client);
    const tenantA = await tenantRepo.create({
      name: 'Apollo Hospital Indiranagar',
      slug: `apollo-${randomUUID().slice(0, 8)}`,
      plan_tier: 'enterprise',
      channel_plan: 'combined',
    });
    tenantId = tenantA.id;

    const tenantB = await tenantRepo.create({
      name: 'Fortis Healthcare Richmond',
      slug: `fortis-${randomUUID().slice(0, 8)}`,
      plan_tier: 'growth',
      channel_plan: 'combined',
    });
    tenantIdB = tenantB.id;

    await client.execute(
      `INSERT OR IGNORE INTO proof_signing_keys (key_id, algorithm, public_key_pem, status, created_at)
       VALUES (?, ?, ?, ?, ?);`,
      ['test-key-1', 'ed25519', 'pem-dummy', 'active', new Date().toISOString()]
    );

    repo = new OutcomeKpiRepository(client);
    service = new OutcomeInstrumentationService(repo, client);
  });

  afterEach(async () => {
    if (server) {
      await server.close();
    }
    client.close();
  });

  // ---------------------------------------------------------------------------
  // Suite 1: Metric Definitions & Metadata Completeness (CLAUDE.md §39)
  // ---------------------------------------------------------------------------
  describe('Suite 1: Metric Definitions & Metadata Completeness', () => {
    it('returns all 6 Blueprint core metrics with complete calculation metadata', async () => {
      await TenantContextManager.withTenant(tenantId, 'default', async () => {
        const overview = await service.getBlueprintKpiOverview({ window: '24h' });

        expect(overview.tenantId).toBe(tenantId);
        expect(overview.window).toBe('24h');
        expect(overview.metrics).toBeDefined();

        const {
          verifiedActionRate,
          resolutionRate,
          toolCallReliability,
          recoveryRate,
          escalationRate,
          costPerVerifiedOutcome,
        } = overview.metrics;

        // 1. Verified Action Rate
        expect(verifiedActionRate.key).toBe('verified_action_rate');
        expect(verifiedActionRate.name).toBe('Verified-Action Rate');
        expect(verifiedActionRate.source).toContain('proof_receipts');
        expect(verifiedActionRate.calculation).toContain('verified_consequential_actions');
        expect(verifiedActionRate.unit).toBe('percentage');
        expect(verifiedActionRate.targetRange.healthyThreshold).toBe(99.0);
        expect(verifiedActionRate.targetRange.higherIsBetter).toBe(true);

        // 2. Resolution Rate
        expect(resolutionRate.key).toBe('resolution_rate');
        expect(resolutionRate.name).toBe('Resolution Rate');
        expect(resolutionRate.source).toContain('graph_runs');
        expect(resolutionRate.calculation).toContain('resolved_runs');
        expect(resolutionRate.unit).toBe('percentage');

        // 3. Tool-Call Reliability
        expect(toolCallReliability.key).toBe('tool_call_reliability');
        expect(toolCallReliability.source).toContain('tool_executions');
        expect(toolCallReliability.unit).toBe('percentage');

        // 4. Recovery Rate
        expect(recoveryRate.key).toBe('recovery_rate');
        expect(recoveryRate.source).toContain('graph_runs');
        expect(recoveryRate.unit).toBe('percentage');

        // 5. Escalation Rate
        expect(escalationRate.key).toBe('escalation_rate');
        expect(escalationRate.source).toContain('attention_items');
        expect(escalationRate.unit).toBe('percentage');
        expect(escalationRate.targetRange.higherIsBetter).toBe(false);

        // 6. Cost per Verified Outcome
        expect(costPerVerifiedOutcome.key).toBe('cost_per_verified_outcome');
        expect(costPerVerifiedOutcome.source).toContain('cost_attribution_records');
        expect(costPerVerifiedOutcome.unit).toBe('usd');
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Suite 2: Zero-Fabrication Honest Baseline Guarantees (S53 Rule)
  // ---------------------------------------------------------------------------
  describe('Suite 2: Zero-Fabrication Honest Baseline Guarantees (S53 Rule)', () => {
    it('returns null and unmeasured status when 0 samples exist (never 100% or 1.0)', async () => {
      await TenantContextManager.withTenant(tenantId, 'default', async () => {
        const overview = await service.getBlueprintKpiOverview({ window: '24h' });

        for (const [key, metric] of Object.entries(overview.metrics)) {
          expect(metric.sampleCount).toBe(0);
          expect(metric.actualValue).toBeNull();
          expect(metric.status).toBe('unmeasured');
        }

        // Deflection rate should also be null when no cascade events exist
        expect(overview.cascadeMix.totalInvocations).toBe(0);
        expect(overview.cascadeMix.l0L1DeflectionRate).toBeNull();
        expect(overview.cascadeMix.estimatedSavingsUsd).toBe(0);

        // Client value report cost per outcome & ROI should be null when unmeasured
        expect(overview.clientValueReport.costPerOutcomeUsd).toBeNull();
        expect(overview.clientValueReport.netRoiMultiplier).toBeNull();
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Suite 3: Verified-Action Rate Calculation
  // ---------------------------------------------------------------------------
  describe('Suite 3: Verified-Action Rate Calculation', () => {
    it('computes verified-action rate accurately based on proof receipts and verification states', async () => {
      await TenantContextManager.withTenant(tenantId, 'default', async () => {
        const now = new Date().toISOString();

        // Insert 3 consequential actions with verified state
        for (let i = 1; i <= 3; i++) {
          await client.execute(
            `INSERT INTO proof_receipts (id, tenant_id, sequence, run_id, node_id, action_type, risk_tier, body_json, prev_hash, hash, key_id, signature, issued_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
            [
              `receipt-${i}`,
              tenantId,
              i,
              `run-${i}`,
              'node_1',
              'payment_create_link',
              'T2',
              JSON.stringify({ verification: { state: 'verified' } }),
              '0'.repeat(64),
              'hash1',
              'test-key-1',
              'sig1',
              now,
            ]
          );
        }

        // Insert 1 consequential action with unverified/pending state
        await client.execute(
          `INSERT INTO proof_receipts (id, tenant_id, sequence, run_id, node_id, action_type, risk_tier, body_json, prev_hash, hash, key_id, signature, issued_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
          [
            'receipt-4',
            tenantId,
            4,
            'run-4',
            'node_1',
            'calendar_sync_event',
            'MEDIUM',
            JSON.stringify({ verification: { state: 'pending' } }),
            'hash1',
            'hash2',
            'test-key-1',
            'sig2',
            now,
          ]
        );

        const overview = await service.getBlueprintKpiOverview({ window: '24h' });
        const metric = overview.metrics.verifiedActionRate;

        // 3 verified out of 4 consequential = 75.0%
        expect(metric.sampleCount).toBe(4);
        expect(metric.numerator).toBe(3);
        expect(metric.actualValue).toBe(75.0);
        expect(metric.status).toBe('critical'); // Below 95% target
      });
    });

    it('marks verified-action rate healthy when >= 99%', async () => {
      await TenantContextManager.withTenant(tenantId, 'default', async () => {
        const now = new Date().toISOString();

        for (let i = 1; i <= 100; i++) {
          await client.execute(
            `INSERT INTO proof_receipts (id, tenant_id, sequence, run_id, node_id, action_type, risk_tier, body_json, prev_hash, hash, key_id, signature, issued_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
            [
              `receipt-h-${i}`,
              tenantId,
              i,
              `run-h-${i}`,
              'node_1',
              'financial_refund',
              'T2',
              JSON.stringify({ verification: { state: 'verified' } }),
              '0'.repeat(64),
              'hash1',
              'test-key-1',
              'sig1',
              now,
            ]
          );
        }

        const overview = await service.getBlueprintKpiOverview({ window: '24h' });
        expect(overview.metrics.verifiedActionRate.actualValue).toBe(100.0);
        expect(overview.metrics.verifiedActionRate.status).toBe('healthy');
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Suite 4: Resolution Rate Calculation
  // ---------------------------------------------------------------------------
  describe('Suite 4: Resolution Rate Calculation', () => {
    it('computes resolution rate from completed graph runs and business outcomes', async () => {
      await TenantContextManager.withTenant(tenantId, 'default', async () => {
        const now = new Date().toISOString();

        // 4 completed runs
        for (let i = 1; i <= 4; i++) {
          await client.execute(
            `INSERT INTO graph_runs (id, tenant_id, graph_id, graph_version, graph_json, status, outcome, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
            [`run-c-${i}`, tenantId, 'intake_graph', '1.0', '{}', 'completed', 'resolved', now, now]
          );
        }

        // 1 failed run
        await client.execute(
          `INSERT INTO graph_runs (id, tenant_id, graph_id, graph_version, graph_json, status, outcome, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
          ['run-f-1', tenantId, 'intake_graph', '1.0', '{}', 'failed', 'failed', now, now]
        );

        const overview = await service.getBlueprintKpiOverview({ window: '24h' });
        const metric = overview.metrics.resolutionRate;

        // 4 completed out of 5 total = 80.0%
        expect(metric.sampleCount).toBe(5);
        expect(metric.numerator).toBe(4);
        expect(metric.actualValue).toBe(80.0);
        expect(metric.status).toBe('warning');
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Suite 5: Tool-Call Reliability Calculation
  // ---------------------------------------------------------------------------
  describe('Suite 5: Tool-Call Reliability Calculation', () => {
    it('computes tool call reliability percentage from tool executions', async () => {
      await TenantContextManager.withTenant(tenantId, 'default', async () => {
        const now = new Date().toISOString();

        // 19 completed tool calls
        for (let i = 1; i <= 19; i++) {
          await client.execute(
            `INSERT INTO tool_executions (id, tenant_id, agent_id, tool_slug, status, input_json, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
            [`tool-c-${i}`, tenantId, 'scheduling_agent', 'calendar_get_availability', 'completed', '{}', now, now]
          );
        }

        // 1 failed tool call
        await client.execute(
          `INSERT INTO tool_executions (id, tenant_id, agent_id, tool_slug, status, input_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
          ['tool-f-1', tenantId, 'scheduling_agent', 'calendar_sync_event', 'failed', '{}', now, now]
        );

        const overview = await service.getBlueprintKpiOverview({ window: '24h' });
        const metric = overview.metrics.toolCallReliability;

        // 19 / 20 = 95.0%
        expect(metric.sampleCount).toBe(20);
        expect(metric.numerator).toBe(19);
        expect(metric.actualValue).toBe(95.0);
        expect(metric.status).toBe('warning');
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Suite 6: Recovery Rate Calculation
  // ---------------------------------------------------------------------------
  describe('Suite 6: Recovery Rate Calculation', () => {
    it('computes recovery rate for degraded/retried workflows that completed', async () => {
      await TenantContextManager.withTenant(tenantId, 'default', async () => {
        const now = new Date().toISOString();

        // 2 runs had error messages but completed (recovered)
        for (let i = 1; i <= 2; i++) {
          await client.execute(
            `INSERT INTO graph_runs (id, tenant_id, graph_id, graph_version, graph_json, status, error_message, step_count, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
            [`run-rec-${i}`, tenantId, 'doctor_leave_wf', '1.0', '{}', 'completed', 'retryable timeout', 5, now, now]
          );
        }

        // 1 run had an error message and ended in failed
        await client.execute(
          `INSERT INTO graph_runs (id, tenant_id, graph_id, graph_version, graph_json, status, error_message, step_count, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
          ['run-unrec-1', tenantId, 'doctor_leave_wf', '1.0', '{}', 'failed', 'fatal database error', 4, now, now]
        );

        const overview = await service.getBlueprintKpiOverview({ window: '24h' });
        const metric = overview.metrics.recoveryRate;

        // 2 recovered out of 3 degraded = 66.7%
        expect(metric.sampleCount).toBe(3);
        expect(metric.numerator).toBe(2);
        expect(metric.actualValue).toBe(66.7);
        expect(metric.status).toBe('critical');
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Suite 7: Escalation Rate Calculation
  // ---------------------------------------------------------------------------
  describe('Suite 7: Escalation Rate Calculation', () => {
    it('computes escalation rate as percentage of workflows escalating to Attention Center', async () => {
      await TenantContextManager.withTenant(tenantId, 'default', async () => {
        const now = new Date().toISOString();

        // 10 runs
        for (let i = 1; i <= 10; i++) {
          await client.execute(
            `INSERT INTO graph_runs (id, tenant_id, graph_id, graph_version, graph_json, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
            [`run-esc-${i}`, tenantId, 'intake_wf', '1.0', '{}', 'completed', now, now]
          );
        }

        // 1 attention escalation item
        await client.execute(
          `INSERT INTO attention_items (id, tenant_id, correlation_id, source_agent_id, title, description, reason_category, priority, status, sla_expires_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
          [
            'att-1',
            tenantId,
            'corr-1',
            'intake_agent',
            'Emergency escalation',
            'Patient symptoms triage',
            'policy_violation',
            'P0_CRITICAL',
            'pending',
            now,
            now,
            now,
          ]
        );

        const overview = await service.getBlueprintKpiOverview({ window: '24h' });
        const metric = overview.metrics.escalationRate;

        // 1 escalation / 10 runs = 10.0% (healthy ceiling is 10.0%)
        expect(metric.sampleCount).toBe(10);
        expect(metric.numerator).toBe(1);
        expect(metric.actualValue).toBe(10.0);
        expect(metric.status).toBe('healthy');
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Suite 8: Cost per Verified Outcome Calculation
  // ---------------------------------------------------------------------------
  describe('Suite 8: Cost per Verified Outcome Calculation', () => {
    it('computes total spend divided by verified outcomes accurately', async () => {
      await TenantContextManager.withTenant(tenantId, 'default', async () => {
        const now = new Date().toISOString();

        // Insert cost records: 2 records of $0.05 = $0.10 total
        await client.execute(
          `INSERT INTO cost_attribution_records (id, tenant_id, organization_id, agent_id, task_id, cost_category, provider, resource_metric_name, resource_quantity, unit_cost_usd, total_cost_usd, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
          ['c-1', tenantId, 'default', 'intake_agent', 't-1', 'token_llm', 'deepseek', 'prompt_tokens', 1000, 0.00005, 0.05, now]
        );
        await client.execute(
          `INSERT INTO cost_attribution_records (id, tenant_id, organization_id, agent_id, task_id, cost_category, provider, resource_metric_name, resource_quantity, unit_cost_usd, total_cost_usd, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
          ['c-2', tenantId, 'default', 'scheduling_agent', 't-2', 'token_llm', 'deepseek', 'completion_tokens', 1000, 0.00005, 0.05, now]
        );

        // Insert 1 verified proof receipt
        await client.execute(
          `INSERT INTO proof_receipts (id, tenant_id, sequence, run_id, node_id, action_type, risk_tier, body_json, prev_hash, hash, key_id, signature, issued_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
          [
            'receipt-cost-1',
            tenantId,
            1,
            'run-1',
            'node_1',
            'appointment_booking',
            'T2',
            JSON.stringify({ verification: { state: 'verified' } }),
            '0'.repeat(64),
            'hash1',
            'test-key-1',
            'sig1',
            now,
          ]
        );

        const overview = await service.getBlueprintKpiOverview({ window: '24h' });
        const metric = overview.metrics.costPerVerifiedOutcome;

        // $0.10 / 1 outcome = $0.10
        expect(metric.numerator).toBe(0.1);
        expect(metric.sampleCount).toBe(1);
        expect(metric.actualValue).toBe(0.1);
        expect(metric.status).toBe('healthy');
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Suite 9: Cost Cascade (L0-L3) Level Mix & Deflection
  // ---------------------------------------------------------------------------
  describe('Suite 9: Cost Cascade (L0-L3) Level Mix & Deflection', () => {
    it('records cascade execution events and calculates deflection rate and cost savings', async () => {
      await TenantContextManager.withTenant(tenantId, 'default', async () => {
        // Record 5 events: 3 L0 deterministic ($0), 1 L1 cache ($0), 1 L2 fast model ($0.001)
        await service.recordCascadeEvent({
          agentId: 'intake_agent',
          cascadeLevel: 'L0_rule',
          ruleName: 'intake_l0_emergency',
          resolved: true,
          latencyMs: 2,
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
        });

        await service.recordCascadeEvent({
          agentId: 'intake_agent',
          cascadeLevel: 'L0_rule',
          ruleName: 'intake_l0_hours',
          resolved: true,
          latencyMs: 1,
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
        });

        await service.recordCascadeEvent({
          agentId: 'document_agent',
          cascadeLevel: 'L0_rule',
          ruleName: 'leave_notice_regex',
          resolved: true,
          latencyMs: 4,
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
        });

        await service.recordCascadeEvent({
          agentId: 'intake_agent',
          cascadeLevel: 'L1_cache',
          resolved: true,
          latencyMs: 8,
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
        });

        await service.recordCascadeEvent({
          agentId: 'scheduling_agent',
          cascadeLevel: 'L2_fast_model',
          modelId: 'deepseek/deepseek-v4-flash',
          resolved: true,
          latencyMs: 320,
          inputTokens: 250,
          outputTokens: 80,
          costUsd: 0.001,
        });

        const overview = await service.getBlueprintKpiOverview({ window: '24h' });
        const { cascadeMix } = overview;

        expect(cascadeMix.totalInvocations).toBe(5);
        expect(cascadeMix.levels.L0_rule.count).toBe(3);
        expect(cascadeMix.levels.L0_rule.percentage).toBe(60.0);
        expect(cascadeMix.levels.L1_cache.count).toBe(1);
        expect(cascadeMix.levels.L1_cache.percentage).toBe(20.0);
        expect(cascadeMix.levels.L2_fast_model.count).toBe(1);
        expect(cascadeMix.levels.L2_fast_model.percentage).toBe(20.0);

        // Deflection rate: 4 / 5 = 80.0% resolved without LLM inference
        expect(cascadeMix.l0L1DeflectionRate).toBe(80.0);

        // Savings: baseline (5 * $0.015 = $0.075) - actual ($0.001) = $0.074 saved
        expect(cascadeMix.estimatedSavingsUsd).toBe(0.074);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Suite 10: Client Value Report & Net ROI Multiplier
  // ---------------------------------------------------------------------------
  describe('Suite 10: Client Value Report & Net ROI Multiplier', () => {
    it('estimates human hours avoided and net ROI multiplier', async () => {
      await TenantContextManager.withTenant(tenantId, 'default', async () => {
        const now = new Date().toISOString();

        // 2 completed intake runs (0.25h * 2 = 0.5h)
        await client.execute(
          `INSERT INTO graph_runs (id, tenant_id, graph_id, graph_version, graph_json, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
          ['run-iv-1', tenantId, 'intake_graph', '1.0', '{}', 'completed', now, now]
        );
        await client.execute(
          `INSERT INTO graph_runs (id, tenant_id, graph_id, graph_version, graph_json, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
          ['run-iv-2', tenantId, 'intake_graph', '1.0', '{}', 'completed', now, now]
        );

        // 1 completed doctor leave workflow (0.50h * 1 = 0.5h) -> Total 1.0 hr avoided
        await client.execute(
          `INSERT INTO graph_runs (id, tenant_id, graph_id, graph_version, graph_json, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
          ['run-lv-1', tenantId, 'doctor_leave_graph', '1.0', '{}', 'completed', now, now]
        );

        // Business outcome: $50 revenue generated
        await client.execute(
          `INSERT INTO business_outcomes (id, tenant_id, organization_id, agent_id, outcome_type, outcome_status, value_generated_usd, total_cost_usd, roi_multiplier, outcome_metadata_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
          ['bo-1', tenantId, 'default', 'scheduling_agent', 'meeting_scheduled', 'achieved', 50.0, 0.05, 1000.0, '{}', now]
        );

        // Cost record of $1.00
        await client.execute(
          `INSERT INTO cost_attribution_records (id, tenant_id, organization_id, agent_id, task_id, cost_category, provider, resource_metric_name, resource_quantity, unit_cost_usd, total_cost_usd, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
          ['c-roi-1', tenantId, 'default', 'intake_agent', 't-1', 'token_llm', 'deepseek', 'prompt_tokens', 1000, 0.001, 1.0, now]
        );

        const overview = await service.getBlueprintKpiOverview({ window: '24h' });
        const report = overview.clientValueReport;

        expect(report.tasksCompleted).toBe(3);
        expect(report.humanHoursAvoided).toBe(1.0);
        expect(report.revenueInfluencedUsd).toBe(50.0);
        expect(report.totalCostUsd).toBe(1.0);

        // Labor value = 1.0 hr * $25 = $25. Total value = $50 + $25 = $75.
        // Net ROI = $75 / $1.00 = 75.0x
        expect(report.netRoiMultiplier).toBe(75.0);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Suite 11: Multi-Tenant Isolation
  // ---------------------------------------------------------------------------
  describe('Suite 11: Multi-Tenant Isolation Verification', () => {
    it('strictly isolates metrics between Tenant A and Tenant B', async () => {
      const now = new Date().toISOString();

      // Tenant A has 10 runs and 10 proof receipts
      await TenantContextManager.withTenant(tenantId, 'default', async () => {
        for (let i = 1; i <= 10; i++) {
          await client.execute(
            `INSERT INTO graph_runs (id, tenant_id, graph_id, graph_version, graph_json, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
            [`run-ta-${i}`, tenantId, 'intake_graph', '1.0', '{}', 'completed', now, now]
          );
        }
      });

      // Tenant B has 0 runs
      await TenantContextManager.withTenant(tenantIdB, 'default', async () => {
        const overviewB = await service.getBlueprintKpiOverview({ window: '24h' });

        expect(overviewB.tenantId).toBe(tenantIdB);
        expect(overviewB.metrics.resolutionRate.sampleCount).toBe(0);
        expect(overviewB.metrics.resolutionRate.actualValue).toBeNull();
        expect(overviewB.metrics.verifiedActionRate.sampleCount).toBe(0);
        expect(overviewB.clientValueReport.tasksCompleted).toBe(0);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // Suite 12: Fastify REST API Routes
  // ---------------------------------------------------------------------------
  describe('Suite 12: Fastify REST API Routes', () => {
    beforeEach(async () => {
      server = await buildServer();
    });

    it('rejects unauthenticated requests to /api/v1/outcomes/kpis with 401', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/v1/outcomes/kpis',
      });
      expect(res.statusCode).toBe(401);
    });

    it('returns Blueprint KPI Overview for authenticated tenant', async () => {
      const token = JwtService.signToken({
        userId: 'admin-user-1',
        email: 'admin@apollo.com',
        tenantId,
        roles: ['admin', 'owner'],
      });

      const res = await server.inject({
        method: 'GET',
        url: '/api/v1/outcomes/kpis?window=24h',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.tenantId).toBe(tenantId);
      expect(data.metrics.verifiedActionRate).toBeDefined();
    });

    it('returns Cost per Outcome Report via REST endpoint for WP-7.5 screen', async () => {
      const token = JwtService.signToken({
        userId: 'admin-user-1',
        email: 'admin@apollo.com',
        tenantId,
        roles: ['admin', 'owner'],
      });

      const res = await server.inject({
        method: 'GET',
        url: '/api/v1/outcomes/cost-per-outcome?window=24h',
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.tenantId).toBe(tenantId);
      expect(data.byWorkflow).toBeDefined();
      expect(data.cascadeMix).toBeDefined();
    });

    it('ingests cascade events via POST /api/v1/outcomes/cascade-event', async () => {
      const token = JwtService.signToken({
        userId: 'admin-user-1',
        email: 'admin@apollo.com',
        tenantId,
        roles: ['admin', 'owner'],
      });

      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/outcomes/cascade-event',
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: {
          agentId: 'intake_agent',
          cascadeLevel: 'L0_rule',
          ruleName: 'intake_l0_emergency',
          resolved: true,
          latencyMs: 3,
        },
      });

      expect(res.statusCode).toBe(201);
      const event = JSON.parse(res.body);
      expect(event.agent_id).toBe('intake_agent');
      expect(event.cascade_level).toBe('L0_rule');
    });

    it('generates the Cost per Outcome Report tailored for WP-7.5 console screen', async () => {
      await TenantContextManager.withTenant(tenantId, 'default', async () => {
        const report = await service.getCostPerOutcomeReport({ window: '24h' });

        expect(report.tenantId).toBe(tenantId);
        expect(report.window).toBe('24h');
        expect(report.byWorkflow).toBeDefined();
        expect(report.byAgent).toBeDefined();
        expect(report.byModel).toBeDefined();
        expect(report.cascadeMix).toBeDefined();
      });
    });
  });
});
