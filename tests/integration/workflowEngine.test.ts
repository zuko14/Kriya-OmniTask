/**
 * Kriya AI — Workflow Engine REST Integration Tests
 * Verifies Fastify endpoints for workflow definitions, execution dispatch, and human approval resolutions.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/api/server.js';
import { db, DatabaseClient } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { JwtService } from '../../src/security/auth/jwt.js';

describe('Workflow Engine REST Integration Tests', () => {
  let app: FastifyInstance;
  let client: DatabaseClient;

  const tenantId = 'tenant_wf_int_test';
  const orgId = 'org_wf_int_test';
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
       VALUES (?, 'Workflow Tenant', 'wf-int-tenant', 'standard', 'combined', 'active', datetime('now'), datetime('now'));`,
      [tenantId]
    );

    await client.execute(
      `INSERT OR IGNORE INTO organizations (id, tenant_id, name, slug, created_at, updated_at)
       VALUES (?, ?, 'Workflow Org', 'wf-int-org', datetime('now'), datetime('now'));`,
      [orgId, tenantId]
    );

    adminToken = JwtService.sign({
      userId: 'wf-admin-user',
      tenantId,
      organizationId: orgId,
      roles: ['admin', 'owner'],
      email: 'admin@workflow-int.com',
    });
  });

  afterEach(async () => {
    await app.close();
    await client.execute('DELETE FROM workflow_approval_requests WHERE tenant_id = ?;', [tenantId]);
    await client.execute('DELETE FROM workflow_executions WHERE tenant_id = ?;', [tenantId]);
    await client.execute('DELETE FROM workflow_definitions WHERE tenant_id = ?;', [tenantId]);
    await client.execute('DELETE FROM organizations WHERE tenant_id = ?;', [tenantId]);
    await client.execute('DELETE FROM tenants WHERE id = ?;', [tenantId]);
  });

  it('should create and trigger a multi-step workflow via REST API', async () => {
    // 1. Create workflow
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        slug: 'booking_orchestration_flow',
        name: 'Booking Orchestration Flow',
        description: 'Multi-step booking and calendar availability verification flow',
        triggerType: 'event',
        dag: {
          steps: [
            {
              id: 'step_1_delay',
              name: 'Prep Delay',
              type: 'delay',
              dependsOn: [],
              config: { delayMs: 5 },
            },
            {
              id: 'step_2_calendar',
              name: 'Check Slots',
              type: 'tool_execution',
              dependsOn: ['step_1_delay'],
              config: {
                toolName: 'calendar_check_availability',
                params: { date: '${context.targetDate}' },
              },
            },
          ],
        },
        isActive: true,
        version: '1.0.0',
      },
    });

    expect(createRes.statusCode).toBe(201);
    const createdWf = JSON.parse(createRes.body);
    expect(createdWf.slug).toBe('booking_orchestration_flow');

    // 2. Trigger workflow
    const triggerRes = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/booking_orchestration_flow/trigger',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        context: { targetDate: '2026-08-30' },
      },
    });

    expect(triggerRes.statusCode).toBe(200);
    const execution = JSON.parse(triggerRes.body);
    expect(execution.status).toBe('completed');
    const stepResults = JSON.parse(execution.step_results_json);
    expect(stepResults.step_1_delay.status).toBe('completed');
    expect(stepResults.step_2_calendar.status).toBe('completed');

    // 3. Query execution details
    const execDetailsRes = await app.inject({
      method: 'GET',
      url: `/api/v1/workflows/executions/${execution.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(execDetailsRes.statusCode).toBe(200);
    const execDetails = JSON.parse(execDetailsRes.body);
    expect(execDetails.id).toBe(execution.id);
  });

  it('should handle human approval lifecycle via REST API', async () => {
    // 1. Create approval workflow
    await app.inject({
      method: 'POST',
      url: '/api/v1/workflows',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        slug: 'high_value_refund_flow',
        name: 'High Value Refund Flow',
        description: 'Requires human approval for refunds',
        dag: {
          steps: [
            {
              id: 'approval_step',
              name: 'Manager Approval Step',
              type: 'human_approval',
              dependsOn: [],
              config: {
                title: 'Approve $500 Refund',
                description: 'Customer refund approval',
                requiredRole: 'admin',
              },
            },
            {
              id: 'post_approval_delay',
              name: 'Post Refund Action',
              type: 'delay',
              dependsOn: ['approval_step'],
              config: { delayMs: 5 },
            },
          ],
        },
      },
    });

    // 2. Trigger workflow (will suspend)
    const triggerRes = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/high_value_refund_flow/trigger',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { context: { amount: 500 } },
    });

    expect(triggerRes.statusCode).toBe(200);
    const execution = JSON.parse(triggerRes.body);
    expect(execution.status).toBe('waiting_for_approval');

    // 3. List pending approvals
    const approvalsRes = await app.inject({
      method: 'GET',
      url: '/api/v1/workflows/approvals',
      headers: { authorization: `Bearer ${adminToken}` },
    });

    expect(approvalsRes.statusCode).toBe(200);
    const approvalsBody = JSON.parse(approvalsRes.body);
    expect(approvalsBody.total).toBeGreaterThanOrEqual(1);

    // 4. Decide approval: approve
    const decideRes = await app.inject({
      method: 'POST',
      url: '/api/v1/workflows/approvals/decide',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        executionId: execution.id,
        stepId: 'approval_step',
        decision: 'approved',
        notes: 'Approved in executive meeting',
      },
    });

    expect(decideRes.statusCode).toBe(200);
    const resumedExecution = JSON.parse(decideRes.body);
    expect(resumedExecution.status).toBe('completed');
  });
});
