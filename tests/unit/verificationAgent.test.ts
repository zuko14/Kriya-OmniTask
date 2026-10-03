/**
 * Kriya AI — Verification Agent & Read-Back Jobs Unit Tests (docs/kriya WP-4.6, WP-3.4)
 * Verifies async read-back polling, state verification, mismatch detection, SLA expiry,
 * automatic escalation to Attention Center, and agent charter integration.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db, SQLiteDatabaseClient } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { TenantRepository } from '../../src/storage/repositories/tenantRepository.js';
import { TenantContextManager } from '../../src/core/context/tenantContext.js';
import { VerificationJobRepository } from '../../src/attention/repositories/verificationJobRepository.js';
import { VerificationJobService, verificationTools } from '../../src/attention/service/verificationJobService.js';
import { AttentionService } from '../../src/attention/service/attentionService.js';
import { ToolRegistryService } from '../../src/tools/registry/toolRegistry.js';
import { DEFAULT_VERIFICATION_CHARTER } from '../../src/agents/phase0/verificationAgent.js';
import { buildAgentFromCharter } from '../../src/agents/charter/agentCharter.js';
import { z } from 'zod';

describe('Verification Agent & Read-Back Jobs (WP-4.6, WP-3.4)', () => {
  let client: SQLiteDatabaseClient;
  let tenantA: string;
  let tenantB: string;

  const inA = <T>(fn: () => Promise<T>) =>
    TenantContextManager.withTenant(tenantA, 'default', fn, { userId: 'ver_a', roles: ['operations_lead'] });
  const inB = <T>(fn: () => Promise<T>) =>
    TenantContextManager.withTenant(tenantB, 'default', fn, { userId: 'ver_b', roles: ['operations_lead'] });

  beforeEach(async () => {
    client = new SQLiteDatabaseClient(':memory:');
    db.setClientForTesting(client);
    await new SchemaMigrator(client).applyMigrations();

    const tenants = new TenantRepository(client);
    tenantA = (await tenants.create({ name: 'Tenant A', slug: 'ver-a', plan_tier: 'enterprise', channel_plan: 'combined' })).id;
    tenantB = (await tenants.create({ name: 'Tenant B', slug: 'ver-b', plan_tier: 'enterprise', channel_plan: 'combined' })).id;
  });

  afterEach(async () => {
    await client.close();
  });

  describe('Job Enqueue & Idempotency', () => {
    it('creates an async verification job with deadline and next check', async () => {
      await inA(async () => {
        const repo = new VerificationJobRepository(client);
        const job = await repo.createJob({
          runId: 'run-101',
          toolSlug: 'schedule_book',
          actionInput: { resourceId: 'res-1', start: '2026-10-05 10:00' },
          actionOutput: { appointmentId: 'apt-1', status: 'confirmed' },
          idempotencyKey: 'idem-101',
          deadlineMinutes: 30,
          intervalSeconds: 15,
        });

        expect(job.id).toBeDefined();
        expect(job.status).toBe('pending');
        expect(job.attempts).toBe(0);
        expect(job.max_attempts).toBe(5);
        expect(job.run_id).toBe('run-101');
        expect(job.idempotency_key).toBe('idem-101');
      });
    });

    it('deduplicates jobs by idempotency key per tenant', async () => {
      await inA(async () => {
        const repo = new VerificationJobRepository(client);
        const job1 = await repo.createJob({
          runId: 'run-102',
          toolSlug: 'schedule_book',
          actionInput: { resourceId: 'res-1' },
          actionOutput: { appointmentId: 'apt-2' },
          idempotencyKey: 'idem-dup-key',
        });

        const job2 = await repo.createJob({
          runId: 'run-102',
          toolSlug: 'schedule_book',
          actionInput: { resourceId: 'res-1' },
          actionOutput: { appointmentId: 'apt-2' },
          idempotencyKey: 'idem-dup-key',
        });

        expect(job1.id).toBe(job2.id);
      });
    });
  });

  describe('Verification Processing & Read-Back Scenarios', () => {
    it('marks job verified when target tool verify() returns verified', async () => {
      await inA(async () => {
        const registry = new ToolRegistryService();
        // Register mock external service tool with verify read-back
        registry.registerTool({
          definition: {
            slug: 'mock_payment_capture',
            name: 'Mock Payment Capture',
            description: 'Captures payment via gateway',
            category: 'payment',
            riskTier: 'HIGH',
            requiresApproval: false,
            inputSchema: { paymentId: 'string' },
            outputSchema: { captured: 'boolean' },
            isSystem: true,
          },
          inputValidator: z.object({ paymentId: z.string() }),
          handler: async (input) => ({ captured: true, paymentId: input.paymentId }),
          verify: async (input, output) => ({
            state: 'verified',
            observed: { gatewayStatus: 'succeeded', capturedAmount: 100 },
          }),
        });

        const attention = new AttentionService(client);
        const service = new VerificationJobService(client, registry, attention);

        const job = await service.createJob({
          runId: 'run-pay-1',
          toolSlug: 'mock_payment_capture',
          actionInput: { paymentId: 'pay_999' },
          actionOutput: { captured: true },
          idempotencyKey: 'idem-pay-1',
        });

        const processed = await service.processJob(job.id);
        expect(processed.status).toBe('verified');
        expect(processed.attempts).toBe(1);
        expect(processed.observed_state_json).toContain('succeeded');
      });
    });

    it('detects mismatch and escalates P1 Attention item to human center', async () => {
      await inA(async () => {
        const registry = new ToolRegistryService();
        // Tool where external system contradicts recorded output
        registry.registerTool({
          definition: {
            slug: 'mock_ehr_sync',
            name: 'Mock EHR Sync',
            description: 'Syncs record to hospital EHR',
            category: 'custom',
            riskTier: 'HIGH',
            requiresApproval: false,
            inputSchema: { patientId: 'string' },
            outputSchema: { synced: 'boolean' },
            isSystem: true,
          },
          inputValidator: z.object({ patientId: z.string() }),
          handler: async () => ({ synced: true }),
          verify: async () => ({
            state: 'mismatch',
            observed: { ehrState: 'record_not_found' },
          }),
        });

        const attention = new AttentionService(client);
        const service = new VerificationJobService(client, registry, attention);

        const job = await service.createJob({
          runId: 'run-ehr-1',
          toolSlug: 'mock_ehr_sync',
          actionInput: { patientId: 'pat_42' },
          actionOutput: { synced: true },
          idempotencyKey: 'idem-ehr-1',
        });

        const processed = await service.processJob(job.id);
        expect(processed.status).toBe('mismatch');
        expect(processed.error_message).toContain('External system state contradicts');

        // Verify that a P1 Attention Item was created
        const attentionItems = await attention.listItems({ priority: 'P1_HIGH' });
        expect(attentionItems.length).toBeGreaterThanOrEqual(1);
        const matchItem = attentionItems.find((i) => i.correlation_id === `verification:${job.id}`);
        expect(matchItem).toBeDefined();
        expect(matchItem?.source_agent_id).toBe('specialist.verification');
        expect(matchItem?.reason_category).toBe('security_anomaly');
      });
    });

    it('expires job when deadline passed and escalates to Attention center', async () => {
      await inA(async () => {
        const registry = new ToolRegistryService();
        // Tool whose status is perpetually pending
        registry.registerTool({
          definition: {
            slug: 'mock_bank_transfer',
            name: 'Mock Bank Transfer',
            description: 'Async wire transfer',
            category: 'payment',
            riskTier: 'HIGH',
            requiresApproval: false,
            inputSchema: { txId: 'string' },
            outputSchema: { queued: 'boolean' },
            isSystem: true,
          },
          inputValidator: z.object({ txId: z.string() }),
          handler: async () => ({ queued: true }),
          verify: async () => ({ state: 'pending', observed: { bankStatus: 'in_clearing' } }),
        });

        const attention = new AttentionService(client);
        const service = new VerificationJobService(client, registry, attention);

        const job = await service.createJob({
          runId: 'run-wire-1',
          toolSlug: 'mock_bank_transfer',
          actionInput: { txId: 'tx_777' },
          actionOutput: { queued: true },
          idempotencyKey: 'idem-wire-1',
          deadlineMinutes: 10,
        });

        // Advance simulated time past deadline (+ 15 minutes)
        const pastDeadline = new Date(Date.now() + 15 * 60 * 1000);
        const processed = await service.processJob(job.id, pastDeadline);

        expect(processed.status).toBe('expired');
        expect(processed.error_message).toContain('deadline expired');

        // Verify Attention item filed
        const attentionItems = await attention.listItems({ priority: 'P1_HIGH' });
        const expiredItem = attentionItems.find((i) => i.correlation_id === `verification:${job.id}`);
        expect(expiredItem).toBeDefined();
        expect(expiredItem?.reason_category).toBe('workflow_suspended');
      });
    });

    it('aggregates run verification status correctly', async () => {
      await inA(async () => {
        const registry = new ToolRegistryService();
        registry.registerTool({
          definition: {
            slug: 'mock_action_verified',
            name: 'Mock Action',
            description: 'Mock',
            category: 'custom',
            riskTier: 'LOW',
            requiresApproval: false,
            inputSchema: {},
            outputSchema: {},
            isSystem: true,
          },
          inputValidator: z.object({}),
          handler: async () => ({}),
          verify: async () => ({ state: 'verified' }),
        });

        const attention = new AttentionService(client);
        const service = new VerificationJobService(client, registry, attention);

        const job1 = await service.createJob({
          runId: 'multi-run-1',
          toolSlug: 'mock_action_verified',
          actionInput: {},
          actionOutput: {},
          idempotencyKey: 'multi-idem-1',
        });

        const job2 = await service.createJob({
          runId: 'multi-run-1',
          toolSlug: 'mock_action_verified',
          actionInput: {},
          actionOutput: {},
          idempotencyKey: 'multi-idem-2',
        });

        // Before processing: pending
        let status = await service.getRunVerificationStatus('multi-run-1');
        expect(status.allVerified).toBe(false);
        expect(status.pendingCount).toBe(2);

        // Process batch with time advanced past interval
        await service.processPendingBatch(new Date(Date.now() + 60_000));

        status = await service.getRunVerificationStatus('multi-run-1');
        expect(status.allVerified).toBe(true);
        expect(status.pendingCount).toBe(0);
        expect(status.jobs.length).toBe(2);
      });
    });
  });

  describe('Verification Tools & Charter', () => {
    it('executes verification tools via ToolRegistry', async () => {
      await inA(async () => {
        const attention = new AttentionService(client);
        const service = new VerificationJobService(client, undefined, attention);
        const tools = verificationTools(() => service);
        const toolMap = new Map(tools.map((t) => [t.definition.slug, t]));

        // Create job tool
        const createTool = toolMap.get('verification_create_job')!;
        const createRes = await createTool.handler(
          {
            runId: 'tool-run-1',
            toolSlug: 'schedule_book',
            actionInput: { slot: '10:00' },
            actionOutput: { booked: true },
            idempotencyKey: 'tool-idem-1',
          },
          {} as any
        );
        expect((createRes.job as any).id).toBeDefined();

        // Check run status tool
        const checkTool = toolMap.get('verification_check_run')!;
        const checkRes = await checkTool.handler({ runId: 'tool-run-1' }, {} as any);
        expect((checkRes as any).pendingCount).toBe(1);
      });
    });

    it('builds Verification agent from charter', async () => {
      const registry = new ToolRegistryService();
      const agent = buildAgentFromCharter(DEFAULT_VERIFICATION_CHARTER, { registry });
      expect(agent.agentSlug).toBe('verification');
      expect(agent.graph.nodes.some((n) => n.id === 'plan')).toBe(true);
      expect(agent.graph.nodes.some((n) => n.id === 'finish')).toBe(true);
    });
  });
});
