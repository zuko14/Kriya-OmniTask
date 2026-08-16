/**
 * Xylarc AI — Adversarial Policy Isolation Security Tests
 * Verifies cross-tenant policy rule isolation and evaluation audit boundary security (§14, §16 of CLAUDE.md).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/api/server.js';
import { db, DatabaseClient } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { JwtService } from '../../src/security/auth/jwt.js';
import { TenantContextManager } from '../../src/core/context/tenantContext.js';
import { PolicyRuleRepository } from '../../src/policy/repositories/policyRepository.js';

describe('Adversarial Policy Isolation Security Tests', () => {
  let app: FastifyInstance;
  let client: DatabaseClient;

  const tenantA = 'tenant_policy_sec_a';
  const tenantB = 'tenant_policy_sec_b';
  let tokenA: string;
  let tokenB: string;

  beforeEach(async () => {
    client = db.getClient();
    const migrator = new SchemaMigrator(client);
    await migrator.applyMigrations();

    app = await buildServer();
    await app.ready();

    // Seed Tenant A & Tenant B
    await client.execute(
      `INSERT OR IGNORE INTO tenants (id, name, slug, plan_tier, channel_plan, status, created_at, updated_at) VALUES
       (?, 'Tenant A', 'tenant-a-policy-sec', 'standard', 'combined', 'active', datetime('now'), datetime('now')),
       (?, 'Tenant B', 'tenant-b-policy-sec', 'standard', 'combined', 'active', datetime('now'), datetime('now'));`,
      [tenantA, tenantB]
    );

    tokenA = JwtService.sign({
      userId: 'user-a',
      tenantId: tenantA,
      organizationId: 'org-a',
      roles: ['admin', 'owner'],
      email: 'user-a@policy-sec.com',
    });

    tokenB = JwtService.sign({
      userId: 'user-b',
      tenantId: tenantB,
      organizationId: 'org-b',
      roles: ['admin', 'owner'],
      email: 'user-b@policy-sec.com',
    });

    // Tenant A creates a proprietary custom rule
    await TenantContextManager.withTenant(tenantA, 'org-a', async () => {
      const ruleRepo = new PolicyRuleRepository(client);
      await ruleRepo.saveRule({
        tenantId: tenantA,
        slug: 'confidential_commission_cap',
        name: 'Confidential Commission Cap',
        description: 'Proprietary internal sales commission rule.',
        category: 'financial',
        severity: 'BLOCK',
        action: 'BLOCK_ACTION',
        condition: { field: 'commissionRate', operator: 'GREATER_THAN', value: 15 },
      });
    });
  });

  afterEach(async () => {
    await app.close();
    await client.execute('DELETE FROM policy_evaluations WHERE tenant_id IN (?, ?);', [tenantA, tenantB]);
    await client.execute('DELETE FROM policy_rules WHERE tenant_id IN (?, ?);', [tenantA, tenantB]);
    await client.execute('DELETE FROM tenants WHERE id IN (?, ?);', [tenantA, tenantB]);
  });

  it('should prevent Tenant B from seeing Tenant A custom policy rules', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/policies/rules',
      headers: { authorization: `Bearer ${tokenB}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.rules.some((r: any) => r.slug === 'confidential_commission_cap')).toBe(false);
  });

  it('should prevent Tenant B from deleting Tenant A custom policy rule', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/v1/policies/rules/confidential_commission_cap',
      headers: { authorization: `Bearer ${tokenB}` },
    });

    expect(res.statusCode).toBe(200);

    // Verify rule is still present in Tenant A
    await TenantContextManager.withTenant(tenantA, 'org-a', async () => {
      const ruleRepo = new PolicyRuleRepository(client);
      const rule = await ruleRepo.findBySlug('confidential_commission_cap', tenantA);
      expect(rule).not.toBeNull();
    });
  });

  it('should prevent Tenant B from viewing Tenant A policy evaluation logs', async () => {
    // Generate evaluation log under Tenant A
    await app.inject({
      method: 'POST',
      url: '/api/v1/policies/evaluate',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        actionType: 'financial_transaction',
        context: { commissionRate: 20 },
      },
    });

    // Query logs as Tenant B
    const resB = await app.inject({
      method: 'GET',
      url: '/api/v1/policies/evaluations',
      headers: { authorization: `Bearer ${tokenB}` },
    });

    expect(resB.statusCode).toBe(200);
    const bodyB = JSON.parse(resB.body);
    expect(bodyB.evaluations.length).toBe(0);
  });
});
