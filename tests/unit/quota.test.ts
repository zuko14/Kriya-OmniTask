import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteDatabaseClient, db } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { TenantRepository } from '../../src/storage/repositories/tenantRepository.js';
import { QuotaService } from '../../src/control-plane/quotas/quotaService.js';
import { PolicyViolationError } from '../../src/core/errors/errors.js';

describe('Tenant Quota & Plan Enforcement', () => {
  let client: SQLiteDatabaseClient;
  let tenantRepo: TenantRepository;
  let quotaService: QuotaService;

  beforeEach(async () => {
    client = new SQLiteDatabaseClient(':memory:');
    db.setClientForTesting(client);
    const migrator = new SchemaMigrator(client);
    await migrator.applyMigrations();

    tenantRepo = new TenantRepository(client);
    quotaService = new QuotaService(tenantRepo);
  });

  afterEach(async () => {
    await client.close();
  });

  it('should resolve standard plan limits with whatsapp-only channels', async () => {
    const tenant = await tenantRepo.create({
      name: 'Standard WhatsApp Tenant',
      slug: 'std-wa',
      plan_tier: 'standard',
      channel_plan: 'whatsapp_only',
    });

    const limits = await quotaService.getEffectiveLimits(tenant.id);
    expect(limits.maxAgents).toBe(5);
    expect(limits.allowedChannels).toContain('whatsapp');
    expect(limits.allowedChannels).not.toContain('voice');

    // WhatsApp access passes
    await expect(quotaService.assertChannelAccess(tenant.id, 'whatsapp')).resolves.toBeUndefined();

    // Voice access is rejected with PolicyViolationError
    await expect(quotaService.assertChannelAccess(tenant.id, 'voice')).rejects.toThrow(PolicyViolationError);
  });

  it('should enforce agent count quotas', async () => {
    const tenant = await tenantRepo.create({
      name: 'Agent Limit Tenant',
      slug: 'agent-lim',
      plan_tier: 'standard',
    });

    // 4 existing + 1 new = 5 (allowed)
    await expect(quotaService.assertAgentQuota(tenant.id, 4, 1)).resolves.toBeUndefined();

    // 5 existing + 1 new = 6 (exceeds standard limit of 5)
    await expect(quotaService.assertAgentQuota(tenant.id, 5, 1)).rejects.toThrow(PolicyViolationError);
  });
});
