/**
 * Xylarc AI — Agent Registry Integration Tests
 * Verifies Fastify REST endpoints for agent specification CRUD, system templates bootstrap,
 * quota validation, and state machine transitions.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/api/server.js';
import { db, DatabaseClient } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { JwtService } from '../../src/security/auth/jwt.js';

describe('Agent Registry & Lifecycle API Integration', () => {
  let app: FastifyInstance;
  let client: DatabaseClient;

  const tenantId = 'tenant_agent_api_test';
  const orgId = 'org_agent_api_test';
  let adminToken: string;

  beforeEach(async () => {
    client = db.getClient();
    const migrator = new SchemaMigrator(client);
    await migrator.applyMigrations();

    app = await buildServer();
    await app.ready();

    // Seed tenant & org
    await client.execute(
      `INSERT OR IGNORE INTO tenants (id, name, slug, plan_tier, channel_plan, status, created_at, updated_at)
       VALUES (?, 'Agent Tenant', 'agent-tenant', 'standard', 'combined', 'active', datetime('now'), datetime('now'));`,
      [tenantId]
    );

    await client.execute(
      `INSERT OR IGNORE INTO organizations (id, tenant_id, name, slug, created_at, updated_at)
       VALUES (?, ?, 'Agent Org', 'agent-org', datetime('now'), datetime('now'));`,
      [orgId, tenantId]
    );

    adminToken = JwtService.sign({
      userId: 'admin-user-1',
      tenantId,
      organizationId: orgId,
      roles: ['admin', 'owner'],
      email: 'admin@agent-test.com',
    });
  });

  afterEach(async () => {
    await app.close();
    await client.execute('DELETE FROM agent_lifecycle_events WHERE tenant_id = ?;', [tenantId]);
    await client.execute('DELETE FROM agents WHERE tenant_id = ?;', [tenantId]);
    await client.execute('DELETE FROM organizations WHERE tenant_id = ?;', [tenantId]);
    await client.execute('DELETE FROM tenants WHERE id = ?;', [tenantId]);
  });

  it('should list available system templates and bootstrap them for the tenant', async () => {
    // 1. Get templates
    const templateRes = await app.inject({
      method: 'GET',
      url: '/api/v1/agents/templates',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(templateRes.statusCode).toBe(200);
    const templateBody = JSON.parse(templateRes.body);
    expect(templateBody.templates.length).toBeGreaterThanOrEqual(4);

    // 2. Bootstrap templates
    const bootRes = await app.inject({
      method: 'POST',
      url: '/api/v1/agents/bootstrap',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(bootRes.statusCode).toBe(201);
    const bootBody = JSON.parse(bootRes.body);
    expect(bootBody.status).toBe('bootstrapped');
    expect(bootBody.createdCount).toBeGreaterThanOrEqual(4);
  });

  it('should register a custom agent, execute lifecycle transitions, and inspect history', async () => {
    // 1. Create Agent
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/agents',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        slug: 'custom_support_agent',
        name: 'Custom Support Agent',
        description: 'Handles returns and order status',
        category: 'specialist',
        department: 'support',
        autonomyLevel: 2,
        riskTier: 'LOW',
        version: '1.0.0',
        config: {
          systemPrompt: 'You are an e-commerce support specialist handling order issues and returns.',
          tools: ['order_lookup', 'refund_issue'],
          dataAccessScope: ['orders'],
          modelPolicy: {
            primaryModel: 'gemini-2.5-flash',
            temperature: 0.2,
            maxTokens: 2048,
          },
          escalationRules: {
            triggers: ['refund_above_50'],
            escalationTarget: 'human',
            minConfidenceThreshold: 0.85,
          },
          limits: {
            maxConcurrentTasks: 10,
            maxCostPerExecutionUsd: 0.20,
            timeoutMs: 15000,
            maxDailyOutreachPerCustomer: 3,
          },
          verificationApproach: 'deterministic',
          owner: 'support_admin',
        },
      },
    });

    expect(createRes.statusCode).toBe(201);
    const agent = JSON.parse(createRes.body).agent;
    expect(agent.slug).toBe('custom_support_agent');
    expect(agent.status).toBe('draft');

    // 2. Publish Agent: draft -> idle
    const transRes = await app.inject({
      method: 'POST',
      url: `/api/v1/agents/${agent.id}/transition`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        action: 'publish',
        reason: 'Initial production publish approval',
      },
    });

    expect(transRes.statusCode).toBe(200);
    const transBody = JSON.parse(transRes.body);
    expect(transBody.agent.status).toBe('idle');
    expect(transBody.event.from_state).toBe('draft');
    expect(transBody.event.to_state).toBe('idle');

    // 3. Get History
    const historyRes = await app.inject({
      method: 'GET',
      url: `/api/v1/agents/${agent.id}/history`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(historyRes.statusCode).toBe(200);
    const history = JSON.parse(historyRes.body).history;
    expect(history).toHaveLength(1);
    expect(history[0].transition).toBe('publish');
  });

  it('should reject registering agent when slug already exists in tenant', async () => {
    const payload = {
      slug: 'duplicate_slug_agent',
      name: 'Agent 1',
      category: 'specialist',
      department: 'sales',
      autonomyLevel: 1,
      riskTier: 'LOW',
      config: {
        systemPrompt: 'System prompt with sufficient characters for test.',
      },
    };

    // First create
    const res1 = await app.inject({
      method: 'POST',
      url: '/api/v1/agents',
      headers: { authorization: `Bearer ${adminToken}` },
      payload,
    });
    expect(res1.statusCode).toBe(201);

    // Duplicate create
    const res2 = await app.inject({
      method: 'POST',
      url: '/api/v1/agents',
      headers: { authorization: `Bearer ${adminToken}` },
      payload,
    });
    expect(res2.statusCode).toBe(409);
    const body = JSON.parse(res2.body);
    expect(body.error.code).toBe('CONFLICT');
  });
});
