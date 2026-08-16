import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/api/server.js';
import { db } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { JwtService } from '../../src/security/auth/jwt.js';

describe('Adversarial Cost Intelligence Multi-Tenant Isolation Security Tests', () => {
  let app: FastifyInstance;
  const tenantA = 'tenant_cost_alpha';
  const tenantB = 'tenant_cost_beta';
  let tokenA: string;
  let tokenB: string;
  let unauthorizedToken: string;

  beforeAll(async () => {
    app = await buildServer();
    await app.ready();

    const client = db.getClient();
    const migrator = new SchemaMigrator(client);
    await migrator.applyMigrations();

    const now = new Date().toISOString();
    await client.execute(
      'INSERT OR IGNORE INTO tenants (id, name, slug, status, plan_tier, channel_plan, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?);',
      [tenantA, 'Tenant Alpha Cost Corp', 'cost-alpha', 'active', 'enterprise', 'combined', now, now]
    );
    await client.execute(
      'INSERT OR IGNORE INTO tenants (id, name, slug, status, plan_tier, channel_plan, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?);',
      [tenantB, 'Tenant Beta Cost Corp', 'cost-beta', 'active', 'standard', 'combined', now, now]
    );

    tokenA = JwtService.sign({
      userId: 'usr_admin_cost_a',
      tenantId: tenantA,
      email: 'admina@xylarc.ai',
      roles: ['admin', 'finance_manager'],
    });

    tokenB = JwtService.sign({
      userId: 'usr_admin_cost_b',
      tenantId: tenantB,
      email: 'adminb@xylarc.ai',
      roles: ['admin', 'finance_manager'],
    });

    unauthorizedToken = JwtService.sign({
      userId: 'usr_readonly_cost',
      tenantId: tenantA,
      email: 'readonly@xylarc.ai',
      roles: ['read_only'],
    });

    // Tenant A sets policy, records cost and outcome
    await app.inject({
      method: 'PUT',
      url: '/api/v1/cost/budget',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        monthlyBudgetUsd: 1000.0,
        dailyBudgetUsd: 100.0,
        warningThresholdPct: 75.0,
        hardCapAction: 'circuit_break_reject',
      },
    });

    await app.inject({
      method: 'POST',
      url: '/api/v1/cost/records',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        agentId: 'agent_alpha_1',
        taskId: 'task_secret_invoice_a',
        costCategory: 'api_tool',
        provider: 'stripe',
        resourceMetricName: 'api_calls',
        resourceQuantity: 5,
        unitCostUsd: 0.02,
      },
    });

    await app.inject({
      method: 'POST',
      url: '/api/v1/cost/outcomes',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        agentId: 'agent_alpha_1',
        outcomeType: 'invoice_processed',
        outcomeStatus: 'achieved',
        valueGeneratedUsd: 250.0,
        taskIds: ['task_secret_invoice_a'],
        metadata: { secretVendor: 'Classified Vendor Alpha' },
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('should prevent Tenant B from reading Tenant A cost records, outcomes, and budget policies', async () => {
    // 1. Tenant B lists cost records -> must NOT see Tenant A's task_secret_invoice_a
    const recordsResB = await app.inject({
      method: 'GET',
      url: '/api/v1/cost/records',
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(recordsResB.statusCode).toBe(200);
    const recordsB = recordsResB.json().records;
    expect(recordsB.some((r: any) => r.taskId === 'task_secret_invoice_a')).toBe(false);

    // 2. Tenant B lists outcomes -> must NOT see Tenant A's invoice_processed outcome
    const outcomesResB = await app.inject({
      method: 'GET',
      url: '/api/v1/cost/outcomes',
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(outcomesResB.statusCode).toBe(200);
    const outcomesB = outcomesResB.json().outcomes;
    expect(outcomesB.some((o: any) => o.outcomeMetadata?.secretVendor === 'Classified Vendor Alpha')).toBe(false);

    // 3. Tenant B fetches budget -> gets its own or empty policy (not 1000.0)
    const budgetResB = await app.inject({
      method: 'GET',
      url: '/api/v1/cost/budget',
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(budgetResB.statusCode).toBe(200);
    expect(budgetResB.json().monthlyBudgetUsd).toBeUndefined();

    // 4. Unauthorized read-only user tries to update budget -> 403 Forbidden
    const unauthBudget = await app.inject({
      method: 'PUT',
      url: '/api/v1/cost/budget',
      headers: { authorization: `Bearer ${unauthorizedToken}` },
      payload: {
        monthlyBudgetUsd: 99999.0,
        dailyBudgetUsd: 9999.0,
        warningThresholdPct: 90.0,
        hardCapAction: 'notify_only',
      },
    });
    expect(unauthBudget.statusCode).toBe(403);

    // 5. Unauthorized read-only user tries to reset circuit breaker -> 403 Forbidden
    const unauthReset = await app.inject({
      method: 'POST',
      url: '/api/v1/cost/budget/reset-circuit',
      headers: { authorization: `Bearer ${unauthorizedToken}` },
    });
    expect(unauthReset.statusCode).toBe(403);
  });
});
