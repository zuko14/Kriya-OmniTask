import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/api/server.js';
import { db } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { JwtService } from '../../src/security/auth/jwt.js';

describe('Adversarial Digital Twin & Organization Isolation Security Tests', () => {
  let app: FastifyInstance;
  const tenantA = 'tenant_twin_alpha';
  const tenantB = 'tenant_twin_beta';
  let tokenA: string;
  let tokenB: string;

  beforeAll(async () => {
    app = await buildServer();
    await app.ready();

    const client = db.getClient();
    const migrator = new SchemaMigrator(client);
    await migrator.applyMigrations();

    const now = new Date().toISOString();
    await client.execute(
      'INSERT OR IGNORE INTO tenants (id, name, slug, status, plan_tier, channel_plan, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?);',
      [tenantA, 'Tenant A Twin Corp', 'tenant-a-twin-corp', 'active', 'enterprise', 'combined', now, now]
    );
    await client.execute(
      'INSERT OR IGNORE INTO tenants (id, name, slug, status, plan_tier, channel_plan, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?);',
      [tenantB, 'Tenant B Twin Corp', 'tenant-b-twin-corp', 'active', 'standard', 'combined', now, now]
    );

    tokenA = JwtService.sign({
      userId: 'usr_admin_a',
      tenantId: tenantA,
      email: 'admina@xylarc.ai',
      roles: ['admin'],
    });

    tokenB = JwtService.sign({
      userId: 'usr_admin_b',
      tenantId: tenantB,
      email: 'adminb@xylarc.ai',
      roles: ['admin'],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('should isolate digital twin entities and relationships between tenants', async () => {
    // 1. Tenant A creates confidential department
    const resA = await app.inject({
      method: 'POST',
      url: '/api/v1/digital-twin/entities',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        entityType: 'department',
        name: 'Confidential R&D Dept Tenant A',
        slug: 'confidential-rd-a',
      },
    });
    expect(resA.statusCode).toBe(201);
    const entityAId = resA.json().id;

    // 2. Tenant B lists entities -> must NOT see Tenant A's department
    const listResB = await app.inject({
      method: 'GET',
      url: '/api/v1/digital-twin/graph',
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(listResB.statusCode).toBe(200);
    const graphB = listResB.json();
    expect(graphB.nodes.some((n: any) => n.id === entityAId)).toBe(false);

    // 3. Tenant B attempts to create relationship linking to Tenant A's entity -> must fail 404
    const relResB = await app.inject({
      method: 'POST',
      url: '/api/v1/digital-twin/relationships',
      headers: { authorization: `Bearer ${tokenB}` },
      payload: {
        sourceEntityId: entityAId,
        targetEntityId: entityAId,
        relationshipType: 'contains',
      },
    });
    expect(relResB.statusCode).toBe(404);
  });

  it('should isolate KPIs and bottlenecks between tenants', async () => {
    // 1. Tenant A records proprietary financial KPI
    await app.inject({
      method: 'POST',
      url: '/api/v1/digital-twin/kpis',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        kpiName: 'Proprietary Gross Margin',
        kpiKey: 'gross_margin_pct',
        category: 'financial',
        targetValue: 80.0,
        actualValue: 85.0,
        unit: 'percent',
      },
    });

    // 2. Tenant B queries KPIs -> must NOT see Tenant A's KPI
    const kpiResB = await app.inject({
      method: 'GET',
      url: '/api/v1/digital-twin/kpis',
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(kpiResB.statusCode).toBe(200);
    const kpisB = kpiResB.json().kpis;
    expect(kpisB.some((k: any) => k.kpi_key === 'gross_margin_pct')).toBe(false);
  });
});
