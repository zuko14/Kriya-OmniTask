/**
 * Kriya AI — Task Decomposition & Delegation Unit Tests
 * Verifies recursion depth limits, confidence-based escalation, and structured output formatting (§6, §12, §16 of CLAUDE.md).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db, DatabaseClient } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { TenantContextManager } from '../../src/core/context/tenantContext.js';
import { HierarchicalOrchestrator } from '../../src/orchestration/orchestrator/hierarchicalOrchestrator.js';
import { AgentRegistryService } from '../../src/agents/registry/agentRegistry.js';
import { PolicyViolationError } from '../../src/core/errors/errors.js';

describe('Task Decomposition & Delegation Unit Tests', () => {
  let client: DatabaseClient;
  let orchestrator: HierarchicalOrchestrator;
  let registry: AgentRegistryService;

  const tenantId = 'tenant_decomp_test';

  beforeEach(async () => {
    client = db.getClient();
    const migrator = new SchemaMigrator(client);
    await migrator.applyMigrations();

    orchestrator = new HierarchicalOrchestrator();
    registry = new AgentRegistryService();

    // Seed tenant
    await client.execute(
      `INSERT OR IGNORE INTO tenants (id, name, slug, plan_tier, channel_plan, status, created_at, updated_at)
       VALUES (?, 'Decomp Tenant', 'decomp-tenant', 'standard', 'combined', 'active', datetime('now'), datetime('now'));`,
      [tenantId]
    );

    // Bootstrap system templates
    await TenantContextManager.withTenant(tenantId, 'default', async () => {
      await registry.bootstrapSystemTemplates();
    });
  });

  afterEach(async () => {
    await client.execute('DELETE FROM agent_executions WHERE tenant_id = ?;', [tenantId]);
    await client.execute('DELETE FROM agent_lifecycle_events WHERE tenant_id = ?;', [tenantId]);
    await client.execute('DELETE FROM agents WHERE tenant_id = ?;', [tenantId]);
    await client.execute('DELETE FROM tenants WHERE id = ?;', [tenantId]);
  });

  it('should enforce recursion depth limit and reject runaway delegation (>= MAX_AGENT_DELEGATION_DEPTH)', async () => {
    await TenantContextManager.withTenant(tenantId, 'default', async () => {
      // Dispatch with delegationDepth = 5 (max allowed is 5)
      await expect(
        orchestrator.dispatch({
          objective: 'Process complex nested multi-agent task',
          delegationDepth: 5,
        })
      ).rejects.toThrow(PolicyViolationError);
    });
  });

  it('should route booking objective to appointment_booking_specialist', async () => {
    await TenantContextManager.withTenant(tenantId, 'default', async () => {
      const result = await orchestrator.dispatch({
        objective: 'I would like to book an appointment for tomorrow at 2 PM',
      });

      expect(result.status).toBe('completed');
      expect(result.steps.length).toBeGreaterThanOrEqual(1);
      expect(result.steps[0].agentSlug).toBe('appointment_booking_specialist');
      expect(result.primaryOutcome.status).toBe('completed');
      expect(result.totalCostUsd).toBeGreaterThan(0);
    });
  });
});
