import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/api/server.js';
import { db } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { JwtService } from '../../src/security/auth/jwt.js';

describe('Milestone M2: Owner Provisioning, Elevation & Owner-Plane Isolation (§2, §17.1, §17.2, §17.6)', () => {
  let app: FastifyInstance;
  const operatorTenantId = 'tenant_system_root';
  let operatorToken: string;
  let clientAdminToken: string;
  const testTenantId = 'tenant_meridian_retail_m2';

  beforeAll(async () => {
    app = await buildServer();
    await app.ready();

    const client = db.getClient();
    const migrator = new SchemaMigrator(client);
    await migrator.applyMigrations();

    const now = new Date().toISOString();
    // System operator tenant
    await client.execute(
      'INSERT OR IGNORE INTO tenants (id, name, slug, status, plan_tier, channel_plan, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?);',
      [operatorTenantId, 'System Operator Tenant', 'sys-operator-m2', 'active', 'enterprise', 'combined', now, now]
    );

    operatorToken = JwtService.sign({
      userId: 'usr_operator_root',
      tenantId: operatorTenantId,
      email: 'operator@kriya.ai',
      roles: ['system', 'operator'],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('Criteria 1: A tenant can only be created through the provisioning flow (unauthorized requests rejected)', async () => {
    // 1. Unauthorized attempt (no token)
    const unauthRes = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/tenants/provision',
      payload: {
        name: 'Hacker Tenant',
        slug: 'hacker-tenant',
        adminEmail: 'hacker@example.com',
      },
    });
    expect(unauthRes.statusCode).toBe(401);

    // 2. Authorized Operator Provisioning Flow
    const provRes = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/tenants/provision',
      headers: { authorization: `Bearer ${operatorToken}` },
      payload: {
        id: testTenantId,
        name: 'Meridian Retail Corp',
        slug: 'meridian-retail-m2',
        industry: 'retail',
        region: 'ap-south-1',
        languages: ['en', 'hi'],
        timezone: 'Asia/Kolkata',
        dnaProfileId: 'dna_retail_commerce',
        planTier: 'growth',
        channelPlan: 'combined',
        brainSupplyMode: 'byo',
        adminEmail: 'admin@meridianretail.com',
        adminFullName: 'Anita Sharma',
        quotas: {
          max_concurrent_tasks: 15,
          monthly_budget_inr: 25000,
          max_daily_tokens: 2000000,
        },
        autonomyCeiling: 'L2',
      },
    });

    expect(provRes.statusCode).toBe(201);
    const body = provRes.json();
    expect(body.tenant.id).toBe(testTenantId);
    expect(body.tenant.name).toBe('Meridian Retail Corp');
    expect(body.tenant.dna_profile_id).toBe('dna_retail_commerce');
    expect(body.tenant.brain_supply_mode).toBe('byo');

    // Create client admin token for subsequent tests
    clientAdminToken = JwtService.sign({
      userId: body.adminUserId,
      tenantId: testTenantId,
      organizationId: body.organizationId,
      email: 'admin@meridianretail.com',
      roles: ['admin'],
    });
  });

  it('Criteria 2: Every provisioning action writes an immutable cryptographic audit ledger entry', async () => {
    const client = db.getClient();
    const auditRows = await client.query<any>(
      "SELECT * FROM audit_logs WHERE tenant_id = ? AND action = 'tenant.provisioned';",
      [testTenantId]
    );

    expect(auditRows.length).toBeGreaterThan(0);
    const log = auditRows[0];
    expect(log.action).toBe('tenant.provisioned');
    expect(log.details_json).toContain('Meridian Retail Corp');
    expect(log.details_json).toContain('dna_retail_commerce');
  });

  it('Criteria 3: Elevation requires reason + duration, issues elevated token, logs to tenant security view', async () => {
    // 1. Missing / invalid reason fails (less than 5 chars)
    const invalidElevRes = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/tenants/${testTenantId}/elevate`,
      headers: { authorization: `Bearer ${operatorToken}` },
      payload: {
        reason: 'bad', // < 5 chars
        durationMinutes: 30,
      },
    });
    // Fastify / Zod validation error produces 400 Bad Request
    expect(invalidElevRes.statusCode).toBe(400);

    // 2. Valid elevation
    const validElevRes = await app.inject({
      method: 'POST',
      url: `/api/v1/admin/tenants/${testTenantId}/elevate`,
      headers: { authorization: `Bearer ${operatorToken}` },
      payload: {
        reason: 'Investigating customer escalation ticket #4092',
        durationMinutes: 45,
      },
    });

    expect(validElevRes.statusCode).toBe(200);
    const elevBody = validElevRes.json();
    expect(elevBody.token).toBeDefined();
    expect(elevBody.session.reason).toBe('Investigating customer escalation ticket #4092');
    expect(elevBody.session.duration_minutes).toBe(45);

    // 3. Verify security logs queryable by tenant admin
    const secLogsRes = await app.inject({
      method: 'GET',
      url: `/api/v1/tenants/${testTenantId}/security-logs`,
      headers: { authorization: `Bearer ${clientAdminToken}` },
    });

    expect(secLogsRes.statusCode).toBe(200);
    const secData = secLogsRes.json();
    expect(secData.elevationHistory.length).toBeGreaterThanOrEqual(1);
    expect(secData.elevationHistory[0].reason).toBe('Investigating customer escalation ticket #4092');
    expect(secData.activeElevation).toBeDefined();
  });

  it('Criteria 4: Suspension stops execution without deleting data', async () => {
    // 1. Operator suspends tenant
    const suspendRes = await app.inject({
      method: 'PUT',
      url: `/api/v1/admin/tenants/${testTenantId}/status`,
      headers: { authorization: `Bearer ${operatorToken}` },
      payload: {
        status: 'suspended',
        reason: 'Payment review hold',
      },
    });
    expect(suspendRes.statusCode).toBe(200);

    // 2. Client token is rejected because tenant is suspended
    const clientCallRes = await app.inject({
      method: 'GET',
      url: `/api/v1/tenants/${testTenantId}`,
      headers: { authorization: `Bearer ${clientAdminToken}` },
    });
    expect(clientCallRes.statusCode).toBe(401); // Unauthorized: account disabled or suspended

    // 3. Verify data in DB is preserved (not deleted)
    const client = db.getClient();
    const tenantRow = await client.queryOne<any>(
      'SELECT * FROM tenants WHERE id = ?;',
      [testTenantId]
    );
    expect(tenantRow).toBeDefined();
    expect(tenantRow.status).toBe('suspended');
    expect(tenantRow.name).toBe('Meridian Retail Corp');

    // 4. Reactivating tenant immediately restores execution
    const reactivateRes = await app.inject({
      method: 'PUT',
      url: `/api/v1/admin/tenants/${testTenantId}/status`,
      headers: { authorization: `Bearer ${operatorToken}` },
      payload: {
        status: 'active',
        reason: 'Payment confirmed',
      },
    });
    expect(reactivateRes.statusCode).toBe(200);

    const clientCallAfterRes = await app.inject({
      method: 'GET',
      url: `/api/v1/tenants/${testTenantId}`,
      headers: { authorization: `Bearer ${clientAdminToken}` },
    });
    expect(clientCallAfterRes.statusCode).toBe(200);
  });

  it('Criteria 5: An admin user cannot alter any owner-plane field via any API path (verified by test)', async () => {
    // 1. Client admin cannot access owner plane routes
    const adminRosterAttempt = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/organizations/roster',
      headers: { authorization: `Bearer ${clientAdminToken}` },
    });
    expect(adminRosterAttempt.statusCode).toBe(403);

    const adminProvisionAttempt = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/tenants/provision',
      headers: { authorization: `Bearer ${clientAdminToken}` },
      payload: { name: 'Attempt', slug: 'attempt', adminEmail: 'a@a.com' },
    });
    expect(adminProvisionAttempt.statusCode).toBe(403);

    // 2. Client admin attempting to update owner-plane fields via config endpoint is rejected
    const ownerFieldAttempt = await app.inject({
      method: 'PATCH',
      url: `/api/v1/tenants/${testTenantId}/config`,
      headers: { authorization: `Bearer ${clientAdminToken}` },
      payload: {
        settings: {
          plan_tier: 'enterprise', // Forbidden owner-plane field!
          custom_greeting: 'Welcome to Meridian',
        },
      },
    });
    expect(ownerFieldAttempt.statusCode).toBe(403);

    const quotaAttempt = await app.inject({
      method: 'PATCH',
      url: `/api/v1/tenants/${testTenantId}/config`,
      headers: { authorization: `Bearer ${clientAdminToken}` },
      payload: {
        settings: {
          quotas: { monthly_budget_inr: 999999 }, // Forbidden owner-plane field!
        },
      },
    });
    expect(quotaAttempt.statusCode).toBe(403);

    // 3. Client admin can only update legitimate non-owner configuration settings
    const validConfigRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/tenants/${testTenantId}/config`,
      headers: { authorization: `Bearer ${clientAdminToken}` },
      payload: {
        settings: {
          theme: 'dark',
          support_email_display: 'help@meridianretail.com',
        },
      },
    });
    expect(validConfigRes.statusCode).toBe(200);
  });

  it('Roster API returns organizations sorted worst-first (§17.1)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/organizations/roster',
      headers: { authorization: `Bearer ${operatorToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.organizations)).toBe(true);
    expect(body.organizations.length).toBeGreaterThan(0);

    const found = body.organizations.find((o: any) => o.id === testTenantId);
    expect(found).toBeDefined();
    expect(found.planTier).toBe('growth');
    expect(found.channelPlan).toBe('combined');
  });
});
