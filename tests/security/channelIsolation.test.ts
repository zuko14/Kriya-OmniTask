/**
 * Xylarc AI — Adversarial Multi-Tenant Channel Gateway Isolation Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteDatabaseClient, db } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { TenantContextManager } from '../../src/core/context/tenantContext.js';
import { TenantRepository } from '../../src/storage/repositories/tenantRepository.js';
import { UserRepository } from '../../src/storage/repositories/userRepository.js';
import { MessageRepository } from '../../src/channels/repositories/messageRepository.js';
import { ChannelRepository } from '../../src/channels/repositories/channelRepository.js';
import { buildServer } from '../../src/api/server.js';
import { JwtService } from '../../src/security/auth/jwt.js';
import { FastifyInstance } from 'fastify';

describe('Adversarial Multi-Tenant Channel Gateway Isolation', () => {
  let server: FastifyInstance;
  let client: SQLiteDatabaseClient;
  let tenantAId: string;
  let tenantBId: string;
  let tokenA: string;
  let tokenB: string;
  let messageAId: string;

  beforeEach(async () => {
    client = new SQLiteDatabaseClient(':memory:');
    db.setClientForTesting(client);

    const migrator = new SchemaMigrator(client);
    await migrator.applyMigrations();

    server = await buildServer();
    await server.ready();

    const tenantRepo = new TenantRepository(client);
    const userRepo = new UserRepository(client);
    const messageRepo = new MessageRepository(client);
    const channelRepo = new ChannelRepository(client);

    // Create Tenant A
    const tenantA = await tenantRepo.create({
      name: 'Tenant Alpha Corp',
      slug: 'tenant-alpha-corp',
      plan_tier: 'enterprise',
      channel_plan: 'combined',
    });
    tenantAId = tenantA.id;

    await TenantContextManager.withTenant(tenantAId, 'default', async () => {
      const userA = await userRepo.createWithPassword({
        email: 'admin@alpha-corp.com',
        password: 'PasswordAlpha123!',
        full_name: 'Alpha Admin',
      });
      await userRepo.assignRoleByName(userA.id, 'owner');

      tokenA = JwtService.signToken({
        userId: userA.id,
        tenantId: tenantAId,
        roles: ['owner'],
        email: userA.email,
      });

      // Save Channel Config for A
      await channelRepo.saveChannelConfig({
        channelType: 'whatsapp',
        provider: 'meta_cloud_api',
        credentials: { accessToken: 'ALPHA_SECRET_TOKEN' },
      });

      // Create outbound message for A
      const msg = await messageRepo.create({
        channel: 'whatsapp',
        idempotency_key: 'alpha-msg-1',
        recipient: '+919876543210',
        message_type: 'text',
        payload_json: '{"text": "Alpha Confidential Message"}',
        status: 'sent',
        retry_count: 0,
      });
      messageAId = msg.id;
    });

    // Create Tenant B
    const tenantB = await tenantRepo.create({
      name: 'Tenant Beta Corp',
      slug: 'tenant-beta-corp',
      plan_tier: 'standard',
      channel_plan: 'whatsapp_only',
    });
    tenantBId = tenantB.id;

    await TenantContextManager.withTenant(tenantBId, 'default', async () => {
      const userB = await userRepo.createWithPassword({
        email: 'admin@beta-corp.com',
        password: 'PasswordBeta123!',
        full_name: 'Beta Admin',
      });
      await userRepo.assignRoleByName(userB.id, 'owner');

      tokenB = JwtService.signToken({
        userId: userB.id,
        tenantId: tenantBId,
        roles: ['owner'],
        email: userB.email,
      });
    });
  });

  afterEach(async () => {
    if (server) await server.close();
    if (client) await client.close();
  });

  it('should prevent Tenant B from reading Tenant A outbound message details', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/api/v1/channels/messages/${messageAId}`,
      headers: {
        authorization: `Bearer ${tokenB}`,
      },
    });

    expect(res.statusCode).toBe(404);
  });

  it('should prevent Tenant B from viewing Tenant A channel credentials or configuration', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/v1/channels/config/whatsapp',
      headers: {
        authorization: `Bearer ${tokenB}`,
      },
    });

    expect(res.statusCode).toBe(404);
  });
});
