/**
 * Kriya AI — Reactivation & Retention Specialist Unit Tests
 * Verifies win-back offer eligibility, consent gating, and discount policy boundaries (§26, §27 of CLAUDE.md).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db, DatabaseClient } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { TenantContextManager } from '../../src/core/context/tenantContext.js';
import { ReactivationRetentionSpecialist } from '../../src/workforce/specialists/reactivationRetentionSpecialist.js';
import { CustomerRepository } from '../../src/customer360/repositories/customerRepository.js';
import { TimelineRepository } from '../../src/customer360/repositories/timelineRepository.js';
import { ConsentRepository } from '../../src/customer360/repositories/consentRepository.js';

describe('Reactivation & Retention Specialist Unit Tests', () => {
  let client: DatabaseClient;
  let customerRepo: CustomerRepository;
  let timelineRepo: TimelineRepository;
  let consentRepo: ConsentRepository;
  let specialist: ReactivationRetentionSpecialist;

  const tenantId = 'tenant_reactivation_unit_test';
  let customerId: string;

  beforeEach(async () => {
    client = db.getClient();
    const migrator = new SchemaMigrator(client);
    await migrator.applyMigrations();

    customerRepo = new CustomerRepository(client);
    timelineRepo = new TimelineRepository(client);
    consentRepo = new ConsentRepository(client);
    specialist = new ReactivationRetentionSpecialist(customerRepo, timelineRepo, consentRepo);

    // Seed tenant
    await client.execute(
      `INSERT OR IGNORE INTO tenants (id, name, slug, plan_tier, channel_plan, status, created_at, updated_at)
       VALUES (?, 'Retention Tenant', 'retention-tenant', 'standard', 'combined', 'active', datetime('now'), datetime('now'));`,
      [tenantId]
    );

    // Seed customer
    await TenantContextManager.withTenant(tenantId, 'default', async () => {
      const cust = await customerRepo.createCustomer({
        name: 'Bob Dormant',
        phone: '+919988112233',
        lifecycle_stage: 'churn_risk',
      });
      customerId = cust.id;
    });
  });

  afterEach(async () => {
    await client.execute('DELETE FROM customer_timeline_events WHERE tenant_id = ?;', [tenantId]);
    await client.execute('DELETE FROM customer_consents WHERE tenant_id = ?;', [tenantId]);
    await client.execute('DELETE FROM customers WHERE tenant_id = ?;', [tenantId]);
    await client.execute('DELETE FROM tenants WHERE id = ?;', [tenantId]);
  });

  it('should dispatch win-back offer for eligible customer with active marketing consent', async () => {
    await TenantContextManager.withTenant(tenantId, 'default', async () => {
      // Record active opt-in consent
      await consentRepo.recordConsent({
        customerId,
        channel: 'whatsapp',
        purpose: 'marketing',
        status: 'granted',
      });

      const result = await specialist.evaluateAndOffer({
        customerId,
        offeredDiscountPercent: 15, // <= 20%
        channel: 'whatsapp',
      });

      expect(result.eligible).toBe(true);
      expect(result.discountOfferedPercent).toBe(15);
      expect(result.requiresHumanApproval).toBe(false);

      // Verify customer promoted to reactivated
      const updatedCust = await customerRepo.findById(customerId);
      expect(updatedCust!.lifecycle_stage).toBe('reactivated');

      // Verify timeline event
      const timeline = await timelineRepo.listByCustomer(customerId);
      expect(timeline.some((e) => e.event_type === 'reactivation_offer_sent')).toBe(true);
    });
  });

  it('should reject reactivation outreach if customer lacks active marketing consent', async () => {
    await TenantContextManager.withTenant(tenantId, 'default', async () => {
      const result = await specialist.evaluateAndOffer({
        customerId,
        offeredDiscountPercent: 15,
        channel: 'whatsapp',
      });

      expect(result.eligible).toBe(false);
      expect(result.ineligibilityReason).toContain('consent');
    });
  });

  it('should flag approval required if requested discount exceeds policy limit (> 20%)', async () => {
    await TenantContextManager.withTenant(tenantId, 'default', async () => {
      await consentRepo.recordConsent({
        customerId,
        channel: 'whatsapp',
        purpose: 'marketing',
        status: 'granted',
      });

      const result = await specialist.evaluateAndOffer({
        customerId,
        offeredDiscountPercent: 35, // Violates max 20% policy
        channel: 'whatsapp',
      });

      expect(result.eligible).toBe(false);
      expect(result.requiresHumanApproval).toBe(true);
      expect(result.ineligibilityReason).toContain('exceeds maximum allowable autonomous discount');
    });
  });
});
