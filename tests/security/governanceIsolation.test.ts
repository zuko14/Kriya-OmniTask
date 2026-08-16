import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/api/server.js';
import { db } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { JwtService } from '../../src/security/auth/jwt.js';

describe('Adversarial Enterprise Governance Multi-Tenant Isolation Security Tests', () => {
  let app: FastifyInstance;
  const tenantA = 'tenant_gov_alpha';
  const tenantB = 'tenant_gov_beta';
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
      [tenantA, 'Tenant Alpha Gov Corp', 'gov-alpha', 'active', 'enterprise', 'combined', now, now]
    );
    await client.execute(
      'INSERT OR IGNORE INTO tenants (id, name, slug, status, plan_tier, channel_plan, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?);',
      [tenantB, 'Tenant Beta Gov Corp', 'gov-beta', 'active', 'standard', 'combined', now, now]
    );

    tokenA = JwtService.sign({
      userId: 'usr_admin_gov_a',
      tenantId: tenantA,
      email: 'admina@xylarc.ai',
      roles: ['admin', 'compliance_officer'],
    });

    tokenB = JwtService.sign({
      userId: 'usr_admin_gov_b',
      tenantId: tenantB,
      email: 'adminb@xylarc.ai',
      roles: ['admin', 'compliance_officer'],
    });

    unauthorizedToken = JwtService.sign({
      userId: 'usr_readonly_gov',
      tenantId: tenantA,
      email: 'readonly@xylarc.ai',
      roles: ['read_only'],
    });

    // Tenant A creates org unit, SSO config, and retention policy
    await app.inject({
      method: 'POST',
      url: '/api/v1/governance/org-units',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        name: 'Top Secret R&D Lab',
        code: 'DIV_SECRET_RD',
        unitType: 'division',
        metadata: { budgetCode: 'RD-SECRET-999' },
      },
    });

    await app.inject({
      method: 'POST',
      url: '/api/v1/governance/sso/config',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        providerType: 'azure_ad',
        issuerUrl: 'https://login.microsoftonline.com/tenant-a/v2.0',
        clientId: 'azure_client_a',
        clientSecret: 'secret_a_credential',
        claimsMapping: { 'Secret-Group': 'admin' },
        enforceSso: true,
        isActive: true,
      },
    });

    await app.inject({
      method: 'POST',
      url: '/api/v1/governance/retention/policies',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        dataClassification: 'restricted',
        targetResourceType: 'transcripts',
        retentionDays: 14,
        purgeAction: 'hard_delete',
        isActive: true,
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('should prevent Tenant B from reading Tenant A org hierarchy, SSO configs, and retention policies', async () => {
    // 1. Tenant B lists org units -> must NOT see DIV_SECRET_RD
    const unitsResB = await app.inject({
      method: 'GET',
      url: '/api/v1/governance/org-units',
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(unitsResB.statusCode).toBe(200);
    const unitsB = unitsResB.json().units;
    expect(unitsB.some((u: any) => u.code === 'DIV_SECRET_RD')).toBe(false);

    // 2. Tenant B fetches SSO config for azure_ad -> must NOT find Tenant A's config
    const ssoResB = await app.inject({
      method: 'GET',
      url: '/api/v1/governance/sso/config?provider=azure_ad',
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(ssoResB.statusCode).toBe(200);
    expect(ssoResB.json().clientId).toBeUndefined();

    // 3. Tenant B lists retention policies -> must NOT see Tenant A's restricted 14-day policy
    const policiesResB = await app.inject({
      method: 'GET',
      url: '/api/v1/governance/retention/policies',
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(policiesResB.statusCode).toBe(200);
    const policiesB = policiesResB.json().policies;
    expect(policiesB.some((p: any) => p.dataClassification === 'restricted' && p.retentionDays === 14)).toBe(false);

    // 4. Unauthorized read_only user tries to create org unit -> 403 Forbidden
    const unauthOrg = await app.inject({
      method: 'POST',
      url: '/api/v1/governance/org-units',
      headers: { authorization: `Bearer ${unauthorizedToken}` },
      payload: {
        name: 'Hacked Department',
        code: 'DEPT_HACK',
        unitType: 'department',
      },
    });
    expect(unauthOrg.statusCode).toBe(403);

    // 5. Unauthorized read_only user tries to upsert SSO config -> 403 Forbidden
    const unauthSso = await app.inject({
      method: 'POST',
      url: '/api/v1/governance/sso/config',
      headers: { authorization: `Bearer ${unauthorizedToken}` },
      payload: {
        providerType: 'okta',
        issuerUrl: 'https://hacked.okta.com',
        clientId: 'hacked_client',
        clientSecret: 'hacked_secret',
      },
    });
    expect(unauthSso.statusCode).toBe(403);

    // 6. Unauthorized read_only user tries to upsert retention policy -> 403 Forbidden
    const unauthRetention = await app.inject({
      method: 'POST',
      url: '/api/v1/governance/retention/policies',
      headers: { authorization: `Bearer ${unauthorizedToken}` },
      payload: {
        dataClassification: 'public',
        targetResourceType: 'audit_logs',
        retentionDays: 1,
      },
    });
    expect(unauthRetention.statusCode).toBe(403);
  });
});
