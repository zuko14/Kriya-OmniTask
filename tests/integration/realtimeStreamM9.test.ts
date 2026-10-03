import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/api/server.js';
import { db } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { JwtService } from '../../src/security/auth/jwt.js';

describe('Real-Time Data Layer Integration Tests (§19, M9)', () => {
  let app: FastifyInstance;
  const TENANT_ALPHA = 'tenant_rt_alpha';
  const TENANT_BETA = 'tenant_rt_beta';

  let alphaAdminToken: string;
  let betaAdminToken: string;

  beforeEach(async () => {
    const client = db.getClient();
    const migrator = new SchemaMigrator(client);
    await migrator.applyMigrations();

    const now = new Date().toISOString();
    await client.execute(
      `INSERT OR REPLACE INTO tenants (id, name, slug, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?);`,
      [TENANT_ALPHA, 'Tenant Alpha Corp', 'alpha-corp', now, now]
    );
    await client.execute(
      `INSERT OR REPLACE INTO tenants (id, name, slug, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?);`,
      [TENANT_BETA, 'Tenant Beta Ltd', 'beta-ltd', now, now]
    );

    alphaAdminToken = JwtService.sign({
      userId: 'user_alpha_1',
      tenantId: TENANT_ALPHA,
      email: 'admin@alpha.com',
      roles: ['admin'],
    });

    betaAdminToken = JwtService.sign({
      userId: 'user_beta_1',
      tenantId: TENANT_BETA,
      email: 'admin@beta.com',
      roles: ['admin'],
    });

    app = await buildServer();
  });

  afterEach(async () => {
    await app.close();
  });

  it('1. Publishes events and fetches initial snapshot ("Backfill then stream" §19)', async () => {
    // 1. Publish 3 events for Tenant Alpha
    for (let i = 1; i <= 3; i++) {
      const pubRes = await app.inject({
        method: 'POST',
        url: `/api/v2/tenants/${TENANT_ALPHA}/stream/publish`,
        headers: { authorization: `Bearer ${alphaAdminToken}` },
        payload: {
          type: 'task.started',
          agentId: 'lead_qual',
          executionId: `exec_${i}`,
          payload: { index: i },
        },
      });
      expect(pubRes.statusCode).toBe(201);
      const body = JSON.parse(pubRes.payload);
      expect(body.seq).toBeGreaterThan(0);
      expect(body.tenant_id).toBe(TENANT_ALPHA);
    }

    // 2. Fetch initial snapshot
    const initRes = await app.inject({
      method: 'GET',
      url: `/api/v2/tenants/${TENANT_ALPHA}/stream/initial`,
      headers: { authorization: `Bearer ${alphaAdminToken}` },
    });

    expect(initRes.statusCode).toBe(200);
    const snapshot = JSON.parse(initRes.payload);
    expect(snapshot.tenantId).toBe(TENANT_ALPHA);
    expect(snapshot.events).toHaveLength(3);
    expect(snapshot.latestSeq).toBeGreaterThanOrEqual(3);
  });

  it('2. Backfill endpoint returns exact sequence range for gap healing (§19)', async () => {
    let firstSeq = 0;
    let lastSeq = 0;

    for (let i = 1; i <= 5; i++) {
      const pubRes = await app.inject({
        method: 'POST',
        url: `/api/v2/tenants/${TENANT_ALPHA}/stream/publish`,
        headers: { authorization: `Bearer ${alphaAdminToken}` },
        payload: {
          type: 'task.completed',
          agentId: 'support_agent',
          payload: { taskIndex: i },
        },
      });
      const body = JSON.parse(pubRes.payload);
      if (i === 1) firstSeq = body.seq;
      if (i === 5) lastSeq = body.seq;
    }

    const backfillRes = await app.inject({
      method: 'GET',
      url: `/api/v2/tenants/${TENANT_ALPHA}/stream/backfill?from=${firstSeq + 1}&to=${lastSeq - 1}`,
      headers: { authorization: `Bearer ${alphaAdminToken}` },
    });

    expect(backfillRes.statusCode).toBe(200);
    const result = JSON.parse(backfillRes.payload);
    expect(result.count).toBe(3);
    expect(result.events[0].seq).toBe(firstSeq + 1);
    expect(result.events[2].seq).toBe(lastSeq - 1);
  });

  it('3. Enforces strict server-side tenant isolation: Tenant Beta CANNOT access Tenant Alpha stream (§19, Criterion 4)', async () => {
    // Attempt to fetch Alpha's snapshot using Beta's token -> 403 Forbidden
    const crossTenantInit = await app.inject({
      method: 'GET',
      url: `/api/v2/tenants/${TENANT_ALPHA}/stream/initial`,
      headers: { authorization: `Bearer ${betaAdminToken}` },
    });
    expect(crossTenantInit.statusCode).toBe(403);

    // Attempt to fetch Alpha's backfill using Beta's token -> 403 Forbidden
    const crossTenantBackfill = await app.inject({
      method: 'GET',
      url: `/api/v2/tenants/${TENANT_ALPHA}/stream/backfill?from=1&to=10`,
      headers: { authorization: `Bearer ${betaAdminToken}` },
    });
    expect(crossTenantBackfill.statusCode).toBe(403);

    // Attempt to publish to Alpha using Beta's token -> 403 Forbidden
    const crossTenantPublish = await app.inject({
      method: 'POST',
      url: `/api/v2/tenants/${TENANT_ALPHA}/stream/publish`,
      headers: { authorization: `Bearer ${betaAdminToken}` },
      payload: {
        type: 'task.started',
      },
    });
    expect(crossTenantPublish.statusCode).toBe(403);
  });
});
