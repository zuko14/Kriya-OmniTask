/**
 * Xylarc AI — Human Approval Step Unit Tests
 * Verifies workflow execution suspension, resume on approval, and abort on rejection (§15, §37 of CLAUDE.md).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db, DatabaseClient } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { TenantContextManager } from '../../src/core/context/tenantContext.js';
import { DAGExecutor } from '../../src/workflows/engine/dagExecutor.js';
import {
  WorkflowExecutionRepository,
  WorkflowApprovalRequestRepository,
} from '../../src/workflows/repositories/workflowRepository.js';
import { DAGDefinition } from '../../src/workflows/types/workflowTypes.js';

describe('Human Approval Step Unit Tests', () => {
  let client: DatabaseClient;
  let execRepo: WorkflowExecutionRepository;
  let approvalRepo: WorkflowApprovalRequestRepository;
  let executor: DAGExecutor;

  const tenantId = 'tenant_approval_unit_test';
  const workflowId = 'wf-approval-flow-id';

  const approvalDAG: DAGDefinition = {
    steps: [
      {
        id: 'step_initial_prep',
        name: 'Initial Preparation',
        type: 'delay',
        dependsOn: [],
        config: { delayMs: 5 },
      },
      {
        id: 'step_manager_approval',
        name: 'Manager Approval Gate',
        type: 'human_approval',
        dependsOn: ['step_initial_prep'],
        config: {
          title: 'Approve $5,000 High-Value Contract',
          description: 'Requires executive authorization before dispatching.',
          requiredRole: 'admin',
        },
      },
      {
        id: 'step_post_approval_action',
        name: 'Post-Approval Calendar Confirmation',
        type: 'delay',
        dependsOn: ['step_manager_approval'],
        config: { delayMs: 5 },
      },
    ],
  };

  beforeEach(async () => {
    client = db.getClient();
    const migrator = new SchemaMigrator(client);
    await migrator.applyMigrations();

    execRepo = new WorkflowExecutionRepository(client);
    approvalRepo = new WorkflowApprovalRequestRepository(client);
    executor = new DAGExecutor(execRepo, approvalRepo);

    // Seed tenant & workflow definition
    await client.execute(
      `INSERT OR IGNORE INTO tenants (id, name, slug, plan_tier, channel_plan, status, created_at, updated_at)
       VALUES (?, 'Approval Tenant', 'approval-tenant', 'standard', 'combined', 'active', datetime('now'), datetime('now'));`,
      [tenantId]
    );

    await client.execute(
      `INSERT OR IGNORE INTO workflow_definitions (id, tenant_id, slug, name, description, trigger_type, dag_json, is_active, version, created_at, updated_at)
       VALUES (?, ?, 'approval-flow', 'Approval Flow', 'Desc', 'manual', ?, 1, '1.0.0', datetime('now'), datetime('now'));`,
      [workflowId, tenantId, JSON.stringify(approvalDAG)]
    );
  });

  afterEach(async () => {
    await client.execute('DELETE FROM workflow_approval_requests WHERE tenant_id = ?;', [tenantId]);
    await client.execute('DELETE FROM workflow_executions WHERE tenant_id = ?;', [tenantId]);
    await client.execute('DELETE FROM workflow_definitions WHERE tenant_id = ?;', [tenantId]);
    await client.execute('DELETE FROM tenants WHERE id = ?;', [tenantId]);
  });

  it('should suspend execution at human_approval step into waiting_for_approval state', async () => {
    await TenantContextManager.withTenant(tenantId, 'default', async () => {
      const execution = await execRepo.createExecution({
        workflowId,
        contextData: { dealValue: 5000 },
      });

      const suspended = await executor.executeDAG(execution, approvalDAG);

      expect(suspended.status).toBe('waiting_for_approval');
      expect(suspended.current_step_id).toBe('step_manager_approval');

      // Verify approval request was recorded in DB
      const pending = await approvalRepo.findPending(execution.id, 'step_manager_approval');
      expect(pending).not.toBeNull();
      expect(pending!.required_role).toBe('admin');
    });
  });

  it('should resume and complete pipeline when human approves the step', async () => {
    await TenantContextManager.withTenant(tenantId, 'default', async () => {
      const execution = await execRepo.createExecution({
        workflowId,
        contextData: { dealValue: 5000 },
      });

      // 1. Initial suspension
      await executor.executeDAG(execution, approvalDAG);

      // 2. Human approves step
      const resumed = await executor.resumeAfterApproval(
        execution.id,
        'step_manager_approval',
        'approved',
        'admin_alice',
        'Authorized by Director Alice'
      );

      expect(resumed.status).toBe('completed');
      const stepResults = JSON.parse(resumed.step_results_json);
      expect(stepResults.step_manager_approval.status).toBe('completed');
      expect(stepResults.step_post_approval_action.status).toBe('completed');
    });
  });

  it('should abort pipeline and mark execution rejected when human rejects the step', async () => {
    await TenantContextManager.withTenant(tenantId, 'default', async () => {
      const execution = await execRepo.createExecution({
        workflowId,
        contextData: { dealValue: 5000 },
      });

      // 1. Initial suspension
      await executor.executeDAG(execution, approvalDAG);

      // 2. Human rejects step
      const rejected = await executor.resumeAfterApproval(
        execution.id,
        'step_manager_approval',
        'rejected',
        'manager_bob',
        'Discount exceeds acceptable limit'
      );

      expect(rejected.status).toBe('rejected');
      const stepResults = JSON.parse(rejected.step_results_json);
      expect(stepResults.step_manager_approval.status).toBe('failed');
      expect(stepResults.step_post_approval_action).toBeUndefined();
    });
  });
});
