/**
 * Xylarc AI — Knowledge Fabric REST Integration Tests
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/api/server.js';
import { db } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { JwtService } from '../../src/security/auth/jwt.js';

describe('Knowledge Fabric REST Integration Tests', () => {
  let app: FastifyInstance;
  const tenantId = 'tenant_knowledge_integration_test';
  let adminToken: string;
  let ingestedDocId: string;

  beforeAll(async () => {
    app = await buildServer();
    await app.ready();

    const client = db.getClient();
    const migrator = new SchemaMigrator(client);
    await migrator.applyMigrations();

    const now = new Date().toISOString();
    await client.execute(
      'INSERT OR IGNORE INTO tenants (id, name, slug, status, plan_tier, channel_plan, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?);',
      [tenantId, 'Knowledge Test Tenant', 'knowledge-test-tenant', 'active', 'enterprise', 'combined', now, now]
    );

    adminToken = JwtService.sign({
      userId: 'usr_admin_1',
      tenantId,
      email: 'admin@xylarc.ai',
      roles: ['admin'],
    });
  });

  afterAll(async () => {
    const client = db.getClient();
    await client.execute('DELETE FROM knowledge_lineage_events WHERE tenant_id = ?;', [tenantId]);
    await client.execute('DELETE FROM knowledge_chunks WHERE tenant_id = ?;', [tenantId]);
    await client.execute('DELETE FROM knowledge_documents WHERE tenant_id = ?;', [tenantId]);
    await client.execute('DELETE FROM tenants WHERE id = ?;', [tenantId]);
    await app.close();
  });

  it('should ingest a document with chunking and lineage via POST /api/v1/knowledge/documents', async () => {
    const markdownContent = `
# Customer Escalation SOP
When a customer indicates severe frustration or threatens cancellation, follow these steps:
1. Empathize and acknowledge the core difficulty immediately.
2. Route the ticket to a Senior Support Specialist with priority Critical.

## Refund Authority Limits
Support specialists may authorize refunds up to $150. Amounts above $150 require Director approval.
    `.trim();

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/knowledge/documents',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        title: 'Customer Escalation & Refund SOP',
        sourceType: 'policy_sop',
        mimeType: 'text/markdown',
        content: markdownContent,
        provenance: {
          author: 'Customer Operations Team',
          tags: ['sop', 'support', 'escalations', 'refunds'],
        },
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.document.id).toBeDefined();
    expect(body.chunkCount).toBeGreaterThan(0);
    expect(body.document.quality_status).toBe('UNVERIFIED');

    ingestedDocId = body.document.id;
  });

  it('should list tenant documents via GET /api/v1/knowledge/documents', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/knowledge/documents',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.documents.length).toBeGreaterThan(0);
    expect(body.documents.some((d: any) => d.id === ingestedDocId)).toBe(true);
  });

  it('should fetch document with chunks via GET /api/v1/knowledge/documents/:id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/knowledge/documents/${ingestedDocId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.document.id).toBe(ingestedDocId);
    expect(body.chunks.length).toBeGreaterThan(0);
  });

  it('should query knowledge using hybrid RAG via POST /api/v1/knowledge/query', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/knowledge/query',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        query: 'What is the refund authority limit for support specialists?',
        topK: 3,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.results.length).toBeGreaterThan(0);
    expect(body.results[0].content).toContain('$150');
    expect(body.sanitizedContext).toContain('<untrusted_knowledge_evidence>');
  });

  it('should update quality status via POST /api/v1/knowledge/documents/:id/verify', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/knowledge/documents/${ingestedDocId}/verify`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        status: 'VERIFIED',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.quality_status).toBe('VERIFIED');
  });

  it('should delete document and cascade chunks via DELETE /api/v1/knowledge/documents/:id', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/knowledge/documents/${ingestedDocId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.deleted).toBe(true);

    // Verify retrieval returns empty
    const verifyRes = await app.inject({
      method: 'GET',
      url: `/api/v1/knowledge/documents/${ingestedDocId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(verifyRes.statusCode).toBe(404);
  });
});
