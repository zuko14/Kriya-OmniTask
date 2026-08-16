/**
 * Xylarc AI — Mediated Tool Gateway Integration Tests
 * Verifies Fastify REST endpoints for tool execution, idempotency, risk gating, permissions, and credential vault.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/api/server.js';
import { db, DatabaseClient } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { JwtService } from '../../src/security/auth/jwt.js';
import { TenantContextManager } from '../../src/core/context/tenantContext.js';
import { AgentRegistryService } from '../../src/agents/registry/agentRegistry.js';

describe('Mediated Tool Gateway Integration Tests', () => {
  let app: FastifyInstance;
  let client: DatabaseClient;

  const tenantId = 'tenant_tool_gateway_int_test';
  const orgId = 'org_tool_gateway_int_test';
  let adminToken: string;
  let limitedAgentId: string;

  beforeEach(async () => {
    client = db.getClient();
    const migrator = new SchemaMigrator(client);
    await migrator.applyMigrations();

    app = await buildServer();
    await app.ready();

    // Seed tenant & org
    await client.execute(
      `INSERT OR IGNORE INTO tenants (id, name, slug, plan_tier, channel_plan, status, created_at, updated_at)
       VALUES (?, 'Tool Tenant', 'tool-tenant', 'standard', 'combined', 'active', datetime('now'), datetime('now'));`,
      [tenantId]
    );

    await client.execute(
      `INSERT OR IGNORE INTO organizations (id, tenant_id, name, slug, created_at, updated_at)
       VALUES (?, ?, 'Tool Org', 'tool-org', datetime('now'), datetime('now'));`,
      [orgId, tenantId]
    );

    // Create an agent with limited tool permissions (only calendar_check_availability)
    await TenantContextManager.withTenant(tenantId, orgId, async () => {
      const registry = new AgentRegistryService();
      const agent = await registry.registerAgent({
        slug: 'limited_calendar_agent',
        name: 'Limited Calendar Agent',
        category: 'specialist',
        department: 'general',
        autonomyLevel: 2,
        riskTier: 'LOW',
        config: {
          systemPrompt: 'You can only check availability.',
          tools: ['calendar_check_availability'],
        },
      });
      limitedAgentId = agent.id;
    });

    adminToken = JwtService.sign({
      userId: 'tool-admin-user',
      tenantId,
      organizationId: orgId,
      roles: ['admin', 'owner'],
      email: 'admin@tool-test.com',
    });
  });

  afterEach(async () => {
    await app.close();
    await client.execute('DELETE FROM tool_executions WHERE tenant_id = ?;', [tenantId]);
    await client.execute('DELETE FROM tool_permissions WHERE tenant_id = ?;', [tenantId]);
    await client.execute('DELETE FROM tenant_credentials WHERE tenant_id = ?;', [tenantId]);
    await client.execute('DELETE FROM agents WHERE tenant_id = ?;', [tenantId]);
    await client.execute('DELETE FROM organizations WHERE tenant_id = ?;', [tenantId]);
    await client.execute('DELETE FROM tenants WHERE id = ?;', [tenantId]);
  });

  it('should list all registered tools via GET /api/v1/tools', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/tools',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.total).toBeGreaterThanOrEqual(6);
    expect(body.tools.some((t: any) => t.slug === 'calendar_check_availability')).toBe(true);
  });

  it('should execute a tool and return structured output with execution record', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/tools/execute',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        toolSlug: 'calendar_check_availability',
        input: { date: '2026-09-15', durationMinutes: 30 },
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('completed');
    expect(body.result.availableSlots.length).toBeGreaterThan(0);
    expect(body.isIdempotentReplay).toBe(false);
  });

  it('should return cached idempotent replay when executing with same idempotencyKey', async () => {
    const idempotencyKey = 'idem-key-test-999';

    // 1st Execution
    const res1 = await app.inject({
      method: 'POST',
      url: '/api/v1/tools/execute',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        toolSlug: 'calendar_check_availability',
        idempotencyKey,
        input: { date: '2026-09-15', durationMinutes: 30 },
      },
    });

    expect(res1.statusCode).toBe(200);
    const body1 = JSON.parse(res1.body);
    expect(body1.isIdempotentReplay).toBe(false);

    // 2nd Execution (Idempotent Replay)
    const res2 = await app.inject({
      method: 'POST',
      url: '/api/v1/tools/execute',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        toolSlug: 'calendar_check_availability',
        idempotencyKey,
        input: { date: '2026-09-15', durationMinutes: 30 },
      },
    });

    expect(res2.statusCode).toBe(200);
    const body2 = JSON.parse(res2.body);
    expect(body2.isIdempotentReplay).toBe(true);
    expect(body2.executionId).toBe(body1.executionId);
  });

  it('should pause CRITICAL risk tools for human authorization', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/tools/execute',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        toolSlug: 'financial_issue_refund',
        input: {
          customerId: 'cust-123',
          transactionId: 'txn-456',
          amountUsd: 250.00,
          reason: 'Customer requested cancellation within 24h',
        },
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('needs_approval');
    expect(body.requiresHumanApproval).toBe(true);
  });

  it('should enforce agent tool whitelist and reject unauthorized tool invocation', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/tools/execute',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        agentId: limitedAgentId,
        toolSlug: 'custom_http_webhook', // Not authorized on limitedAgentId
        input: {
          endpointUrl: 'https://example.com/webhook',
          payload: { test: true },
        },
      },
    });

    expect(res.statusCode).toBe(422);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('POLICY_VIOLATION');
  });

  it('should store and list credentials via Credential Vault REST APIs', async () => {
    // Store secret
    const storeRes = await app.inject({
      method: 'POST',
      url: '/api/v1/tools/credentials',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        serviceSlug: 'hubspot',
        name: 'HubSpot Marketing API',
        secretData: { accessToken: 'pat-na1-secret-hubspot-token' },
      },
    });

    expect(storeRes.statusCode).toBe(201);
    const storeBody = JSON.parse(storeRes.body);
    expect(storeBody.serviceSlug).toBe('hubspot');

    // List credentials (secret redacted)
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/tools/credentials',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(listRes.statusCode).toBe(200);
    const listBody = JSON.parse(listRes.body);
    expect(listBody.services.some((s: any) => s.serviceSlug === 'hubspot')).toBe(true);
  });
});
