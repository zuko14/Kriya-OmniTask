/**
 * Xylarc AI — Customer Support Specialist Unit Tests
 * Verifies Tier-1 issue resolution, sentiment & churn risk scoring, and human escalation (§25 of CLAUDE.md).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db, DatabaseClient } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { TenantContextManager } from '../../src/core/context/tenantContext.js';
import { CustomerSupportSpecialist } from '../../src/workforce/specialists/customerSupportSpecialist.js';
import { CustomerRepository } from '../../src/customer360/repositories/customerRepository.js';
import { TimelineRepository } from '../../src/customer360/repositories/timelineRepository.js';

describe('Customer Support Specialist Unit Tests', () => {
  let client: DatabaseClient;
  let customerRepo: CustomerRepository;
  let timelineRepo: TimelineRepository;
  let specialist: CustomerSupportSpecialist;

  const tenantId = 'tenant_support_unit_test';

  beforeEach(async () => {
    client = db.getClient();
    const migrator = new SchemaMigrator(client);
    await migrator.applyMigrations();

    customerRepo = new CustomerRepository(client);
    timelineRepo = new TimelineRepository(client);
    specialist = new CustomerSupportSpecialist(customerRepo, timelineRepo);

    // Seed tenant
    await client.execute(
      `INSERT OR IGNORE INTO tenants (id, name, slug, plan_tier, channel_plan, status, created_at, updated_at)
       VALUES (?, 'Support Tenant', 'support-tenant', 'standard', 'combined', 'active', datetime('now'), datetime('now'));`,
      [tenantId]
    );
  });

  afterEach(async () => {
    await client.execute('DELETE FROM customer_timeline_events WHERE tenant_id = ?;', [tenantId]);
    await client.execute('DELETE FROM customers WHERE tenant_id = ?;', [tenantId]);
    await client.execute('DELETE FROM tenants WHERE id = ?;', [tenantId]);
  });

  it('should resolve standard support inquiry autonomously with positive sentiment', async () => {
    await TenantContextManager.withTenant(tenantId, 'default', async () => {
      const result = await specialist.handleTicket({
        phone: '+919988112233',
        ticketCategory: 'general',
        issueDescription: 'How do I invite team members to our workspace dashboard?',
        urgency: 'low',
      });

      expect(result.resolutionStatus).toBe('resolved');
      expect(result.sentimentScore).toBeGreaterThanOrEqual(0.7);
      expect(result.churnRiskScore).toBeLessThan(0.3);
      expect(result.ticketId).toBeDefined();

      // Verify timeline event
      const timeline = await timelineRepo.listByCustomer(result.customerId);
      expect(timeline.some((e) => e.event_type === 'support_ticket_resolved')).toBe(true);
    });
  });

  it('should escalate high-frustration ticket to human and update customer churn risk stage', async () => {
    await TenantContextManager.withTenant(tenantId, 'default', async () => {
      const result = await specialist.handleTicket({
        phone: '+919988112233',
        ticketCategory: 'billing',
        issueDescription: 'This is terrible service and totally broken. Cancel my subscription immediately or I will call my lawyer for fraud!',
        urgency: 'critical',
      });

      expect(result.resolutionStatus).toBe('escalated_to_human');
      expect(result.sentimentScore).toBeLessThan(0.35);
      expect(result.churnRiskScore).toBeGreaterThanOrEqual(0.6);
      expect(result.escalationReason).toBeDefined();

      // Verify Customer 360 database record updated to churn_risk
      const customer = await customerRepo.findById(result.customerId);
      expect(customer!.lifecycle_stage).toBe('churn_risk');
      expect(customer!.churn_risk_score).toBeGreaterThanOrEqual(0.6);

      // Verify timeline event
      const timeline = await timelineRepo.listByCustomer(result.customerId);
      expect(timeline.some((e) => e.event_type === 'support_ticket_escalated')).toBe(true);
    });
  });
});
