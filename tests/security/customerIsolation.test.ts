/**
 * Xylarc AI — Adversarial Multi-Tenant Customer Isolation Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteDatabaseClient, db } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { TenantContextManager } from '../../src/core/context/tenantContext.js';
import { TenantRepository } from '../../src/storage/repositories/tenantRepository.js';
import { UserRepository } from '../../src/storage/repositories/userRepository.js';
import { CustomerRepository } from '../../src/customer360/repositories/customerRepository.js';
import { buildServer } from '../../src/api/server.js';
import { JwtService } from '../../src/security/auth/jwt.js';
import { FastifyInstance } from 'fastify';

describe('Adversarial Multi-Tenant Customer 360 Isolation', () => {
  let server: FastifyInstance;
  let client: SQLiteDatabaseClient;
  let tenantAId: string;
  let tenantBId: string;
  let tokenA: string;
  let tokenB: string;
  let customerAId: string;

  beforeEach(async () => {
    client = new SQLiteDatabaseClient(':memory:');
    db.setClientForTesting(client);

    const migrator = new SchemaMigrator(client);
    await migrator.applyMigrations();

    server = await buildServer();
    await server.ready();

    const tenantRepo = new TenantRepository(client);
    const userRepo = new UserRepository(client);
    const customerRepo = new CustomerRepository(client);

    // Create Tenant A
    const tenantA = await tenantRepo.create({
      name: 'Tenant Alpha',
      slug: 'tenant-alpha',
      plan_tier: 'pro',
      channel_plan: 'combined',
    });
    tenantAId = tenantA.id;

    await TenantContextManager.withTenant(tenantAId, 'default', async () => {
      const userA = await userRepo.createWithPassword({
        email: 'owner@alpha.com',
        password: 'PasswordAlpha123!',
        full_name: 'Alpha Owner',
      });
      await userRepo.assignRoleByName(userA.id, 'owner');

      tokenA = JwtService.signToken({
        userId: userA.id,
        tenantId: tenantAId,
        roles: ['owner'],
        email: userA.email,
      });

      const customerA = await customerRepo.create({
        full_name: 'Alpha Confidential Customer',
        primary_email: 'secret@alpha-client.com',
        primary_phone: '+919876543210',
        lifecycle_stage: 'customer',
        sentiment_score: 0.9,
        churn_risk_score: 0.0,
        preferred_language: 'en',
        preferred_channel: 'whatsapp',
        attributes_json: '{"deal_size": 100000}',
        status: 'active',
      });
      customerAId = customerA.id;
    });

    // Create Tenant B
    const tenantB = await tenantRepo.create({
      name: 'Tenant Beta',
      slug: 'tenant-beta',
      plan_tier: 'standard',
      channel_plan: 'whatsapp_only',
    });
    tenantBId = tenantB.id;

    await TenantContextManager.withTenant(tenantBId, 'default', async () => {
      const userB = await userRepo.createWithPassword({
        email: 'owner@beta.com',
        password: 'PasswordBeta123!',
        full_name: 'Beta Owner',
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

  it('should prevent Tenant B from viewing Tenant A customer 360 profile', async () => {
    const res = await server.inject({
      method: 'GET',
      url: `/api/v1/customers/${customerAId}`,
      headers: {
        authorization: `Bearer ${tokenB}`,
      },
    });

    expect(res.statusCode).toBe(404);
  });

  it('should prevent Tenant B search queries from matching Tenant A customer records', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/api/v1/customers?q=Confidential',
      headers: {
        authorization: `Bearer ${tokenB}`,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.total).toBe(0);
    expect(body.customers.length).toBe(0);
  });

  it('should isolate entity resolution so Tenant B cannot resolve or see Tenant A customer', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/api/v1/customers/resolve',
      headers: {
        authorization: `Bearer ${tokenB}`,
      },
      payload: {
        email: 'secret@alpha-client.com',
        source: 'beta_probe',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    // Should create a brand new isolated record for Tenant B, NOT match Tenant A's customer
    expect(body.isNew).toBe(true);
    expect(body.customer.id).not.toBe(customerAId);
  });

  it('should reject Tenant B attempts to merge or delete Tenant A customer record', async () => {
    const mergeRes = await server.inject({
      method: 'POST',
      url: `/api/v1/customers/${customerAId}/merge`,
      headers: {
        authorization: `Bearer ${tokenB}`,
      },
      payload: {
        targetCustomerId: 'non-existent-target',
        reason: 'Malicious merge probe',
      },
    });

    expect(mergeRes.statusCode).toBe(404);

    const deleteRes = await server.inject({
      method: 'DELETE',
      url: `/api/v1/customers/${customerAId}`,
      headers: {
        authorization: `Bearer ${tokenB}`,
      },
    });

    expect(deleteRes.statusCode).toBe(404);
  });
});
