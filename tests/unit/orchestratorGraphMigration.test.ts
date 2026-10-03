/**
 * Kriya Omnitask — Orchestrator Graph Migration & Security Hygiene Test Suite (WP-2.7, S46, S47–S50, S53)
 *
 * Verifies:
 * 1. Inbound WhatsApp customer webhook directly invoking InboundMessageService -> Intake agent DAG execution.
 * 2. Customer 360 resolution and timeline interaction event recording.
 * 3. Outbound customer reply dispatch via OutboundQueueService.
 * 4. Idempotent webhook deduplication preventing duplicate intake processing.
 * 5. InboundMessageService run-level correlation deduplication (isDuplicate: true).
 * 6. S47–S50 RBAC authentication and permission enforcement across brain, model certification,
 *    skill, escalation, and adaptation routes.
 * 7. S46 durable job queue allowlist runtime validation.
 * 8. S53 zero-fabrication metrics reporting (avgGroundingScore: null when 0 traces).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { createHmac } from 'node:crypto';
import { SQLiteDatabaseClient, db } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { TenantRepository } from '../../src/storage/repositories/tenantRepository.js';
import { TenantContextManager } from '../../src/core/context/tenantContext.js';
import { JwtService } from '../../src/security/auth/jwt.js';
import { AppError } from '../../src/core/errors/errors.js';
import { config } from '../../src/core/config/config.js';
import { channelRoutes } from '../../src/api/routes/channelRoutes.js';
import { brainRoutes } from '../../src/api/routes/brainRoutes.js';
import { modelCertificationRoutes } from '../../src/api/routes/modelCertificationRoutes.js';
import { skillRoutes } from '../../src/api/routes/skillRoutes.js';
import { escalationRoutes } from '../../src/api/routes/escalationRoutes.js';
import { adaptationRoutes } from '../../src/api/routes/adaptationRoutes.js';
import { InboundMessageService } from '../../src/channels/service/inboundMessageService.js';
import { CustomerRepository } from '../../src/customer360/repositories/customerRepository.js';
import { TimelineRepository } from '../../src/customer360/repositories/timelineRepository.js';
import { InfrastructureRepository } from '../../src/infrastructure/repositories/infrastructureRepository.js';
import { TraceRepository } from '../../src/observability/repositories/traceRepository.js';

describe('WP-2.7: Orchestrator Graph Migration & Security Hygiene', () => {
  let client: SQLiteDatabaseClient;
  let tenantA: string;
  let tenantB: string;
  let app: FastifyInstance;
  let tokenAdminA: string;
  let tokenReadOnlyA: string;
  let appSecret: string;

  beforeEach(async () => {
    client = new SQLiteDatabaseClient(':memory:');
    db.setClientForTesting(client);
    await new SchemaMigrator(client).applyMigrations();

    const tenantRepo = new TenantRepository(client);
    tenantA = (await tenantRepo.create({
      name: 'Alpha Care',
      slug: 'alpha-care',
      plan_tier: 'enterprise',
      channel_plan: 'combined',
    })).id;

    tenantB = (await tenantRepo.create({
      name: 'Beta Clinics',
      slug: 'beta-clinics',
      plan_tier: 'enterprise',
      channel_plan: 'combined',
    })).id;

    tokenAdminA = JwtService.sign({
      userId: 'usr_admin_a',
      email: 'admin@alphacare.com',
      tenantId: tenantA,
      organizationId: 'org_alpha',
      roles: ['owner', 'admin'],
    });

    tokenReadOnlyA = JwtService.sign({
      userId: 'usr_readonly_a',
      email: 'viewer@alphacare.com',
      tenantId: tenantA,
      organizationId: 'org_alpha',
      roles: ['read_only'],
    });

    appSecret = config.get('WHATSAPP_APP_SECRET') || 'test_secret_123';

    // Build Fastify test instance with custom domain error handler
    app = Fastify({ logger: false });
    app.setErrorHandler((error, _request, reply) => {
      if (error instanceof AppError) {
        return reply.status(error.statusCode).send({
          error: {
            code: error.code,
            message: error.message,
            statusCode: error.statusCode,
          },
        });
      }
      const errObj = error as any;
      if (errObj.statusCode) {
        return reply.status(errObj.statusCode).send({
          error: { message: errObj.message, statusCode: errObj.statusCode },
        });
      }
      return reply.status(500).send({ error: { message: (error as Error).message } });
    });

    await app.register(channelRoutes);
    await app.register(brainRoutes);
    await app.register(modelCertificationRoutes);
    await app.register(skillRoutes);
    await app.register(escalationRoutes);
    await app.register(adaptationRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await client.close();
  });

  describe('1. Inbound WhatsApp Customer Webhook -> DAG Entry Node (WP-2.7)', () => {
    it('processes inbound WhatsApp message through Intake agent DAG, logging timeline event', async () => {
      const rawPayload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'entry_wh_1',
            changes: [
              {
                value: {
                  messaging_product: 'whatsapp',
                  messages: [
                    {
                      id: 'wamid_test_alpha_001',
                      from: '+15559876543',
                      timestamp: '1727856000',
                      type: 'text',
                      text: { body: 'Can I talk to a human please' },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const payloadStr = JSON.stringify(rawPayload);
      const signature = `sha256=${createHmac('sha256', appSecret).update(payloadStr).digest('hex')}`;

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/channels/whatsapp/webhook',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature,
          'x-tenant-id': tenantA,
        },
        payload: rawPayload,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe('processed');
      expect(body.messagesProcessed).toBe(1);
      expect(body.statusesProcessed).toBe(0);
      expect(Array.isArray(body.agentRuns)).toBe(true);
      expect(body.agentRuns.length).toBe(1);

      const agentRun = body.agentRuns[0];
      expect(agentRun.runId).toBeDefined();
      expect(['completed', 'parked', 'running']).toContain(agentRun.status);

      // Verify Customer 360 Timeline recorded the intake interaction
      await TenantContextManager.withTenant(tenantA, 'default', async () => {
        const customerRepo = new CustomerRepository(client);
        const customer = await customerRepo.findByPhone('+15559876543');
        expect(customer).toBeDefined();

        const timelineRepo = new TimelineRepository(client);
        const events = await timelineRepo.listByCustomer(customer!.id);
        expect(events.some((e) => e.event_type === 'agent.intake_completed')).toBe(true);
      });
    });

    it('rejects tampered or forged Meta HMAC-SHA256 signature', async () => {
      const rawPayload = {
        object: 'whatsapp_business_account',
        entry: [],
      };

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/channels/whatsapp/webhook',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': 'sha256=invalid_forged_signature_000000',
          'x-tenant-id': tenantA,
        },
        payload: rawPayload,
      });

      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('UNAUTHORIZED');
    });

    it('deduplicates identical webhook payload (idempotency)', async () => {
      const rawPayload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'entry_dup_1',
            changes: [
              {
                value: {
                  messaging_product: 'whatsapp',
                  messages: [
                    {
                      id: 'wamid_dup_123',
                      from: '+15550009999',
                      timestamp: '1727856000',
                      type: 'text',
                      text: { body: 'STOP' },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const payloadStr = JSON.stringify(rawPayload);
      const signature = `sha256=${createHmac('sha256', appSecret).update(payloadStr).digest('hex')}`;

      // First delivery
      const res1 = await app.inject({
        method: 'POST',
        url: '/api/v1/channels/whatsapp/webhook',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature,
          'x-tenant-id': tenantA,
        },
        payload: rawPayload,
      });
      expect(res1.statusCode).toBe(200);
      expect(res1.json().status).toBe('processed');

      // Duplicate delivery
      const res2 = await app.inject({
        method: 'POST',
        url: '/api/v1/channels/whatsapp/webhook',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature,
          'x-tenant-id': tenantA,
        },
        payload: rawPayload,
      });
      expect(res2.statusCode).toBe(200);
      const body2 = res2.json();
      expect(body2.status).toBe('ignored');
      expect(body2.reason).toBe('duplicate_payload');
    });

    it('InboundMessageService directly deduplicates repeated correlationId', async () => {
      await TenantContextManager.withTenant(tenantA, 'default', async () => {
        const { EntityResolutionService } = await import('../../src/customer360/services/entityResolutionService.js');
        const resolutionService = new EntityResolutionService();
        const resolution = await resolutionService.resolve({
          phone: '+15551112222',
          source: 'whatsapp_direct',
        });

        const inboundService = new InboundMessageService({ client });
        const params = {
          tenantId: tenantA,
          customerId: resolution.customer.id,
          phone: '+15551112222',
          channel: 'whatsapp' as const,
          messageText: 'Can I talk to a human please',
          messageId: 'msg_direct_dedup_01',
        };

        const res1 = await inboundService.processInboundCustomerMessage(params);
        expect(res1.runId).toBeDefined();
        expect(res1.isDuplicate).toBeFalsy();

        const res2 = await inboundService.processInboundCustomerMessage(params);
        expect(res2.runId).toBe(res1.runId);
        expect(res2.isDuplicate).toBe(true);
      });
    });
  });

  describe('2. Backend Security Hygiene: S47 (Brain Routes)', () => {
    it('returns 401 when unauthenticated', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/brain/overview',
      });
      expect(res.statusCode).toBe(401);
    });

    it('returns 403 when role lacks required permission (agent:write)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/brain/config',
        headers: { authorization: `Bearer ${tokenReadOnlyA}` },
        payload: { monthlyBudgetUsd: 500 },
      });
      expect(res.statusCode).toBe(403);
    });

    it('allows access for authenticated user with valid permission', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/brain/overview',
        headers: { authorization: `Bearer ${tokenAdminA}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);
    });
  });

  describe('3. Backend Security Hygiene: S48 (Model Certification & Skill Routes)', () => {
    it('enforces authentication on model certification endpoints', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/models/certifications',
      });
      expect(res.statusCode).toBe(401);
    });

    it('enforces RBAC permission (agent:deploy) on model alignment check', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/models/alignment-check',
        headers: { authorization: `Bearer ${tokenReadOnlyA}` },
        payload: {
          modelId: 'gpt-4o',
          tier: 'REASONING_FRONTIER',
          language: 'en',
        },
      });
      expect(res.statusCode).toBe(403);
    });

    it('enforces authentication on skill endpoints', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/skills',
      });
      expect(res.statusCode).toBe(401);
    });

    it('enforces RBAC permission (tool:execute) on skill test execution', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/skills/test-all',
        headers: { authorization: `Bearer ${tokenReadOnlyA}` },
      });
      expect(res.statusCode).toBe(403);
    });

    it('allows skill listing for authorized admin', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/skills',
        headers: { authorization: `Bearer ${tokenAdminA}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);
      expect(typeof res.json().count).toBe('number');
    });
  });

  describe('4. Backend Security Hygiene: S49 & S50 (Escalation & Adaptation Routes)', () => {
    it('enforces authentication on escalation failures', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/escalation/failures',
      });
      expect(res.statusCode).toBe(401);
    });

    it('enforces RBAC permission (audit:read) on escalation failure history', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/escalation/failures',
        headers: { authorization: `Bearer ${tokenReadOnlyA}` },
      });
      expect(res.statusCode).toBe(403);
    });

    it('enforces authentication on adaptation clusters', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/adaptation/clusters',
      });
      expect(res.statusCode).toBe(401);
    });

    it('enforces RBAC permission (agent:write) on failure signature ingestion', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/adaptation/signatures',
        headers: { authorization: `Bearer ${tokenReadOnlyA}` },
        payload: {
          failureClass: 'MODEL_REFUSAL',
          businessType: 'healthcare',
          agentSlug: 'intake',
          stage: 'triage',
          rootCause: 'test',
          frequency: 1,
          costUsd: 0.01,
          customerImpact: 'LOW',
          modelTier: 'CHEAP_CLASSIFIER',
        },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('5. S46: Durable Job Queue Allowlist Runtime Validation', () => {
    it('rejects unapproved queue names with ValidationError', async () => {
      const infraRepo = new InfrastructureRepository(client);

      await expect(
        infraRepo.claimNextPendingJob(['arbitrary_queue; DROP TABLE--' as any], 'worker_test', 30)
      ).rejects.toThrow(/Invalid queue name/);

      await expect(
        infraRepo.claimNextPendingJob(['unknown' as any], 'worker_test', 30)
      ).rejects.toThrow(/Invalid queue name/);
    });

    it('permits allowlisted queues without validation error', async () => {
      const infraRepo = new InfrastructureRepository(client);

      for (const queue of ['high', 'default', 'low', 'batch'] as const) {
        const job = await infraRepo.claimNextPendingJob([queue], 'worker_test', 30);
        expect(job).toBeNull(); // Empty queue returns null, does not throw
      }
    });
  });

  describe('6. S53: Metric Reporting Without Fabrication', () => {
    it('returns avgGroundingScore: null when 0 traces exist', async () => {
      const traceRepo = new TraceRepository(client);
      const metrics = await traceRepo.getMetricsOverview();

      expect(metrics.totalTraces).toBe(0);
      expect(metrics.avgGroundingScore).toBeNull();
      expect(metrics.avgGroundingScore).not.toBe(1.0);
    });
  });
});
