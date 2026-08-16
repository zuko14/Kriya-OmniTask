/**
 * Xylarc AI — Customer Lifecycle Workforce REST Integration Tests
 * Verifies Fastify REST endpoints for Lead Qualification, Calendar Booking, Support, Reactivation, and Stage Transitions (§23-§28 of CLAUDE.md).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/api/server.js';
import { db, DatabaseClient } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { JwtService } from '../../src/security/auth/jwt.js';
import { ConsentRepository } from '../../src/customer360/repositories/consentRepository.js';
import { CustomerRepository } from '../../src/customer360/repositories/customerRepository.js';
import { TenantContextManager } from '../../src/core/context/tenantContext.js';

describe('Customer Lifecycle Workforce REST Integration Tests', () => {
  let app: FastifyInstance;
  let client: DatabaseClient;

  const tenantId = 'tenant_workforce_int_test';
  const orgId = 'org_workforce_int_test';
  let adminToken: string;

  beforeEach(async () => {
    client = db.getClient();
    const migrator = new SchemaMigrator(client);
    await migrator.applyMigrations();

    app = await buildServer();
    await app.ready();

    // Seed tenant & org
    await client.execute(
      `INSERT OR IGNORE INTO tenants (id, name, slug, plan_tier, channel_plan, status, created_at, updated_at)
       VALUES (?, 'Workforce Tenant', 'wf-workforce-tenant', 'standard', 'combined', 'active', datetime('now'), datetime('now'));`,
      [tenantId]
    );

    await client.execute(
      `INSERT OR IGNORE INTO organizations (id, tenant_id, name, slug, created_at, updated_at)
       VALUES (?, ?, 'Workforce Org', 'wf-workforce-org', datetime('now'), datetime('now'));`,
      [orgId, tenantId]
    );

    adminToken = JwtService.sign({
      userId: 'workforce-admin-user',
      tenantId,
      organizationId: orgId,
      roles: ['admin', 'owner'],
      email: 'admin@workforce-int.com',
    });
  });

  afterEach(async () => {
    await app.close();
    await client.execute('DELETE FROM customer_timeline_events WHERE tenant_id = ?;', [tenantId]);
    await client.execute('DELETE FROM customer_consents WHERE tenant_id = ?;', [tenantId]);
    await client.execute('DELETE FROM customers WHERE tenant_id = ?;', [tenantId]);
    await client.execute('DELETE FROM organizations WHERE tenant_id = ?;', [tenantId]);
    await client.execute('DELETE FROM tenants WHERE id = ?;', [tenantId]);
  });

  it('should qualify lead and promote lifecycle stage via POST /api/v1/workforce/qualify-lead', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/workforce/qualify-lead',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        phone: '+919988112233',
        email: 'lead@enterprise.com',
        inboundMessage: 'Interested in purchasing enterprise AI workforce platform with 50 agent seats.',
        bant: {
          budgetUsd: 50000,
          hasAuthority: true,
          identifiedNeed: 'Autonomous enterprise operations',
          timeframeMonths: 1,
        },
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.leadScore).toBeGreaterThanOrEqual(75);
    expect(body.qualificationTier).toBe('sales_qualified');
    expect(body.lifecycleStageUpdatedTo).toBe('qualified');
  });

  it('should book appointment via POST /api/v1/workforce/book-slot', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/workforce/book-slot',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        phone: '+919988112233',
        preferredDate: '2026-08-28',
        preferredTimeSlot: '14:00',
        serviceName: 'Technical Architecture Review',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.bookingStatus).toBe('confirmed');
    expect(body.confirmedSlot.bookingReference).toBeDefined();
  });

  it('should handle support inquiry via POST /api/v1/workforce/handle-support', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/workforce/handle-support',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        phone: '+919988112233',
        ticketCategory: 'technical',
        issueDescription: 'How do we configure WhatsApp Cloud API credentials in our tenant settings?',
        urgency: 'low',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.resolutionStatus).toBe('resolved');
    expect(body.ticketId).toBeDefined();
  });

  it('should evaluate win-back reactivation via POST /api/v1/workforce/trigger-reactivation', async () => {
    // 1. Create dormant customer with consent
    let customerId: string = '';
    await TenantContextManager.withTenant(tenantId, orgId, async () => {
      const custRepo = new CustomerRepository(client);
      const consentRepo = new ConsentRepository(client);
      const cust = await custRepo.createCustomer({
        name: 'Dormant Dan',
        phone: '+919988445566',
        lifecycle_stage: 'churn_risk',
      });
      customerId = cust.id;

      await consentRepo.recordConsent({
        customerId,
        channel: 'whatsapp',
        purpose: 'marketing',
        status: 'granted',
      });
    });

    // 2. Trigger win-back
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/workforce/trigger-reactivation',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        customerId,
        offeredDiscountPercent: 15,
        channel: 'whatsapp',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.eligible).toBe(true);
    expect(body.discountOfferedPercent).toBe(15);
  });

  it('should manually transition customer lifecycle stage via POST /api/v1/workforce/transition-stage', async () => {
    let customerId: string = '';
    await TenantContextManager.withTenant(tenantId, orgId, async () => {
      const custRepo = new CustomerRepository(client);
      const cust = await custRepo.createCustomer({
        name: 'Stage Transition User',
        phone: '+919988776655',
        lifecycle_stage: 'lead',
      });
      customerId = cust.id;
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/workforce/transition-stage',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        customerId,
        stage: 'customer',
        reason: 'Signed annual enterprise contract',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.previousStage).toBe('lead');
    expect(body.currentStage).toBe('customer');
  });
});
