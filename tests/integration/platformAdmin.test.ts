import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/api/server.js';
import { db } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { JwtService } from '../../src/security/auth/jwt.js';

describe('Platform Administration REST Integration Tests', () => {
  let app: FastifyInstance;
  const operatorTenantId = 'tenant_system_root';
  let operatorToken: string;

  beforeAll(async () => {
    app = await buildServer();
    await app.ready();

    const client = db.getClient();
    const migrator = new SchemaMigrator(client);
    await migrator.applyMigrations();

    const now = new Date().toISOString();
    await client.execute(
      'INSERT OR IGNORE INTO tenants (id, name, slug, status, plan_tier, channel_plan, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?);',
      [operatorTenantId, 'System Operator Tenant', 'sys-operator', 'active', 'enterprise', 'combined', now, now]
    );

    operatorToken = JwtService.sign({
      userId: 'usr_super_operator',
      tenantId: operatorTenantId,
      email: 'operator@kriya.ai',
      roles: ['system'],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('should provision tenants, update lifecycles, track fleet health, broadcast announcements, and control maintenance', async () => {
    // 1. Provision Tenant
    const provRes = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/tenants/provision',
      headers: { authorization: `Bearer ${operatorToken}` },
      payload: {
        id: 'tenant_fintech_edge',
        name: 'FinTech Edge Inc',
        slug: 'fintech-edge',
        planTier: 'enterprise',
        channelPlan: 'combined',
        adminEmail: 'cto@fintechedge.com',
        maxAgents: 25,
        maxWorkflows: 100,
      },
    });

    expect(provRes.statusCode).toBe(201);
    expect(provRes.json().id).toBe('tenant_fintech_edge');

    // 2. Suspend Tenant
    const suspendRes = await app.inject({
      method: 'PUT',
      url: '/api/v1/admin/tenants/tenant_fintech_edge/status',
      headers: { authorization: `Bearer ${operatorToken}` },
      payload: {
        status: 'suspended',
        reason: 'Payment delinquency hold',
      },
    });

    expect(suspendRes.statusCode).toBe(200);

    // 3. Reactivate Tenant
    const reactivateRes = await app.inject({
      method: 'PUT',
      url: '/api/v1/admin/tenants/tenant_fintech_edge/status',
      headers: { authorization: `Bearer ${operatorToken}` },
      payload: {
        status: 'active',
        reason: 'Payment confirmed by billing operator',
      },
    });

    expect(reactivateRes.statusCode).toBe(200);

    // 4. List All Tenants
    const listTenantsRes = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/tenants',
      headers: { authorization: `Bearer ${operatorToken}` },
    });

    expect(listTenantsRes.statusCode).toBe(200);
    expect(listTenantsRes.json().tenants.some((t: any) => t.id === 'tenant_fintech_edge')).toBe(true);

    // 5. Ingest Node Fleet Heartbeat
    const hbRes = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/fleet/heartbeat',
      headers: { authorization: `Bearer ${operatorToken}` },
      payload: {
        nodeId: 'worker_cluster_node_alpha',
        clusterRegion: 'ap-south-1',
        status: 'healthy',
        cpuUsagePct: 35.5,
        memoryUsagePct: 42.0,
        activeWorkerThreads: 16,
        activeAgentExecutions: 6,
      },
    });

    expect(hbRes.statusCode).toBe(200);
    expect(hbRes.json().nodeId).toBe('worker_cluster_node_alpha');

    // 6. Get Fleet Diagnostics
    const diagRes = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/fleet/diagnostics',
      headers: { authorization: `Bearer ${operatorToken}` },
    });

    expect(diagRes.statusCode).toBe(200);
    expect(diagRes.json().onlineNodes).toBeGreaterThanOrEqual(1);

    // 7. Create System Announcement
    const ancRes = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/announcements',
      headers: { authorization: `Bearer ${operatorToken}` },
      payload: {
        title: 'Platform Maintenance Notice',
        message: 'Database optimization scheduled at midnight UTC',
        severity: 'maintenance',
        targetTenantIds: ['*'],
      },
    });

    expect(ancRes.statusCode).toBe(201);
    expect(ancRes.json().title).toBe('Platform Maintenance Notice');

    // 8. List Announcements
    const listAncRes = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/announcements',
      headers: { authorization: `Bearer ${operatorToken}` },
    });

    expect(listAncRes.statusCode).toBe(200);
    expect(listAncRes.json().count).toBeGreaterThanOrEqual(1);

    // 9. Update Maintenance Mode
    const maintRes = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/maintenance',
      headers: { authorization: `Bearer ${operatorToken}` },
      payload: {
        isMaintenanceActive: false,
        readOnlyMode: false,
        emergencyKillActive: false,
        reason: 'Maintenance drill concluded successfully',
      },
    });

    expect(maintRes.statusCode).toBe(200);
    expect(maintRes.json().isMaintenanceActive).toBe(false);

    // 10. List Operator Audit Logs
    const auditRes = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/audit-logs',
      headers: { authorization: `Bearer ${operatorToken}` },
    });

    expect(auditRes.statusCode).toBe(200);
    expect(auditRes.json().count).toBeGreaterThanOrEqual(1);
  });
});
