/**
 * Xylarc AI — Omnichannel Communication Gateway Integration Tests
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
import { TimelineRepository } from '../../src/customer360/repositories/timelineRepository.js';
import { OutboundQueueService } from '../../src/channels/queue/outboundQueueService.js';
import { ChannelRepository } from '../../src/channels/repositories/channelRepository.js';
import { buildServer } from '../../src/api/server.js';
import { JwtService } from '../../src/security/auth/jwt.js';
import { FastifyInstance } from 'fastify';

describe('Omnichannel Gateway Integration Tests', () => {
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

    const tenantRepo = new TenantRepository(client);
    const orgRepo = new OrganizationRepository(client);
    const userRepo = new UserRepository(client);

    const tenant = await tenantRepo.create({
      name: 'Omni Retail Corp',
      slug: 'omni-retail',
      plan_tier: 'enterprise',
      channel_plan: 'combined',
    });
    tenantId = tenant.id;

    await TenantContextManager.withTenant(tenantId, 'default', async () => {
      const org = await orgRepo.create({
        name: 'Omni HQ',
        slug: 'omni-hq',
      });

      const user = await userRepo.createWithPassword({
        email: 'ops@omniretail.com',
        password: 'Password123!Secure',
        full_name: 'Omni Ops Manager',
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

  it('should respond to Meta webhook verification challenge', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/v1/channels/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=xylarc_whatsapp_verify_token_secure_2026&hub.challenge=CHALLENGE_ACCEPTED_123',
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('CHALLENGE_ACCEPTED_123');
  });

  it('should process inbound WhatsApp webhook, resolve customer, and record timeline event', async () => {
    const mockInbound = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'WHATSAPP_ID',
          changes: [
            {
              value: {
                messaging_product: 'whatsapp',
                messages: [
                  {
                    from: '+919988776655',
                    id: 'wamid.INBOUND_MSG_999',
                    timestamp: '1723680000',
                    type: 'text',
                    text: { body: 'I need to check my booking status' },
                  },
                ],
              },
              field: 'messages',
            },
          ],
        },
      ],
    };

    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/channels/whatsapp/webhook',
      headers: {
        'x-tenant-id': tenantId,
      },
      payload: mockInbound,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('processed');
    expect(body.messagesProcessed).toBe(1);

    // Verify Customer 360 & Timeline were created in tenant
    await TenantContextManager.withTenant(tenantId, 'default', async () => {
      const customerRepo = new CustomerRepository(client);
      const timelineRepo = new TimelineRepository(client);

      const customer = await customerRepo.findByPhone('+919988776655');
      expect(customer).not.toBeNull();

      const timeline = await timelineRepo.getTimeline(customer!.id);
      expect(timeline.length).toBeGreaterThanOrEqual(1);
      const hasMessageEvent = timeline.some((e) => e.summary.includes('I need to check my booking status'));
      expect(hasMessageEvent).toBe(true);
    });
  });

  it('should enforce idempotency on outbound message submissions', async () => {
    const queueService = new OutboundQueueService();

    await TenantContextManager.withTenant(tenantId, 'default', async () => {
      const idempotencyKey = 'idem-key-unique-001';

      // First submission
      const res1 = await queueService.dispatch({
        channel: 'whatsapp',
        recipient: '+919876543210',
        idempotencyKey,
        messageType: 'text',
        payload: { text: 'Your order is confirmed' },
        isDirectResponse: true,
      });

      expect(res1.delivered).toBe(true);
      expect(res1.status).toBe('sent');

      // Duplicate submission with same idempotency key
      const res2 = await queueService.dispatch({
        channel: 'whatsapp',
        recipient: '+919876543210',
        idempotencyKey,
        messageType: 'text',
        payload: { text: 'Your order is confirmed' },
        isDirectResponse: true,
      });

      expect(res2.message.id).toBe(res1.message.id);
      expect(res2.reason).toContain('Idempotency key match');
    });
  });

  it('should block outbound dispatch when customer has opted out of channel', async () => {
    const customerRepo = new CustomerRepository(client);
    const consentRepo = new ConsentRepository(client);
    const queueService = new OutboundQueueService();

    await TenantContextManager.withTenant(tenantId, 'default', async () => {
      const customer = await customerRepo.create({
        full_name: 'Opted Out User',
        primary_phone: '+919000099999',
        lifecycle_stage: 'customer',
        sentiment_score: 0.0,
        churn_risk_score: 0.0,
        preferred_language: 'en',
        preferred_channel: 'whatsapp',
        attributes_json: '{}',
        status: 'active',
      });

      // Revoke consent
      await consentRepo.setConsent({
        customerId: customer.id,
        consentType: 'whatsapp_marketing',
        status: 'revoked',
        source: 'unsubscribe_link',
      });

      const res = await queueService.dispatch({
        customerId: customer.id,
        channel: 'whatsapp',
        recipient: '+919000099999',
        idempotencyKey: 'idem-blocked-optout-1',
        messageType: 'text',
        payload: { text: 'Special discount offer!' },
        isDirectResponse: false, // Proactive message
      });

      expect(res.delivered).toBe(false);
      expect(res.status).toBe('failed');
      expect(res.reason).toContain('Explicit opt-out recorded');
    });
  });

  it('should save and securely decrypt channel provider credentials', async () => {
    const channelRepo = new ChannelRepository(client);

    await TenantContextManager.withTenant(tenantId, 'default', async () => {
      await channelRepo.saveChannelConfig({
        channelType: 'whatsapp',
        provider: 'meta_cloud_api',
        credentials: {
          phoneNumberId: '10987654321',
          accessToken: 'EAAB_TEST_TOKEN_SECRET',
          appSecret: 'test_app_secret_123',
          webhookVerifyToken: 'test_verify_token',
        },
        settings: {
          quietHours: { enabled: true, startHour: 22, endHour: 8 },
        },
      });

      const decrypted = await channelRepo.getDecryptedCredentials<{ phoneNumberId: string; accessToken: string }>('whatsapp');
      expect(decrypted).not.toBeNull();
      expect(decrypted?.phoneNumberId).toBe('10987654321');
      expect(decrypted?.accessToken).toBe('EAAB_TEST_TOKEN_SECRET');
    });
  });
});
