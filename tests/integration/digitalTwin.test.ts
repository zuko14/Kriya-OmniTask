import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/api/server.js';
import { db } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { JwtService } from '../../src/security/auth/jwt.js';

describe('Business Digital Twin & KPI Model REST Integration Tests', () => {
  let app: FastifyInstance;
  const tenantId = 'tenant_twin_test';
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
      [tenantId, 'Twin Test Corp', 'twin-test-corp', 'active', 'enterprise', 'combined', now, now]
    );

    adminToken = JwtService.sign({
      userId: 'usr_admin_twin',
      tenantId,
      email: 'twinadmin@xylarc.ai',
      roles: ['admin'],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  let deptId: string;
  let prodId: string;

  it('should create departments and products in digital twin', async () => {
    // 1. Create Department
    const res1 = await app.inject({
      method: 'POST',
      url: '/api/v1/digital-twin/entities',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        entityType: 'department',
        name: 'Enterprise AI Operations',
        slug: 'ai-ops',
        description: 'Autonomous AI workforce team',
      },
    });

    expect(res1.statusCode).toBe(201);
    const body1 = res1.json();
    expect(body1.id).toBeDefined();
    expect(body1.name).toBe('Enterprise AI Operations');
    deptId = body1.id;

    // 2. Create Product
    const res2 = await app.inject({
      method: 'POST',
      url: '/api/v1/digital-twin/entities',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        entityType: 'product',
        name: 'Autonomous Support Agent Pack',
        slug: 'support-pack',
        properties: { priceUsd: 999 },
      },
    });

    expect(res2.statusCode).toBe(201);
    const body2 = res2.json();
    prodId = body2.id;
  });

  it('should create relationship between department and product and retrieve graph topology', async () => {
    const relRes = await app.inject({
      method: 'POST',
      url: '/api/v1/digital-twin/relationships',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        sourceEntityId: deptId,
        targetEntityId: prodId,
        relationshipType: 'delivers',
      },
    });

    expect(relRes.statusCode).toBe(201);

    const graphRes = await app.inject({
      method: 'GET',
      url: '/api/v1/digital-twin/graph',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(graphRes.statusCode).toBe(200);
    const graph = graphRes.json();
    expect(graph.totalEntities).toBeGreaterThanOrEqual(2);
    expect(graph.totalRelationships).toBeGreaterThanOrEqual(1);
    expect(graph.nodes.some((n: any) => n.id === deptId)).toBe(true);
  });

  it('should record, evaluate, and list organization KPIs', async () => {
    const kpiRes = await app.inject({
      method: 'POST',
      url: '/api/v1/digital-twin/kpis',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        kpiName: 'Customer Support FCR Rate',
        kpiKey: 'fcr_rate',
        category: 'customer_experience',
        targetValue: 85.0,
        actualValue: 90.0,
        unit: 'percent',
      },
    });

    expect(kpiRes.statusCode).toBe(201);

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/digital-twin/kpis',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(listRes.statusCode).toBe(200);
    const listBody = listRes.json();
    expect(listBody.kpis.length).toBeGreaterThanOrEqual(1);
    expect(listBody.healthOverview).toBeDefined();
    expect(listBody.healthOverview.onTrack + listBody.healthOverview.exceeded).toBeGreaterThan(0);
  });

  it('should run operational diagnostics and record active bottlenecks', async () => {
    const diagRes = await app.inject({
      method: 'POST',
      url: '/api/v1/digital-twin/diagnose',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        funnel: {
          totalLeads: 200,
          qualifiedLeads: 80,
          bookedAppointments: 8, // ~10% drop-off
          closedWonCustomers: 2,
          averageContractValueUsd: 1500,
        },
        support: {
          totalTickets: 50,
          escalatedToHumanCount: 25, // 50% escalation
          slaBreachCount: 3,
          averageFirstResponseSeconds: 90,
          highChurnRiskCount: 2,
        },
      },
    });

    expect(diagRes.statusCode).toBe(200);
    const diagBody = diagRes.json();
    expect(diagBody.count).toBeGreaterThanOrEqual(2);

    const listBottlenecks = await app.inject({
      method: 'GET',
      url: '/api/v1/digital-twin/bottlenecks',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(listBottlenecks.statusCode).toBe(200);
    expect(listBottlenecks.json().count).toBeGreaterThanOrEqual(2);
  });
});
