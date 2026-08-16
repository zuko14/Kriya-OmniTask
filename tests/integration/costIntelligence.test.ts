import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/api/server.js';
import { db } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { JwtService } from '../../src/security/auth/jwt.js';

describe('Cost Intelligence REST Integration Tests', () => {
  let app: FastifyInstance;
  const tenantId = 'tenant_cost_intel_test';
  let adminToken: string;

  beforeAll(async () => {
    app = await buildServer();
    await app.ready();

    const client = db.getClient();
    const migrator = new SchemaMigrator(client);
    await migrator.applyMigrations();

    const now = new Date().toISOString();
    await client.execute(
      'INSERT OR IGNORE INTO tenants (id, name, slug, status, plan_tier, channel_plan, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?);',
      [tenantId, 'Cost Intel Test Corp', 'cost-intel-corp', 'active', 'enterprise', 'combined', now, now]
    );

    adminToken = JwtService.sign({
      userId: 'usr_cost_admin',
      tenantId,
      email: 'costadmin@xylarc.ai',
      roles: ['admin', 'finance_manager'],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('should manage budget policies, ingest cost records, calculate unit economics, and track spend breakdown', async () => {
    // 1. Configure Budget Policy
    const budgetRes = await app.inject({
      method: 'PUT',
      url: '/api/v1/cost/budget',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        monthlyBudgetUsd: 500.0,
        dailyBudgetUsd: 50.0,
        warningThresholdPct: 80.0,
        hardCapAction: 'circuit_break_reject',
      },
    });

    expect(budgetRes.statusCode).toBe(200);
    expect(budgetRes.json().monthlyBudgetUsd).toBe(500.0);

    // 2. Ingest Cost Records
    const cost1 = await app.inject({
      method: 'POST',
      url: '/api/v1/cost/records',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        agentId: 'agent_sdr_99',
        taskId: 'task_lead_enrich_99',
        costCategory: 'api_tool',
        provider: 'clearbit',
        resourceMetricName: 'api_calls',
        resourceQuantity: 1,
        unitCostUsd: 0.05,
      },
    });
    expect(cost1.statusCode).toBe(201);
    expect(cost1.json().totalCostUsd).toBe(0.05);

    const cost2 = await app.inject({
      method: 'POST',
      url: '/api/v1/cost/records',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        agentId: 'agent_sdr_99',
        taskId: 'task_lead_call_99',
        costCategory: 'voice_telephony',
        provider: 'elevenlabs',
        resourceMetricName: 'voice_minutes',
        resourceQuantity: 3.0,
        unitCostUsd: 0.15,
      },
    });
    expect(cost2.statusCode).toBe(201);
    expect(cost2.json().totalCostUsd).toBe(0.45);

    // 3. Record Business Outcome linking both tasks
    const outcomeRes = await app.inject({
      method: 'POST',
      url: '/api/v1/cost/outcomes',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        agentId: 'agent_sdr_99',
        outcomeType: 'lead_qualified',
        outcomeStatus: 'achieved',
        valueGeneratedUsd: 100.0,
        taskIds: ['task_lead_enrich_99', 'task_lead_call_99'],
        metadata: { clientSector: 'SaaS Enterprise' },
      },
    });
    expect(outcomeRes.statusCode).toBe(201);
    const outcomeBody = outcomeRes.json();
    expect(outcomeBody.totalCostUsd).toBe(0.50); // 0.05 + 0.45
    expect(outcomeBody.valueGeneratedUsd).toBe(100.0);
    expect(outcomeBody.roiMultiplier).toBe(199.0);

    // 4. Query Unit Economics
    const economicsRes = await app.inject({
      method: 'GET',
      url: '/api/v1/cost/outcomes/unit-economics',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(economicsRes.statusCode).toBe(200);
    const economics = economicsRes.json().economics;
    expect(economics.lead_qualified).toBeDefined();
    expect(economics.lead_qualified.totalCount).toBeGreaterThanOrEqual(1);
    expect(economics.lead_qualified.avgCostPerOutcomeUsd).toBe(0.5);

    // 5. Query Spend Breakdown
    const summaryRes = await app.inject({
      method: 'GET',
      url: '/api/v1/cost/summary',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(summaryRes.statusCode).toBe(200);
    const summary = summaryRes.json();
    expect(summary.totalSpendUsd).toBe(0.5);
    expect(summary.byCategory.api_tool).toBe(0.05);
    expect(summary.byCategory.voice_telephony).toBe(0.45);

    // 6. Reset Circuit Breaker
    const resetRes = await app.inject({
      method: 'POST',
      url: '/api/v1/cost/budget/reset-circuit',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(resetRes.statusCode).toBe(200);
  });
});
