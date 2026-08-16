import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/api/server.js';
import { db } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { JwtService } from '../../src/security/auth/jwt.js';

describe('Adversarial Multi-Tenant Infrastructure Security Tests', () => {
  let app: FastifyInstance;
  const tenantAlpha = 'tenant_infra_sec_alpha';
  const tenantBeta = 'tenant_infra_sec_beta';

  let tokenAlpha: string;
  let tokenBeta: string;
  let tokenReadOnly: string;

  beforeAll(async () => {
    app = await buildServer();
    await app.ready();

    const client = db.getClient();
    const migrator = new SchemaMigrator(client);
    await migrator.applyMigrations();

    const now = new Date().toISOString();
    await client.execute(
      'INSERT OR IGNORE INTO tenants (id, name, slug, status, plan_tier, channel_plan, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?);',
      [tenantAlpha, 'Alpha Org', 'alpha-org', 'active', 'enterprise', 'combined', now, now]
    );
    await client.execute(
      'INSERT OR IGNORE INTO tenants (id, name, slug, status, plan_tier, channel_plan, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?);',
      [tenantBeta, 'Beta Org', 'beta-org', 'active', 'starter', 'digital_only', now, now]
    );

    tokenAlpha = JwtService.sign({
      userId: 'usr_alpha_lead',
      tenantId: tenantAlpha,
      email: 'lead@alpha.com',
      roles: ['owner'],
    });

    tokenBeta = JwtService.sign({
      userId: 'usr_beta_lead',
      tenantId: tenantBeta,
      email: 'lead@beta.com',
      roles: ['owner'],
    });

    tokenReadOnly = JwtService.sign({
      userId: 'usr_alpha_analyst',
      tenantId: tenantAlpha,
      email: 'analyst@alpha.com',
      roles: ['analyst'],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('should enforce strict multi-tenant job isolation and block unauthorized operator controls', async () => {
    // 1. Alpha enqueues a confidential background job
    const alphaJobRes = await app.inject({
      method: 'POST',
      url: '/api/v1/infra/jobs/enqueue',
      headers: { authorization: `Bearer ${tokenAlpha}` },
      payload: {
        jobType: 'confidential_payroll_export',
        payload: { accountId: 'acc_secret_999' },
      },
    });
    expect(alphaJobRes.statusCode).toBe(201);
    const alphaJobId = alphaJobRes.json().id;

    // 2. Beta tries to access Alpha's job by ID -> Must be 404 (isolated)
    const crossTenantGet = await app.inject({
      method: 'GET',
      url: `/api/v1/infra/jobs/${alphaJobId}`,
      headers: { authorization: `Bearer ${tokenBeta}` },
    });
    expect(crossTenantGet.statusCode).toBe(404);

    // 3. Beta lists jobs -> Must NOT contain Alpha's job
    const betaList = await app.inject({
      method: 'GET',
      url: '/api/v1/infra/jobs',
      headers: { authorization: `Bearer ${tokenBeta}` },
    });
    expect(betaList.statusCode).toBe(200);
    expect(betaList.json().jobs.some((j: any) => j.id === alphaJobId)).toBe(false);

    // 4. Non-operator tries to access connection pool stats -> 403 Forbidden
    const unauthPool = await app.inject({
      method: 'GET',
      url: '/api/v1/infra/pool/stats',
      headers: { authorization: `Bearer ${tokenReadOnly}` },
    });
    expect(unauthPool.statusCode).toBe(403);

    // 5. Non-operator tries to trigger secret audit -> 403 Forbidden
    const unauthSecret = await app.inject({
      method: 'POST',
      url: '/api/v1/infra/secrets/audit',
      headers: { authorization: `Bearer ${tokenReadOnly}` },
    });
    expect(unauthSecret.statusCode).toBe(403);

    // 6. Non-operator tries to register scheduled job -> 403 Forbidden
    const unauthSched = await app.inject({
      method: 'POST',
      url: '/api/v1/infra/schedules',
      headers: { authorization: `Bearer ${tokenReadOnly}` },
      payload: {
        name: 'Unauthorized Job',
        cronExpression: '* * * * *',
        jobType: 'rogue_job',
      },
    });
    expect(unauthSched.statusCode).toBe(403);
  });
});
