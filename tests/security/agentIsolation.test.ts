/**
 * Xylarc AI — Adversarial Multi-Tenant Agent Isolation Security Tests
 * Verifies that agent specifications, state transitions, and audit histories are strictly isolated across tenants (§6, §26 of CLAUDE.md).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/api/server.js';
import { db, DatabaseClient } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { JwtService } from '../../src/security/auth/jwt.js';

describe('Adversarial Multi-Tenant Agent Isolation Tests', () => {
  let app: FastifyInstance;
  let client: DatabaseClient;

  const tenantA = 'tenant_a_agent_sec';
  const tenantB = 'tenant_b_agent_sec';
  let tokenA: string;
  let tokenB: string;

  beforeEach(async () => {
    client = db.getClient();
    const migrator = new SchemaMigrator(client);
    await migrator.applyMigrations();

    app = await buildServer();
    await app.ready();

    // Seed Tenant A & Tenant B
    await client.execute(
      `INSERT OR IGNORE INTO tenants (id, name, slug, plan_tier, channel_plan, status, created_at, updated_at) VALUES
       (?, 'Tenant A', 'tenant-a-sec', 'standard', 'combined', 'active', datetime('now'), datetime('now')),
       (?, 'Tenant B', 'tenant-b-sec', 'standard', 'combined', 'active', datetime('now'), datetime('now'));`,
      [tenantA, tenantB]
    );

    tokenA = JwtService.sign({
      userId: 'user-a',
      tenantId: tenantA,
      organizationId: 'org-a',
      roles: ['admin', 'owner'],
      email: 'user-a@agent-sec.com',
    });

    tokenB = JwtService.sign({
      userId: 'user-b',
      tenantId: tenantB,
      organizationId: 'org-b',
      roles: ['admin', 'owner'],
      email: 'user-b@agent-sec.com',
    });
  });

  afterEach(async () => {
    await app.close();
    await client.execute('DELETE FROM agent_lifecycle_events WHERE tenant_id IN (?, ?);', [tenantA, tenantB]);
    await client.execute('DELETE FROM agents WHERE tenant_id IN (?, ?);', [tenantA, tenantB]);
    await client.execute('DELETE FROM tenants WHERE id IN (?, ?);', [tenantA, tenantB]);
  });

  it('should prevent Tenant B from reading, listing, or updating Tenant A agents', async () => {
    // 1. Tenant A creates an agent
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/agents',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        slug: 'confidential_sales_agent',
        name: 'Confidential Sales Agent',
        category: 'specialist',
        department: 'sales',
        autonomyLevel: 2,
        riskTier: 'LOW',
        config: {
          systemPrompt: 'System prompt with sufficient characters for test.',
        },
      },
    });

    expect(createRes.statusCode).toBe(201);
    const agentAId = JSON.parse(createRes.body).agent.id;

    // 2. Tenant B attempts to GET Tenant A's agent by ID
    const getResB = await app.inject({
      method: 'GET',
      url: `/api/v1/agents/${agentAId}`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(getResB.statusCode).toBe(404);

    // 3. Tenant B lists agents and should see 0 agents
    const listResB = await app.inject({
      method: 'GET',
      url: '/api/v1/agents',
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(listResB.statusCode).toBe(200);
    const listB = JSON.parse(listResB.body).agents;
    expect(listB).toHaveLength(0);

    // 4. Tenant B attempts to trigger transition on Tenant A's agent
    const transResB = await app.inject({
      method: 'POST',
      url: `/api/v1/agents/${agentAId}/transition`,
      headers: { authorization: `Bearer ${tokenB}` },
      payload: {
        action: 'publish',
        reason: 'Malicious state change attempt by Tenant B',
      },
    });
    expect(transResB.statusCode).toBe(404);
  });

  it('should allow identical agent slugs across different tenants without collision', async () => {
    const payload = {
      slug: 'shared_slug_agent',
      name: 'Shared Slug Agent',
      category: 'specialist',
      department: 'sales',
      autonomyLevel: 1,
      riskTier: 'LOW',
      config: {
        systemPrompt: 'System prompt with sufficient characters for test.',
      },
    };

    // Tenant A creates agent with slug
    const resA = await app.inject({
      method: 'POST',
      url: '/api/v1/agents',
      headers: { authorization: `Bearer ${tokenA}` },
      payload,
    });
    expect(resA.statusCode).toBe(201);

    // Tenant B creates agent with SAME slug
    const resB = await app.inject({
      method: 'POST',
      url: '/api/v1/agents',
      headers: { authorization: `Bearer ${tokenB}` },
      payload,
    });
    expect(resB.statusCode).toBe(201);
  });
});
