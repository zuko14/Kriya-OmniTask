/**
 * Xylarc AI — Adversarial Customer Lifecycle Workforce Isolation Security Tests
 * Verifies cross-tenant boundaries for lead qualification, bookings, support, and retention operations (§23-§28 of CLAUDE.md).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/api/server.js';
import { db, DatabaseClient } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { JwtService } from '../../src/security/auth/jwt.js';
import { TenantContextManager } from '../../src/core/context/tenantContext.js';
import { CustomerRepository } from '../../src/customer360/repositories/customerRepository.js';

describe('Adversarial Customer Lifecycle Workforce Isolation Security Tests', () => {
  let app: FastifyInstance;
  let client: DatabaseClient;

  const tenantA = 'tenant_workforce_sec_a';
  const tenantB = 'tenant_workforce_sec_b';
  let tokenA: string;
  let tokenB: string;
  let customerIdA: string;

  beforeEach(async () => {
    client = db.getClient();
    const migrator = new SchemaMigrator(client);
    await migrator.applyMigrations();

    app = await buildServer();
    await app.ready();

    // Seed Tenant A & Tenant B
    await client.execute(
      `INSERT OR IGNORE INTO tenants (id, name, slug, plan_tier, channel_plan, status, created_at, updated_at) VALUES
       (?, 'Tenant A', 'tenant-a-wf-sec', 'standard', 'combined', 'active', datetime('now'), datetime('now')),
       (?, 'Tenant B', 'tenant-b-wf-sec', 'standard', 'combined', 'active', datetime('now'), datetime('now'));`,
      [tenantA, tenantB]
    );

    tokenA = JwtService.sign({
      userId: 'user-a',
      tenantId: tenantA,
      organizationId: 'org-a',
      roles: ['admin', 'owner'],
      email: 'user-a@workforce-sec.com',
    });

    tokenB = JwtService.sign({
      userId: 'user-b',
      tenantId: tenantB,
      organizationId: 'org-b',
      roles: ['admin', 'owner'],
      email: 'user-b@workforce-sec.com',
    });

    // Seed customer in Tenant A
    await TenantContextManager.withTenant(tenantA, 'org-a', async () => {
      const custRepo = new CustomerRepository(client);
      const cust = await custRepo.createCustomer({
        name: 'Confidential Enterprise Client',
        phone: '+919988112233',
        lifecycle_stage: 'lead',
      });
      customerIdA = cust.id;
    });
  });

  afterEach(async () => {
    await app.close();
    await client.execute('DELETE FROM customer_timeline_events WHERE tenant_id IN (?, ?);', [tenantA, tenantB]);
    await client.execute('DELETE FROM customer_consents WHERE tenant_id IN (?, ?);', [tenantA, tenantB]);
    await client.execute('DELETE FROM customers WHERE tenant_id IN (?, ?);', [tenantA, tenantB]);
    await client.execute('DELETE FROM tenants WHERE id IN (?, ?);', [tenantA, tenantB]);
  });

  it('should prevent Tenant B from transitioning Tenant A customer lifecycle stage', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/workforce/transition-stage',
      headers: { authorization: `Bearer ${tokenB}` },
      payload: {
        customerId: customerIdA,
        stage: 'customer',
        reason: 'Unauthorized hijack attempt',
      },
    });

    // Should return 404 because customerIdA is invisible in Tenant B context
    expect(res.statusCode).toBe(404);

    // Verify Tenant A customer remains in original state
    await TenantContextManager.withTenant(tenantA, 'org-a', async () => {
      const custRepo = new CustomerRepository(client);
      const cust = await custRepo.findById(customerIdA);
      expect(cust!.lifecycle_stage).toBe('lead');
    });
  });

  it('should prevent Tenant B from triggering win-back offer for Tenant A customer', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/workforce/trigger-reactivation',
      headers: { authorization: `Bearer ${tokenB}` },
      payload: {
        customerId: customerIdA,
        offeredDiscountPercent: 15,
        channel: 'whatsapp',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.eligible).toBe(false);
    expect(body.ineligibilityReason).toContain('not found');
  });
});
