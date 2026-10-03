/**
 * Kriya AI — Policy Engine REST Gateway Integration Tests
 * Verifies Fastify REST endpoints for policy evaluations, tenant-scoped rule management, and audit inspection.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/api/server.js';
import { db, DatabaseClient } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { JwtService } from '../../src/security/auth/jwt.js';
import { PolicyEngine } from '../../src/policy/engine/policyEngine.js';

describe('Policy Engine REST Gateway Integration Tests', () => {
  let app: FastifyInstance;
  let client: DatabaseClient;

  const tenantId = 'tenant_policy_int_test';
  const orgId = 'org_policy_int_test';
  let adminToken: string;

  beforeEach(async () => {
    client = db.getClient();
    const migrator = new SchemaMigrator(client);
    await migrator.applyMigrations();

    const engine = new PolicyEngine();
    await engine.bootstrapDefaultSystemPolicies();

    app = await buildServer();
    await app.ready();

    // Seed tenant & org
    await client.execute(
      `INSERT OR IGNORE INTO tenants (id, name, slug, plan_tier, channel_plan, status, created_at, updated_at)
       VALUES (?, 'Policy Tenant', 'policy-int-tenant', 'standard', 'combined', 'active', datetime('now'), datetime('now'));`,
      [tenantId]
    );

    await client.execute(
      `INSERT OR IGNORE INTO organizations (id, tenant_id, name, slug, created_at, updated_at)
       VALUES (?, ?, 'Policy Org', 'policy-int-org', datetime('now'), datetime('now'));`,
      [orgId, tenantId]
    );

    adminToken = JwtService.sign({
      userId: 'policy-admin-user',
      tenantId,
      organizationId: orgId,
      roles: ['admin', 'owner'],
      email: 'admin@policy-test.com',
    });
  });

  afterEach(async () => {
    await app.close();
    await client.execute('DELETE FROM policy_evaluations WHERE tenant_id = ?;', [tenantId]);
    await client.execute('DELETE FROM policy_rules WHERE tenant_id = ?;', [tenantId]);
    await client.execute('DELETE FROM organizations WHERE tenant_id = ?;', [tenantId]);
    await client.execute('DELETE FROM tenants WHERE id = ?;', [tenantId]);
  });

  it('should evaluate context via POST /api/v1/policies/evaluate', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/policies/evaluate',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        actionType: 'financial_transaction',
        context: {
          discountPercent: 12,
          isQuietHours: false,
          hasActiveConsent: true,
        },
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.allowed).toBe(true);
    expect(body.verdict).toBe('PASS');
  });

  it('should create and enforce a custom tenant policy rule', async () => {
    // 1. Create custom policy rule: No deals over $5,000 without contract
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/policies/rules',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        slug: 'high_value_deal_contract_required',
        name: 'High-Value Deal Contract Policy',
        description: 'Requires signed contract for deals >= $5000',
        category: 'compliance',
        severity: 'BLOCK',
        action: 'BLOCK_ACTION',
        condition: {
          logical: 'AND',
          conditions: [
            { field: 'dealValueUsd', operator: 'GREATER_THAN_OR_EQUAL', value: 5000 },
            { field: 'hasSignedContract', operator: 'EQUALS', value: false },
          ],
        },
        isEnabled: true,
      },
    });

    expect(createRes.statusCode).toBe(201);
    const createdRule = JSON.parse(createRes.body);
    expect(createdRule.slug).toBe('high_value_deal_contract_required');

    // 2. Evaluate context violating this new custom rule
    const evalRes = await app.inject({
      method: 'POST',
      url: '/api/v1/policies/evaluate',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        actionType: 'financial_transaction',
        context: {
          dealValueUsd: 12000,
          hasSignedContract: false,
        },
      },
    });

    expect(evalRes.statusCode).toBe(200);
    const evalBody = JSON.parse(evalRes.body);
    expect(evalBody.allowed).toBe(false);
    expect(evalBody.verdict).toBe('BLOCKED');
    expect(evalBody.violations.some((v: any) => v.ruleSlug === 'high_value_deal_contract_required')).toBe(true);
  });

  it('should query policy evaluation audit logs via GET /api/v1/policies/evaluations', async () => {
    // Generate an evaluation
    await app.inject({
      method: 'POST',
      url: '/api/v1/policies/evaluate',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        actionType: 'outbound_message',
        context: { isQuietHours: true },
      },
    });

    // Query audit log
    const auditRes = await app.inject({
      method: 'GET',
      url: '/api/v1/policies/evaluations',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(auditRes.statusCode).toBe(200);
    const auditBody = JSON.parse(auditRes.body);
    expect(auditBody.total).toBeGreaterThanOrEqual(1);
    expect(auditBody.evaluations[0].evaluation_result).toBe('BLOCKED');
  });
});
