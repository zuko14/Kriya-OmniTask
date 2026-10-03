/**
 * Kriya AI — DAG Executor Engine Unit Tests
 * Verifies topological execution, cycle detection, conditional branching, and error handling (§13 of CLAUDE.md).
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
import { ValidationError } from '../../src/core/errors/errors.js';

describe('DAG Executor Engine Unit Tests', () => {
  let client: DatabaseClient;
  let execRepo: WorkflowExecutionRepository;
  let approvalRepo: WorkflowApprovalRequestRepository;
  let executor: DAGExecutor;

  const tenantId = 'tenant_dag_unit_test';

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
       VALUES (?, 'DAG Tenant', 'dag-tenant', 'standard', 'combined', 'active', datetime('now'), datetime('now'));`,
      [tenantId]
    );

    await client.execute(
      `INSERT OR IGNORE INTO workflow_definitions (id, tenant_id, slug, name, description, trigger_type, dag_json, is_active, version, created_at, updated_at)
       VALUES ('wf-test-id', ?, 'test-flow', 'Test Flow', 'Desc', 'manual', '{}', 1, '1.0.0', datetime('now'), datetime('now'));`,
      [tenantId]
    );
  });

  afterEach(async () => {
    await client.execute('DELETE FROM workflow_approval_requests WHERE tenant_id = ?;', [tenantId]);
    await client.execute('DELETE FROM workflow_executions WHERE tenant_id = ?;', [tenantId]);
    await client.execute('DELETE FROM workflow_definitions WHERE tenant_id = ?;', [tenantId]);
    await client.execute('DELETE FROM tenants WHERE id = ?;', [tenantId]);
  });

  it('should detect cycles and invalid dependencies in DAG definitions', () => {
    // 1. Circular dependency (Cycle: step1 -> step2 -> step1)
    const cyclicDAG: DAGDefinition = {
      steps: [
        { id: 'step1', name: 'Step 1', type: 'delay', dependsOn: ['step2'], config: {} },
        { id: 'step2', name: 'Step 2', type: 'delay', dependsOn: ['step1'], config: {} },
      ],
    };

    expect(() => DAGExecutor.validateDAG(cyclicDAG)).toThrow(ValidationError);
    expect(() => DAGExecutor.validateDAG(cyclicDAG)).toThrow('circular dependency');

    // 2. Non-existent dependency
    const missingDepDAG: DAGDefinition = {
      steps: [
        { id: 'step1', name: 'Step 1', type: 'delay', dependsOn: ['non_existent_step'], config: {} },
      ],
    };

    expect(() => DAGExecutor.validateDAG(missingDepDAG)).toThrow(ValidationError);
    expect(() => DAGExecutor.validateDAG(missingDepDAG)).toThrow('non-existent');
  });

  it('should execute multi-step DAG and resolve dependent step outputs', async () => {
    await TenantContextManager.withTenant(tenantId, 'default', async () => {
      const execution = await execRepo.createExecution({
        workflowId: 'wf-test-id',
        contextData: {
          requestedDate: '2026-08-25',
        },
      });

      const dag: DAGDefinition = {
        steps: [
          {
            id: 'step_delay_1',
            name: 'Initial Delay',
            type: 'delay',
            dependsOn: [],
            config: { delayMs: 10 },
          },
          {
            id: 'step_check_slots',
            name: 'Check Calendar Availability',
            type: 'tool_execution',
            dependsOn: ['step_delay_1'],
            config: {
              toolName: 'calendar_check_availability',
              params: { date: '${context.requestedDate}' },
            },
          },
        ],
      };

      const result = await executor.executeDAG(execution, dag);

      expect(result.status).toBe('completed');
      const stepResults = JSON.parse(result.step_results_json);
      expect(stepResults.step_delay_1.status).toBe('completed');
      expect(stepResults.step_check_slots.status).toBe('completed');
      expect(stepResults.step_check_slots.output.availableSlots).toBeDefined();
    });
  });

  it('should evaluate conditional branches and skip inactive paths', async () => {
    await TenantContextManager.withTenant(tenantId, 'default', async () => {
      const execution = await execRepo.createExecution({
        workflowId: 'wf-test-id',
        contextData: {
          isHighPriority: true,
        },
      });

      const dag: DAGDefinition = {
        steps: [
          {
            id: 'step_branch',
            name: 'Priority Branch',
            type: 'conditional_branch',
            dependsOn: [],
            config: {
              condition: { field: 'isHighPriority', operator: 'EQUALS', value: true },
              ifTrueNextStepId: 'step_vip_flow',
              ifFalseNextStepId: 'step_standard_flow',
            },
          },
          {
            id: 'step_vip_flow',
            name: 'VIP Delay',
            type: 'delay',
            dependsOn: ['step_branch'],
            config: { delayMs: 5 },
          },
          {
            id: 'step_standard_flow',
            name: 'Standard Delay',
            type: 'delay',
            dependsOn: ['step_branch'],
            config: { delayMs: 5 },
          },
        ],
      };

      const result = await executor.executeDAG(execution, dag);

      expect(result.status).toBe('completed');
      const stepResults = JSON.parse(result.step_results_json);
      expect(stepResults.step_branch.status).toBe('completed');
      expect(stepResults.step_vip_flow.status).toBe('completed');
      expect(stepResults.step_standard_flow.status).toBe('skipped');
    });
  });
});
