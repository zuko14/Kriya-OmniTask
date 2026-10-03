/**
 * Kriya AI — Agent Lifecycle State Machine Unit Tests
 * Verifies valid state transitions, pre-publish validation, and invalid transition rejections (§17 of CLAUDE.md).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db, DatabaseClient } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { TenantContextManager } from '../../src/core/context/tenantContext.js';
import { AgentRepository, AgentLifecycleEventRepository } from '../../src/agents/repositories/agentRepository.js';
import { AgentLifecycleManager } from '../../src/agents/lifecycle/agentLifecycleManager.js';
import { ConflictError } from '../../src/core/errors/errors.js';

describe('Agent Lifecycle State Machine Tests', () => {
  let client: DatabaseClient;
  let agentRepo: AgentRepository;
  let eventRepo: AgentLifecycleEventRepository;
  let lifecycleManager: AgentLifecycleManager;

  const tenantId = 'tenant_lifecycle_test';

  beforeEach(async () => {
    client = db.getClient();
    const migrator = new SchemaMigrator(client);
    await migrator.applyMigrations();

    agentRepo = new AgentRepository(client);
    eventRepo = new AgentLifecycleEventRepository(client);
    lifecycleManager = new AgentLifecycleManager(agentRepo, eventRepo);

    // Seed tenant
    await client.execute(
      `INSERT OR IGNORE INTO tenants (id, name, slug, plan_tier, channel_plan, status, created_at, updated_at)
       VALUES (?, 'Lifecycle Tenant', 'lifecycle-tenant', 'standard', 'whatsapp_only', 'active', datetime('now'), datetime('now'));`,
      [tenantId]
    );
  });

  afterEach(async () => {
    await client.execute('DELETE FROM agent_lifecycle_events WHERE tenant_id = ?;', [tenantId]);
    await client.execute('DELETE FROM agents WHERE tenant_id = ?;', [tenantId]);
  });

  it('should walk through the full valid lifecycle flow: draft -> idle -> active -> idle -> paused -> idle', async () => {
    await TenantContextManager.withTenant(tenantId, 'default', async () => {
      // 1. Create agent in draft
      const agent = await agentRepo.create({
        slug: 'lifecycle_agent_1',
        name: 'Lifecycle Agent 1',
        category: 'specialist',
        department: 'sales',
        autonomy_level: 2,
        risk_tier: 'LOW',
        status: 'draft',
        version: '1.0.0',
        is_system: 0,
        config_json: JSON.stringify({
          systemPrompt: 'You are a compliant automated assistant with sufficient system prompt length.',
          tools: [],
        }),
      });

      expect(agent.status).toBe('draft');

      // 2. Publish: draft -> idle
      const published = await lifecycleManager.transition({
        agentId: agent.id,
        action: 'publish',
        reason: 'Specification review passed',
      });
      expect(published.agent.status).toBe('idle');
      expect(published.event.transition).toBe('publish');

      // 3. Activate: idle -> active
      const activated = await lifecycleManager.transition({
        agentId: agent.id,
        action: 'activate',
        reason: 'Executing inbound task',
      });
      expect(activated.agent.status).toBe('active');

      // 4. Complete: active -> idle
      const completed = await lifecycleManager.transition({
        agentId: agent.id,
        action: 'complete_task',
        reason: 'Task execution finished',
      });
      expect(completed.agent.status).toBe('idle');

      // 5. Pause: idle -> paused
      const paused = await lifecycleManager.transition({
        agentId: agent.id,
        action: 'pause',
        reason: 'Maintenance window',
      });
      expect(paused.agent.status).toBe('paused');

      // 6. Resume: paused -> idle
      const resumed = await lifecycleManager.transition({
        agentId: agent.id,
        action: 'resume',
        reason: 'Maintenance completed',
      });
      expect(resumed.agent.status).toBe('idle');
    });
  });

  it('should trip error state from any state and recover back to idle', async () => {
    await TenantContextManager.withTenant(tenantId, 'default', async () => {
      const agent = await agentRepo.create({
        slug: 'error_agent_1',
        name: 'Error Recovery Agent',
        category: 'specialist',
        department: 'support',
        autonomy_level: 1,
        risk_tier: 'LOW',
        status: 'active',
        version: '1.0.0',
        is_system: 0,
        config_json: JSON.stringify({ systemPrompt: 'Long enough prompt for validation.' }),
      });

      // Trip error
      const errored = await lifecycleManager.transition({
        agentId: agent.id,
        action: 'trip_error',
        reason: 'Downstream integration timeout failure',
      });
      expect(errored.agent.status).toBe('error');

      // Recover
      const recovered = await lifecycleManager.transition({
        agentId: agent.id,
        action: 'recover',
        reason: 'Circuit breaker reset and health check passed',
      });
      expect(recovered.agent.status).toBe('idle');
    });
  });

  it('should reject invalid state transitions with ConflictError', async () => {
    await TenantContextManager.withTenant(tenantId, 'default', async () => {
      const agent = await agentRepo.create({
        slug: 'invalid_trans_agent',
        name: 'Invalid Trans Agent',
        category: 'specialist',
        department: 'sales',
        autonomy_level: 2,
        risk_tier: 'LOW',
        status: 'draft',
        version: '1.0.0',
        is_system: 0,
        config_json: JSON.stringify({ systemPrompt: 'Valid prompt for testing.' }),
      });

      // Cannot activate directly from draft
      await expect(
        lifecycleManager.transition({
          agentId: agent.id,
          action: 'activate',
          reason: 'Bypassing draft validation',
        })
      ).rejects.toThrow(ConflictError);

      // Cannot resume when not paused
      await expect(
        lifecycleManager.transition({
          agentId: agent.id,
          action: 'resume',
          reason: 'Premature resume',
        })
      ).rejects.toThrow(ConflictError);
    });
  });
});
