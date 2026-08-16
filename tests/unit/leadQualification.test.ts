/**
 * Xylarc AI — Lead Qualification Specialist Unit Tests
 * Verifies BANT lead scoring, tier assignment, and lifecycle stage promotion (§23 of CLAUDE.md).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db, DatabaseClient } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { TenantContextManager } from '../../src/core/context/tenantContext.js';
import { LeadQualificationSpecialist } from '../../src/workforce/specialists/leadQualificationSpecialist.js';
import { CustomerRepository } from '../../src/customer360/repositories/customerRepository.js';
import { TimelineRepository } from '../../src/customer360/repositories/timelineRepository.js';

describe('Lead Qualification Specialist Unit Tests', () => {
  let client: DatabaseClient;
  let customerRepo: CustomerRepository;
  let timelineRepo: TimelineRepository;
  let specialist: LeadQualificationSpecialist;

  const tenantId = 'tenant_lead_qual_test';

  beforeEach(async () => {
    client = db.getClient();
    const migrator = new SchemaMigrator(client);
    await migrator.applyMigrations();

    customerRepo = new CustomerRepository(client);
    timelineRepo = new TimelineRepository(client);
    specialist = new LeadQualificationSpecialist(customerRepo, timelineRepo);

    // Seed tenant
    await client.execute(
      `INSERT OR IGNORE INTO tenants (id, name, slug, plan_tier, channel_plan, status, created_at, updated_at)
       VALUES (?, 'Lead Qual Tenant', 'lead-qual-tenant', 'standard', 'combined', 'active', datetime('now'), datetime('now'));`,
      [tenantId]
    );
  });

  afterEach(async () => {
    await client.execute('DELETE FROM customer_timeline_events WHERE tenant_id = ?;', [tenantId]);
    await client.execute('DELETE FROM customers WHERE tenant_id = ?;', [tenantId]);
    await client.execute('DELETE FROM tenants WHERE id = ?;', [tenantId]);
  });

  it('should qualify high-BANT commercial lead as sales_qualified and promote to qualified stage', async () => {
    await TenantContextManager.withTenant(tenantId, 'default', async () => {
      const result = await specialist.qualify({
        phone: '+919988112233',
        email: 'vp@enterprisecorp.com',
        inboundMessage: 'We need enterprise pricing and a demo for our 500-person sales team.',
        bant: {
          budgetUsd: 25000,
          hasAuthority: true,
          identifiedNeed: 'Urgent enterprise workforce automation',
          timeframeMonths: 1,
        },
      });

      expect(result.leadScore).toBeGreaterThanOrEqual(75);
      expect(result.isQualified).toBe(true);
      expect(result.qualificationTier).toBe('sales_qualified');
      expect(result.lifecycleStageUpdatedTo).toBe('qualified');

      // Verify Customer 360 database record
      const customer = await customerRepo.findById(result.customerId);
      expect(customer).not.toBeNull();
      expect(customer!.lifecycle_stage).toBe('qualified');

      // Verify Timeline event
      const timeline = await timelineRepo.listByCustomer(result.customerId);
      expect(timeline.some((e) => e.event_type === 'lead_qualified')).toBe(true);
    });
  });

  it('should qualify medium-intent lead as marketing_qualified and promote to prospect stage', async () => {
    await TenantContextManager.withTenant(tenantId, 'default', async () => {
      const result = await specialist.qualify({
        phone: '+919988223344',
        inboundMessage: 'Can you share product features and case studies?',
        bant: {
          budgetUsd: 3000,
          timeframeMonths: 3,
        },
      });

      expect(result.leadScore).toBeGreaterThanOrEqual(50);
      expect(result.leadScore).toBeLessThan(75);
      expect(result.qualificationTier).toBe('marketing_qualified');
      expect(result.lifecycleStageUpdatedTo).toBe('prospect');
    });
  });

  it('should classify low-intent lead as unqualified and retain lead stage', async () => {
    await TenantContextManager.withTenant(tenantId, 'default', async () => {
      const result = await specialist.qualify({
        phone: '+919988334455',
        inboundMessage: 'hi',
        bant: {
          budgetUsd: 0,
          hasAuthority: false,
          timeframeMonths: 12,
        },
      });

      expect(result.leadScore).toBeLessThan(25);
      expect(result.isQualified).toBe(false);
      expect(result.qualificationTier).toBe('unqualified');
      expect(result.lifecycleStageUpdatedTo).toBe('lead');
    });
  });
});
