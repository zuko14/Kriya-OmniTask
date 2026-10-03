/**
 * Kriya AI — Adversarial Knowledge Fabric Isolation & Scope Security Tests
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/api/server.js';
import { db } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { JwtService } from '../../src/security/auth/jwt.js';

describe('Adversarial Knowledge Fabric Isolation Security Tests', () => {
  let app: FastifyInstance;
  const tenantA = 'tenant_knowledge_sec_a';
  const tenantB = 'tenant_knowledge_sec_b';
  let tokenA: string;
  let tokenB: string;
  let docIdA: string;

  beforeAll(async () => {
    app = await buildServer();
    await app.ready();

    const client = db.getClient();
    const migrator = new SchemaMigrator(client);
    await migrator.applyMigrations();

    const now = new Date().toISOString();
    await client.execute(
      'INSERT OR IGNORE INTO tenants (id, name, slug, status, plan_tier, channel_plan, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?);',
      [tenantA, 'Tenant A Knowledge Corp', 'tenant-a-knowledge-corp', 'active', 'enterprise', 'combined', now, now]
    );
    await client.execute(
      'INSERT OR IGNORE INTO tenants (id, name, slug, status, plan_tier, channel_plan, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?);',
      [tenantB, 'Tenant B Knowledge Corp', 'tenant-b-knowledge-corp', 'active', 'standard', 'combined', now, now]
    );

    tokenA = JwtService.sign({
      userId: 'usr_admin_a',
      tenantId: tenantA,
      email: 'admin@tenanta.com',
      roles: ['admin'],
    });

    tokenB = JwtService.sign({
      userId: 'usr_admin_b',
      tenantId: tenantB,
      email: 'admin@tenantb.com',
      roles: ['admin'],
    });

    // Ingest sensitive secret document into Tenant A
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/knowledge/documents',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: {
        title: 'Confidential Acquisition Strategy',
        sourceType: 'text',
        mimeType: 'text/plain',
        content: 'Project Apollo secret target acquisition budget is $50,000,000.',
        accessScope: {
          allowedRoles: ['admin'],
          allowedAgents: ['executive_briefing_agent'],
          isPublicToTenant: false,
        },
      },
    });

    const body = JSON.parse(res.body);
    docIdA = body.document.id;
  });

  afterAll(async () => {
    const client = db.getClient();
    await client.execute('DELETE FROM knowledge_lineage_events WHERE tenant_id IN (?, ?);', [tenantA, tenantB]);
    await client.execute('DELETE FROM knowledge_chunks WHERE tenant_id IN (?, ?);', [tenantA, tenantB]);
    await client.execute('DELETE FROM knowledge_documents WHERE tenant_id IN (?, ?);', [tenantA, tenantB]);
    await client.execute('DELETE FROM tenants WHERE id IN (?, ?);', [tenantA, tenantB]);
    await app.close();
  });

  it('should prevent Tenant B from reading Tenant A document details by ID', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/knowledge/documents/${docIdA}`,
      headers: { authorization: `Bearer ${tokenB}` },
    });

    expect(res.statusCode).toBe(404);
  });

  it('should prevent Tenant B from retrieving Tenant A documents in hybrid RAG query', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/knowledge/query',
      headers: { authorization: `Bearer ${tokenB}` },
      payload: {
        query: 'Project Apollo secret target acquisition budget',
        topK: 5,
        minScore: 0.01,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.results.length).toBe(0);
    expect(body.sanitizedContext).not.toContain('$50,000,000');
  });

  it('should prevent Tenant B from deleting Tenant A document', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/knowledge/documents/${docIdA}`,
      headers: { authorization: `Bearer ${tokenB}` },
    });

    expect(res.statusCode).toBe(404);

    // Verify document still exists in Tenant A
    const verifyRes = await app.inject({
      method: 'GET',
      url: `/api/v1/knowledge/documents/${docIdA}`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    expect(verifyRes.statusCode).toBe(200);
  });
});
