/**
 * Xylarc AI — Customer 360 & Entity Resolution Integration Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteDatabaseClient, db } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { TenantContextManager } from '../../src/core/context/tenantContext.js';
import { TenantRepository } from '../../src/storage/repositories/tenantRepository.js';
import { OrganizationRepository } from '../../src/storage/repositories/orgRepository.js';
import { UserRepository } from '../../src/storage/repositories/userRepository.js';
import { CustomerRepository } from '../../src/customer360/repositories/customerRepository.js';
import { ConsentRepository } from '../../src/customer360/repositories/consentRepository.js';
import { EntityResolutionService } from '../../src/customer360/services/entityResolutionService.js';
import { Customer360Service } from '../../src/customer360/services/customer360Service.js';
import { buildServer } from '../../src/api/server.js';
import { JwtService } from '../../src/security/auth/jwt.js';
import { FastifyInstance } from 'fastify';

describe('Customer 360 Integration Tests', () => {
  let server: FastifyInstance;
  let client: SQLiteDatabaseClient;
  let tenantId: string;
  let authToken: string;

  beforeEach(async () => {
    client = new SQLiteDatabaseClient(':memory:');
    db.setClientForTesting(client);

    const migrator = new SchemaMigrator(client);
    await migrator.applyMigrations();

    server = await buildServer();
    await server.ready();

    // Setup Tenant & Owner User
    const tenantRepo = new TenantRepository(client);
    const orgRepo = new OrganizationRepository(client);
    const userRepo = new UserRepository(client);

    const tenant = await tenantRepo.create({
      name: 'Acme Retail Corp',
      slug: 'acme-retail',
      plan_tier: 'enterprise',
      channel_plan: 'combined',
    });
    tenantId = tenant.id;

    await TenantContextManager.withTenant(tenantId, 'default', async () => {
      const org = await orgRepo.create({
        name: 'Acme HQ',
        slug: 'acme-hq',
      });

      const user = await userRepo.createWithPassword({
        email: 'admin@acmeretail.com',
        password: 'SecureAdminPassword123!',
        full_name: 'Acme Admin',
      });

      await userRepo.assignRoleByName(user.id, 'owner');

      authToken = JwtService.signToken({
        userId: user.id,
        tenantId,
        organizationId: org.id,
        roles: ['owner'],
        email: user.email,
      });
    });
  });

  afterEach(async () => {
    if (server) await server.close();
    if (client) await client.close();
  });

  it('should create customer profile via API', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/customers',
      headers: {
        authorization: `Bearer ${authToken}`,
      },
      payload: {
        fullName: 'Rahul Sharma',
        primaryEmail: 'rahul.sharma@example.com',
        primaryPhone: '+919876543210',
        externalCrmId: 'CRM-9901',
        preferredLanguage: 'hi',
        preferredChannel: 'whatsapp',
        lifecycleStage: 'opportunity',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.customer.full_name).toBe('Rahul Sharma');
    expect(body.customer.primary_email).toBe('rahul.sharma@example.com');
    expect(body.customer.primary_phone).toBe('+919876543210');
    expect(body.customer.preferred_language).toBe('hi');
  });

  it('should deterministically resolve incoming interaction and link alias identities', async () => {
    const resolutionService = new EntityResolutionService();

    await TenantContextManager.withTenant(tenantId, 'default', async () => {
      // 1. Initial contact via Email
      const r1 = await resolutionService.resolve({
        email: 'priya.nair@example.com',
        fullName: 'Priya Nair',
        source: 'web_form',
      });

      expect(r1.isNew).toBe(true);
      expect(r1.matchType).toBe('new_profile');
      const customerId = r1.customer.id;

      // 2. Second contact via WhatsApp phone
      const r2 = await resolutionService.resolve({
        email: 'priya.nair@example.com', // Matching email
        phone: '+919123456789', // New WhatsApp phone
        whatsappId: '+919123456789',
        source: 'whatsapp_webhook',
      });

      expect(r2.isNew).toBe(false);
      expect(r2.customer.id).toBe(customerId);
      expect(r2.matchType).toBe('exact_email');

      // 3. Third contact via WhatsApp only (no email given)
      const r3 = await resolutionService.resolve({
        phone: '+919123456789',
        source: 'whatsapp_incoming_message',
      });

      expect(r3.isNew).toBe(false);
      expect(r3.customer.id).toBe(customerId);
      expect(r3.matchType).toBe('exact_whatsapp');
    });
  });

  it('should record timeline events and calculate customer 360 signals', async () => {
    const resolutionService = new EntityResolutionService();
    const customer360Service = new Customer360Service();

    await TenantContextManager.withTenant(tenantId, 'default', async () => {
      const res = await resolutionService.resolve({
        email: 'vikram.seth@example.com',
        fullName: 'Vikram Seth',
        source: 'lead_inquiry',
      });
      const customerId = res.customer.id;

      // Record interaction 1: WhatsApp inquiry
      await customer360Service.recordInteraction({
        customerId,
        channel: 'whatsapp',
        eventType: 'message.received',
        summary: 'Inquired about enterprise product pricing',
        sentimentScore: 0.8,
        lifecycleStage: 'opportunity',
        actorType: 'customer',
      });

      // Record interaction 2: Voice call
      await customer360Service.recordInteraction({
        customerId,
        channel: 'voice',
        eventType: 'call.completed',
        summary: 'AI Sales Agent conducted 12-minute product consultation',
        sentimentScore: 0.9,
        lifecycleStage: 'customer',
        actorType: 'agent',
      });

      // Fetch Customer 360 view
      const view = await customer360Service.getCustomer360(customerId);
      expect(view.profile.full_name).toBe('Vikram Seth');
      expect(view.signals.sentiment).toBe(0.9);
      expect(view.signals.lifecycleStage).toBe('customer');
      expect(view.timeline.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('should manage consent opt-ins, opt-outs, and communication permissions', async () => {
    const customer360Service = new Customer360Service();
    const consentRepo = new ConsentRepository();
    const customerRepo = new CustomerRepository();

    await TenantContextManager.withTenant(tenantId, 'default', async () => {
      const customer = await customerRepo.create({
        full_name: 'Ananya Roy',
        primary_phone: '+919988776655',
        lifecycle_stage: 'lead',
        sentiment_score: 0.0,
        churn_risk_score: 0.0,
        preferred_language: 'en',
        preferred_channel: 'whatsapp',
        attributes_json: '{}',
        status: 'active',
      });

      // Initial check - allowed
      const check1 = await customer360Service.canCommunicate(customer.id, 'whatsapp');
      expect(check1.allowed).toBe(true);

      // Customer opts out of WhatsApp marketing
      await consentRepo.setConsent({
        customerId: customer.id,
        consentType: 'whatsapp_marketing',
        status: 'revoked',
        source: 'opt_out_reply',
      });

      // Subsequent check - blocked
      const check2 = await customer360Service.canCommunicate(customer.id, 'whatsapp');
      expect(check2.allowed).toBe(false);
      expect(check2.reason).toContain('Explicit opt-out recorded');
    });
  });

  it('should merge two customer profiles with identity repointing and audit trail', async () => {
    const resolutionService = new EntityResolutionService();

    await TenantContextManager.withTenant(tenantId, 'default', async () => {
      const c1 = await resolutionService.resolve({
        email: 'profile1@example.com',
        fullName: 'Profile One',
        source: 'web_form',
      });

      const c2 = await resolutionService.resolve({
        phone: '+919000011111',
        fullName: 'Profile Two',
        source: 'phone_call',
      });

      // Merge c2 into c1
      const merged = await resolutionService.mergeCustomers({
        sourceCustomerId: c2.customer.id,
        targetCustomerId: c1.customer.id,
        reason: 'Customer verified phone and email belong to same physical entity',
      });

      expect(merged.id).toBe(c1.customer.id);

      // Resolving via c2 phone should now resolve to c1
      const rMatch = await resolutionService.resolve({
        phone: '+919000011111',
        source: 'incoming_call',
      });

      expect(rMatch.customer.id).toBe(c1.customer.id);
    });
  });

  it('should support GDPR / DPDP data export and right to be forgotten anonymization', async () => {
    const customer360Service = new Customer360Service();
    const customerRepo = new CustomerRepository();

    await TenantContextManager.withTenant(tenantId, 'default', async () => {
      const customer = await customerRepo.create({
        full_name: 'Suresh Raina',
        primary_email: 'suresh@cricket.example.com',
        primary_phone: '+919876500000',
        lifecycle_stage: 'customer',
        sentiment_score: 0.5,
        churn_risk_score: 0.1,
        preferred_language: 'hi',
        preferred_channel: 'whatsapp',
        attributes_json: '{"vip": true}',
        status: 'active',
      });

      // 1. Export Package
      const exportPkg = await customer360Service.exportCustomerData(customer.id);
      expect(exportPkg.customer.full_name).toBe('Suresh Raina');
      expect(exportPkg.exportedAt).toBeDefined();

      // 2. Anonymize / Forget
      await customer360Service.forgetCustomer(customer.id, 'User requested RTBF');

      const anonymized = await customerRepo.findById(customer.id);
      expect(anonymized?.full_name).toBe('Anonymized Customer');
      expect(anonymized?.primary_email).toBeNull();
      expect(anonymized?.primary_phone).toBeNull();
      expect(anonymized?.status).toBe('archived');
    });
  });
});
