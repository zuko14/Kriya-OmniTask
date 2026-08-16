/**
 * Xylarc AI — Adversarial Tool Gateway & Credential Isolation Security Tests
 * Verifies cross-tenant credential isolation, execution ledger boundaries, and permission tamper resistance (§8.4, §18 of CLAUDE.md).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/api/server.js';
import { db, DatabaseClient } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { JwtService } from '../../src/security/auth/jwt.js';
import { TenantContextManager } from '../../src/core/context/tenantContext.js';
import { CredentialVault } from '../../src/tools/vault/credentialVault.js';

describe('Adversarial Tool Gateway & Credential Isolation Security Tests', () => {
  let app: FastifyInstance;
  let client: DatabaseClient;

  const tenantA = 'tenant_tool_sec_a';
  const tenantB = 'tenant_tool_sec_b';
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
       (?, 'Tenant A', 'tenant-a-tool-sec', 'standard', 'combined', 'active', datetime('now'), datetime('now')),
       (?, 'Tenant B', 'tenant-b-tool-sec', 'standard', 'combined', 'active', datetime('now'), datetime('now'));`,
      [tenantA, tenantB]
    );

    tokenA = JwtService.sign({
      userId: 'user-a',
      tenantId: tenantA,
      organizationId: 'org-a',
      roles: ['admin', 'owner'],
      email: 'user-a@tool-sec.com',
    });

    tokenB = JwtService.sign({
      userId: 'user-b',
      tenantId: tenantB,
      organizationId: 'org-b',
      roles: ['admin', 'owner'],
      email: 'user-b@tool-sec.com',
    });

    // Store private credential in Tenant A
    await TenantContextManager.withTenant(tenantA, 'org-a', async () => {
      const vault = new CredentialVault();
      await vault.storeSecret({
        serviceSlug: 'confidential_crm',
        name: 'Tenant A Confidential CRM',
        secretData: { secretApiKey: 'sk-tenant-a-super-secret-key-12345' },
      });
    });
  });

  afterEach(async () => {
    await app.close();
    await client.execute('DELETE FROM tool_executions WHERE tenant_id IN (?, ?);', [tenantA, tenantB]);
    await client.execute('DELETE FROM tool_permissions WHERE tenant_id IN (?, ?);', [tenantA, tenantB]);
    await client.execute('DELETE FROM tenant_credentials WHERE tenant_id IN (?, ?);', [tenantA, tenantB]);
    await client.execute('DELETE FROM tenants WHERE id IN (?, ?);', [tenantA, tenantB]);
  });

  it('should prevent Tenant B from viewing or discovering Tenant A vault credentials', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/tools/credentials',
      headers: { authorization: `Bearer ${tokenB}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.services.length).toBe(0);
    expect(body.services.some((s: any) => s.serviceSlug === 'confidential_crm')).toBe(false);
  });

  it('should prevent Tenant B from deleting Tenant A vault credentials', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/v1/tools/credentials/confidential_crm',
      headers: { authorization: `Bearer ${tokenB}` },
    });

    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('NOT_FOUND');

    // Confirm secret remains intact in Tenant A
    await TenantContextManager.withTenant(tenantA, 'org-a', async () => {
      const vault = new CredentialVault();
      const secret = await vault.getSecret('confidential_crm');
      expect(secret).not.toBeNull();
    });
  });

  it('should prevent Tenant B from viewing Tenant A tool execution audit logs', async () => {
    // Execute tool under Tenant A
    await app.inject({
      method: 'POST',
      url: '/api/v1/tools/execute',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        toolSlug: 'calendar_check_availability',
        input: { date: '2026-10-01', durationMinutes: 30 },
      },
    });

    // Query logs as Tenant B
    const resB = await app.inject({
      method: 'GET',
      url: '/api/v1/tools/executions',
      headers: { authorization: `Bearer ${tokenB}` },
    });

    expect(resB.statusCode).toBe(200);
    const bodyB = JSON.parse(resB.body);
    expect(bodyB.executions.length).toBe(0);
  });
});
