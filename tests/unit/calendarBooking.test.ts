/**
 * Xylarc AI — Calendar Booking Specialist Unit Tests
 * Verifies slot availability query, appointment scheduling, and timeline logging (§24 of CLAUDE.md).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db, DatabaseClient } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { TenantContextManager } from '../../src/core/context/tenantContext.js';
import { CalendarBookingSpecialist } from '../../src/workforce/specialists/calendarBookingSpecialist.js';
import { CustomerRepository } from '../../src/customer360/repositories/customerRepository.js';
import { TimelineRepository } from '../../src/customer360/repositories/timelineRepository.js';

describe('Calendar Booking Specialist Unit Tests', () => {
  let client: DatabaseClient;
  let customerRepo: CustomerRepository;
  let timelineRepo: TimelineRepository;
  let specialist: CalendarBookingSpecialist;

  const tenantId = 'tenant_booking_unit_test';

  beforeEach(async () => {
    client = db.getClient();
    const migrator = new SchemaMigrator(client);
    await migrator.applyMigrations();

    customerRepo = new CustomerRepository(client);
    timelineRepo = new TimelineRepository(client);
    specialist = new CalendarBookingSpecialist(customerRepo, timelineRepo);

    // Seed tenant
    await client.execute(
      `INSERT OR IGNORE INTO tenants (id, name, slug, plan_tier, channel_plan, status, created_at, updated_at)
       VALUES (?, 'Booking Tenant', 'booking-tenant', 'standard', 'combined', 'active', datetime('now'), datetime('now'));`,
      [tenantId]
    );
  });

  afterEach(async () => {
    await client.execute('DELETE FROM customer_timeline_events WHERE tenant_id = ?;', [tenantId]);
    await client.execute('DELETE FROM customers WHERE tenant_id = ?;', [tenantId]);
    await client.execute('DELETE FROM tenants WHERE id = ?;', [tenantId]);
  });

  it('should propose available slots when no specific time slot is chosen', async () => {
    await TenantContextManager.withTenant(tenantId, 'default', async () => {
      const result = await specialist.bookOrPropose({
        phone: '+919988112233',
        preferredDate: '2026-08-25',
      });

      expect(result.bookingStatus).toBe('slots_proposed');
      expect(result.availableAlternativeSlots).toBeDefined();
      expect(result.availableAlternativeSlots!.length).toBeGreaterThan(0);

      // Verify timeline event
      const timeline = await timelineRepo.listByCustomer(result.customerId);
      expect(timeline.some((e) => e.event_type === 'slots_proposed')).toBe(true);
    });
  });

  it('should confirm appointment when preferred time is matched', async () => {
    await TenantContextManager.withTenant(tenantId, 'default', async () => {
      const result = await specialist.bookOrPropose({
        phone: '+919988112233',
        preferredDate: '2026-08-25',
        preferredTimeSlot: '10:30',
        serviceName: 'Enterprise AI Demo',
      });

      expect(result.bookingStatus).toBe('confirmed');
      expect(result.confirmedSlot).toBeDefined();
      expect(result.confirmedSlot!.bookingReference).toBeDefined();
      expect(result.confirmedSlot!.startTime).toContain('10:30');

      // Verify customer stage promoted to opportunity
      const customer = await customerRepo.findById(result.customerId);
      expect(customer!.lifecycle_stage).toBe('opportunity');

      // Verify timeline event
      const timeline = await timelineRepo.listByCustomer(result.customerId);
      expect(timeline.some((e) => e.event_type === 'appointment_scheduled')).toBe(true);
    });
  });
});
