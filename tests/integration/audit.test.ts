import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteDatabaseClient, db } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { AuditLogger } from '../../src/security/audit/auditLogger.js';
import { TenantContextManager } from '../../src/core/context/tenantContext.js';

describe('Audit Logger Integration', () => {
  let client: SQLiteDatabaseClient;
  let audit: AuditLogger;

  beforeEach(async () => {
    client = new SQLiteDatabaseClient(':memory:');
    db.setClientForTesting(client);
    const migrator = new SchemaMigrator(client);
    await migrator.applyMigrations();
    audit = new AuditLogger(client);
  });

  afterEach(async () => {
    await client.close();
  });

  it('should record audit events with actor attribution and correlation ID', async () => {
    const tenantId = 't-audit-test';
    const orgId = 'org-audit-test';
    const userId = 'usr-operator-01';

    await TenantContextManager.withTenant(tenantId, orgId, async () => {
      const entry = await audit.logEvent({
        action: 'agent.deployed',
        resourceType: 'agent',
        resourceId: 'agt-sales-01',
        details: { model: 'claude-3-5-sonnet', version: '1.2.0' },
        ipAddress: '192.168.1.100',
      });

      expect(entry).not.toBeNull();
      expect(entry?.tenant_id).toBe(tenantId);
      expect(entry?.organization_id).toBe(orgId);
      expect(entry?.user_id).toBe(userId);
      expect(entry?.correlation_id).toBeDefined();

      const logs = await audit.getLogsForTenant();
      expect(logs.length).toBe(1);
      expect(logs[0].action).toBe('agent.deployed');
      expect(JSON.parse(logs[0].details_json).model).toBe('claude-3-5-sonnet');
    }, { userId });
  });
});
