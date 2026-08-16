import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/api/server.js';
import { db } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { JwtService } from '../../src/security/auth/jwt.js';

describe('Enterprise Governance REST Integration Tests', () => {
  let app: FastifyInstance;
  const tenantId = 'tenant_gov_test';
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
      [tenantId, 'Enterprise Governance Test Corp', 'gov-test-corp', 'active', 'enterprise', 'combined', now, now]
    );

    adminToken = JwtService.sign({
      userId: 'usr_gov_admin',
      tenantId,
      email: 'govadmin@xylarc.ai',
      roles: ['admin', 'compliance_officer'],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('should manage org hierarchy, SSO config, ABAC evaluations, and retention purge auditing', async () => {
    // 1. Create Division Org Unit
    const divRes = await app.inject({
      method: 'POST',
      url: '/api/v1/governance/org-units',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        name: 'Finance & Legal Division',
        code: 'DIV_FIN_LEGAL',
        unitType: 'division',
        metadata: { region: 'Global' },
      },
    });

    expect(divRes.statusCode).toBe(201);
    const divId = divRes.json().id;

    // 2. Create Child Department
    const deptRes = await app.inject({
      method: 'POST',
      url: '/api/v1/governance/org-units',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        name: 'Corporate Accounting',
        code: 'DEPT_ACCOUNTING',
        unitType: 'department',
        parentUnitId: divId,
        metadata: { costCenter: 'CC-901' },
      },
    });

    expect(deptRes.statusCode).toBe(201);
    const deptId = deptRes.json().id;

    // 3. Get Hierarchy Tree
    const treeRes = await app.inject({
      method: 'GET',
      url: '/api/v1/governance/org-units/tree',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(treeRes.statusCode).toBe(200);
    const tree = treeRes.json().tree;
    expect(tree.some((t: any) => t.id === divId && t.children?.length >= 1)).toBe(true);

    // 4. Upsert SSO Configuration
    const ssoRes = await app.inject({
      method: 'POST',
      url: '/api/v1/governance/sso/config',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        providerType: 'okta',
        issuerUrl: 'https://xylarc.okta.com/oauth2/v1',
        clientId: 'okta_client_enterprise',
        clientSecret: 'super_secret_okta_key',
        claimsMapping: {
          'Okta-Admins': 'admin',
          'Okta-Finance': 'finance_manager',
        },
        enforceSso: true,
        isActive: true,
      },
    });

    expect(ssoRes.statusCode).toBe(200);
    expect(ssoRes.json().providerType).toBe('okta');

    // 5. Exchange SSO Token
    const exchangeRes = await app.inject({
      method: 'POST',
      url: `/api/v1/governance/sso/exchange?tenantId=${tenantId}`,
      payload: {
        providerType: 'okta',
        idTokenOrAssertion: 'mock_jwt_token',
        mockClaims: {
          email: 'controller@xylarc.ai',
          sub: 'okta_controller_99',
          groups: ['Okta-Finance'],
          name: 'Corporate Controller',
        },
      },
    });

    expect(exchangeRes.statusCode).toBe(200);
    const ssoAuth = exchangeRes.json();
    expect(ssoAuth.token).toBeDefined();
    expect(ssoAuth.user.roles).toContain('finance_manager');

    // 6. Dynamic ABAC Evaluation
    const abacRes = await app.inject({
      method: 'POST',
      url: '/api/v1/governance/abac/evaluate',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        subject: {
          userId: ssoAuth.user.userId,
          roles: ssoAuth.user.roles,
          unitId: deptId,
          clearanceLevel: 'confidential',
        },
        resource: {
          resourceType: 'gl_journal',
          resourceId: 'rec_journal_123',
          unitId: deptId,
          classification: 'confidential',
        },
        action: 'read',
      },
    });

    expect(abacRes.statusCode).toBe(200);
    expect(abacRes.json().decision).toBe('allow');

    // 7. Upsert Retention Policy
    const retentionRes = await app.inject({
      method: 'POST',
      url: '/api/v1/governance/retention/policies',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        dataClassification: 'confidential',
        targetResourceType: 'audit_logs',
        retentionDays: 180,
        purgeAction: 'archive_cold_storage',
        isActive: true,
      },
    });

    expect(retentionRes.statusCode).toBe(200);
    expect(retentionRes.json().retentionDays).toBe(180);

    // 8. Execute Purge Simulation
    const purgePlanRes = await app.inject({
      method: 'POST',
      url: '/api/v1/governance/retention/purge-plan',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(purgePlanRes.statusCode).toBe(200);
    expect(purgePlanRes.json().count).toBeGreaterThanOrEqual(1);

    // 9. List Purge Audits
    const auditsRes = await app.inject({
      method: 'GET',
      url: '/api/v1/governance/retention/audits',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(auditsRes.statusCode).toBe(200);
    expect(auditsRes.json().count).toBeGreaterThanOrEqual(1);
  });
});
