/**
 * Kriya AI — Policy Engine Unit Tests
 * Verifies rule evaluations, composite verdicts, and policy audit logs (§14 of CLAUDE.md).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db, DatabaseClient } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { TenantContextManager } from '../../src/core/context/tenantContext.js';
import { PolicyEngine } from '../../src/policy/engine/policyEngine.js';
import { PolicyEvaluationRepository } from '../../src/policy/repositories/policyRepository.js';

describe('Policy Engine Unit Tests', () => {
  let client: DatabaseClient;
  let engine: PolicyEngine;

  const tenantId = 'tenant_policy_engine_test';

  beforeEach(async () => {
    client = db.getClient();
    const migrator = new SchemaMigrator(client);
    await migrator.applyMigrations();

    engine = new PolicyEngine();
    await engine.bootstrapDefaultSystemPolicies();

    // Seed tenant
    await client.execute(
      `INSERT OR IGNORE INTO tenants (id, name, slug, plan_tier, channel_plan, status, created_at, updated_at)
       VALUES (?, 'Policy Tenant', 'policy-tenant', 'standard', 'combined', 'active', datetime('now'), datetime('now'));`,
      [tenantId]
    );
  });

  afterEach(async () => {
    await client.execute('DELETE FROM policy_evaluations WHERE tenant_id = ?;', [tenantId]);
    await client.execute('DELETE FROM policy_rules WHERE tenant_id = ?;', [tenantId]);
    await client.execute('DELETE FROM tenants WHERE id = ?;', [tenantId]);
  });

  it('should PASS compliant business context with 0 violations', async () => {
    await TenantContextManager.withTenant(tenantId, 'default', async () => {
      const result = await engine.evaluate({
        actionType: 'financial_transaction',
        context: {
          discountPercent: 10,
          isQuietHours: false,
          hasActiveConsent: true,
          amountUsd: 45,
        },
      });

      expect(result.allowed).toBe(true);
      expect(result.verdict).toBe('PASS');
      expect(result.violations).toHaveLength(0);
    });
  });

  it('should BLOCK context violating maximum discount limit (> 20%)', async () => {
    await TenantContextManager.withTenant(tenantId, 'default', async () => {
      const result = await engine.evaluate({
        actionType: 'financial_transaction',
        context: {
          discountPercent: 35,
          hasActiveConsent: true,
        },
      });

      expect(result.allowed).toBe(false);
      expect(result.verdict).toBe('BLOCKED');
      expect(result.violations.some((v) => v.ruleSlug === 'max_discount_threshold')).toBe(true);
    });
  });

  it('should flag REQUIRE_APPROVAL for large refunds (> $100)', async () => {
    await TenantContextManager.withTenant(tenantId, 'default', async () => {
      const result = await engine.evaluate({
        actionType: 'financial_transaction',
        context: {
          amountUsd: 250,
          discountPercent: 0,
        },
      });

      expect(result.allowed).toBe(true);
      expect(result.requiresApproval).toBe(true);
      expect(result.verdict).toBe('WARN');
      expect(result.violations.some((v) => v.ruleSlug === 'large_refund_approval_gate')).toBe(true);
    });
  });

  it('should record execution in the policy evaluations audit ledger', async () => {
    await TenantContextManager.withTenant(tenantId, 'default', async () => {
      await engine.evaluate({
        actionType: 'outbound_message',
        context: {
          isQuietHours: true,
        },
        resourceId: 'msg-test-123',
      });

      const evalRepo = new PolicyEvaluationRepository(client);
      const evals = await evalRepo.listRecent(10);

      expect(evals.length).toBeGreaterThanOrEqual(1);
      expect(evals[0].evaluation_result).toBe('BLOCKED');
      expect(evals[0].action_type).toBe('outbound_message');
    });
  });
});
