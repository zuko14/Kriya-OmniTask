import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/api/server.js';
import { SQLiteDatabaseClient, db } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';

describe('Control Plane API Integration', () => {
  let app: FastifyInstance;
  let client: SQLiteDatabaseClient;
  let authToken: string;
  let tenantId: string;
  let orgId: string;

  beforeEach(async () => {
    client = new SQLiteDatabaseClient(':memory:');
    db.setClientForTesting(client);
    const migrator = new SchemaMigrator(client);
    await migrator.applyMigrations();

    app = await buildServer();
    await app.ready();

    // Register root tenant
    const regRes = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        tenantName: 'Control Tenant',
        tenantSlug: 'ctrl-tenant',
        organizationName: 'Main Org',
        email: 'owner@ctrl.com',
        password: 'ControlPassword123!',
        fullName: 'Control Owner',
        planTier: 'enterprise',
      },
    });

    const regBody = JSON.parse(regRes.body);
    authToken = regBody.accessToken;
    tenantId = regBody.tenant.id;
    orgId = regBody.organization.id;
  });

  afterEach(async () => {
    await app.close();
    await client.close();
  });

  it('should get tenant profile and limits via GET /api/v1/tenants/:id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/tenants/${tenantId}`,
      headers: { authorization: `Bearer ${authToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.tenant.name).toBe('Control Tenant');
    expect(body.limits.maxAgents).toBe(100);
  });

  it('should update tenant configuration via PATCH /api/v1/tenants/:id/config', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/tenants/${tenantId}/config`,
      headers: { authorization: `Bearer ${authToken}` },
      payload: {
        settings: {
          enableVoicePipeline: true,
          dailyTokenBudget: 5_000_000,
        },
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
  });

  it('should create and list workspaces for organization', async () => {
    // 1. Create Workspace
    const createWsRes = await app.inject({
      method: 'POST',
      url: `/api/v1/organizations/${orgId}/workspaces`,
      headers: { authorization: `Bearer ${authToken}` },
      payload: {
        name: 'Customer Success Dept',
        slug: 'cs-dept',
      },
    });

    expect(createWsRes.statusCode).toBe(201);
    const wsBody = JSON.parse(createWsRes.body);
    expect(wsBody.workspace.name).toBe('Customer Success Dept');

    // 2. List Workspaces
    const listRes = await app.inject({
      method: 'GET',
      url: `/api/v1/organizations/${orgId}/workspaces`,
      headers: { authorization: `Bearer ${authToken}` },
    });

    expect(listRes.statusCode).toBe(200);
    const listBody = JSON.parse(listRes.body);
    expect(listBody.workspaces.length).toBe(1);
    expect(listBody.workspaces[0].slug).toBe('cs-dept');
  });

  it('should invite and list users in tenant', async () => {
    const inviteRes = await app.inject({
      method: 'POST',
      url: '/api/v1/users/invite',
      headers: { authorization: `Bearer ${authToken}` },
      payload: {
        email: 'operator@ctrl.com',
        fullName: 'Agent Operator 1',
        temporaryPassword: 'TempPassword123!',
        role: 'agent_operator',
      },
    });

    expect(inviteRes.statusCode).toBe(201);
    const inviteBody = JSON.parse(inviteRes.body);
    expect(inviteBody.user.email).toBe('operator@ctrl.com');

    // List users
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/users',
      headers: { authorization: `Bearer ${authToken}` },
    });

    expect(listRes.statusCode).toBe(200);
    const listBody = JSON.parse(listRes.body);
    expect(listBody.users.length).toBe(2); // Owner + Invited user
  });
});
