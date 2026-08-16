/**
 * Xylarc AI — Adversarial Workflow & Approval Isolation Security Tests
 * Verifies cross-tenant isolation for workflow definitions, execution traces, and approval requests (§13, §15 of CLAUDE.md).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/api/server.js';
import { db, DatabaseClient } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { JwtService } from '../../src/security/auth/jwt.js';
import { TenantContextManager } from '../../src/core/context/tenantContext.js';
import { WorkflowService } from '../../src/workflows/service/workflowService.js';

describe('Adversarial Workflow & Approval Isolation Security Tests', () => {
  let app: FastifyInstance;
  let client: DatabaseClient;

  const tenantA = 'tenant_wf_sec_a';
  const tenantB = 'tenant_wf_sec_b';
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
       (?, 'Tenant A', 'tenant-a-wf-sec', 'standard', 'combined', 'active', datetime('now'), datetime('now')),
       (?, 'Tenant B', 'tenant-b-wf-sec', 'standard', 'combined', 'active', datetime('now'), datetime('now'));`,
      [tenantA, tenantB]
    );

    tokenA = JwtService.sign({
      userId: 'user-a',
      tenantId: tenantA,
      organizationId: 'org-a',
      roles: ['admin', 'owner'],
      email: 'user-a@wf-sec.com',
    });

    tokenB = JwtService.sign({
      userId: 'user-b',
      tenantId: tenantB,
      organizationId: 'org-b',
      roles: ['admin', 'owner'],
      email: 'user-b@wf-sec.com',
    });

    // Tenant A creates a proprietary confidential workflow
    await TenantContextManager.withTenant(tenantA, 'org-a', async () => {
      const service = new WorkflowService();
      await service.createWorkflow({
        slug: 'confidential_payroll_pipeline',
        name: 'Confidential Payroll Pipeline',
        description: 'Internal payroll processing DAG',
        dag: {
          steps: [
            {
              id: 'approval_gate',
              name: 'Payroll Approval Gate',
              type: 'human_approval',
              dependsOn: [],
              config: { title: 'Approve $50,000 Payroll', description: 'Internal approval' },
            },
          ],
        },
      });
    });
  });

  afterEach(async () => {
    await app.close();
    await client.execute('DELETE FROM workflow_approval_requests WHERE tenant_id IN (?, ?);', [tenantA, tenantB]);
    await client.execute('DELETE FROM workflow_executions WHERE tenant_id IN (?, ?);', [tenantA, tenantB]);
    await client.execute('DELETE FROM workflow_definitions WHERE tenant_id IN (?, ?);', [tenantA, tenantB]);
    await client.execute('DELETE FROM tenants WHERE id IN (?, ?);', [tenantA, tenantB]);
  });

  it('should prevent Tenant B from seeing Tenant A confidential workflow definitions', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/workflows',
      headers: { authorization: `Bearer ${tokenB}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.workflows.some((w: any) => w.slug === 'confidential_payroll_pipeline')).toBe(false);
  });

  it('should prevent Tenant B from triggering Tenant A confidential workflow', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/confidential_payroll_pipeline/trigger',
      headers: { authorization: `Bearer ${tokenB}` },
      payload: {},
    });

    expect(res.statusCode).toBe(404);
  });

  it('should prevent Tenant B from viewing or deciding Tenant A pending approval requests', async () => {
    // 1. Trigger workflow under Tenant A to generate pending approval
    let executionIdA: string = '';
    await TenantContextManager.withTenant(tenantA, 'org-a', async () => {
      const service = new WorkflowService();
      const exec = await service.triggerWorkflow('confidential_payroll_pipeline', {});
      executionIdA = exec.id;
    });

    // 2. Query pending approvals as Tenant B
    const approvalsResB = await app.inject({
      method: 'GET',
      url: '/api/v1/workflows/approvals',
      headers: { authorization: `Bearer ${tokenB}` },
    });

    expect(approvalsResB.statusCode).toBe(200);
    const approvalsBodyB = JSON.parse(approvalsResB.body);
    expect(approvalsBodyB.approvals.length).toBe(0);

    // 3. Attempt to approve Tenant A request as Tenant B
    const hijackRes = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/approvals/decide',
      headers: { authorization: `Bearer ${tokenB}` },
      payload: {
        executionId: executionIdA,
        stepId: 'approval_gate',
        decision: 'approved',
      },
    });

    // Should fail with 400/404 because execution is invisible to Tenant B
    expect([400, 404, 500]).toContain(hijackRes.statusCode);
  });
});
