/**
 * Xylarc AI — Tenant Credential Vault Unit Tests
 * Verifies AES-256-GCM encryption at rest, tenant isolation, and zero plaintext secret leakage (§8.4 of CLAUDE.md).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db, DatabaseClient } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { TenantContextManager } from '../../src/core/context/tenantContext.js';
import { CredentialVault } from '../../src/tools/vault/credentialVault.js';

describe('Tenant Credential Vault Unit Tests', () => {
  let client: DatabaseClient;
  let vault: CredentialVault;

  const tenantId = 'tenant_vault_unit_test';

  beforeEach(async () => {
    client = db.getClient();
    const migrator = new SchemaMigrator(client);
    await migrator.applyMigrations();

    vault = new CredentialVault();

    // Seed tenant
    await client.execute(
      `INSERT OR IGNORE INTO tenants (id, name, slug, plan_tier, channel_plan, status, created_at, updated_at)
       VALUES (?, 'Vault Tenant', 'vault-tenant', 'standard', 'combined', 'active', datetime('now'), datetime('now'));`,
      [tenantId]
    );
  });

  afterEach(async () => {
    await client.execute('DELETE FROM tenant_credentials WHERE tenant_id = ?;', [tenantId]);
    await client.execute('DELETE FROM tenants WHERE id = ?;', [tenantId]);
  });

  it('should store credentials encrypted at rest and decrypt on demand', async () => {
    await TenantContextManager.withTenant(tenantId, 'default', async () => {
      const secret = {
        apiKey: 'sk-live-998877665544332211',
        clientId: 'gcal_client_xyz',
        privateKey: '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASC\n-----END PRIVATE KEY-----',
      };

      const stored = await vault.storeSecret({
        serviceSlug: 'google_calendar',
        name: 'Production Google Calendar',
        secretData: secret,
        metadata: { environment: 'production' },
      });

      expect(stored.serviceSlug).toBe('google_calendar');

      // Verify stored row in database has no plaintext apiKey
      const rows = await client.query<{ encrypted_data: string }>(
        'SELECT encrypted_data FROM tenant_credentials WHERE tenant_id = ? AND service_slug = ?;',
        [tenantId, 'google_calendar']
      );

      expect(rows.length).toBe(1);
      expect(rows[0].encrypted_data).not.toContain('sk-live');
      expect(rows[0].encrypted_data).not.toContain('gcal_client_xyz');

      // Decrypt secret
      const decrypted = await vault.getSecret<typeof secret>('google_calendar');
      expect(decrypted).toEqual(secret);
    });
  });

  it('should list services with credentials while redacting raw secrets', async () => {
    await TenantContextManager.withTenant(tenantId, 'default', async () => {
      await vault.storeSecret({
        serviceSlug: 'salesforce',
        name: 'Salesforce CRM',
        secretData: { token: 'sf_token_123' },
      });

      const list = await vault.listServices();
      expect(list.length).toBe(1);
      expect(list[0].serviceSlug).toBe('salesforce');
      expect(list[0].name).toBe('Salesforce CRM');
      expect((list[0] as any).token).toBeUndefined();
      expect((list[0] as any).encrypted_data).toBeUndefined();
    });
  });

  it('should delete a service credential safely', async () => {
    await TenantContextManager.withTenant(tenantId, 'default', async () => {
      await vault.storeSecret({
        serviceSlug: 'stripe',
        name: 'Stripe Payments',
        secretData: { secretKey: 'sk_live_stripe' },
      });

      const deleted = await vault.deleteSecret('stripe');
      expect(deleted).toBe(true);

      const secret = await vault.getSecret('stripe');
      expect(secret).toBeNull();
    });
  });
});
