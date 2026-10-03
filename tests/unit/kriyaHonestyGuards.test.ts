/**
 * Kriya Omnitask — Honesty guard regression tests (docs/kriya WP-0.2, WP-0.3)
 * Every test here pins a path that previously fabricated success (audit items S2-S7).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { config } from '../../src/core/config/config.js';
import { getAppMode, isSandboxMode, collectReadinessViolations, NotConfiguredError } from '../../src/core/config/runtimeMode.js';
import { db, SQLiteDatabaseClient } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { TenantContextManager } from '../../src/core/context/tenantContext.js';
import { TenantRepository } from '../../src/storage/repositories/tenantRepository.js';
import { OutboundQueueService } from '../../src/channels/queue/outboundQueueService.js';
import { ToolRegistryService } from '../../src/tools/registry/toolRegistry.js';
import { CredentialVault } from '../../src/tools/vault/credentialVault.js';
import { StripePaymentAdapter } from '../../src/billing/stripe/stripePaymentAdapter.js';
import { DeterministicLLMAdapter, ModelRouter, LLMProviderAdapter } from '../../src/orchestration/routing/modelRouter.js';
import { ModelGateway } from '../../src/model/gateway/modelGateway.js';
import { HierarchicalOrchestrator } from '../../src/orchestration/orchestrator/hierarchicalOrchestrator.js';
import { AgentRegistryService } from '../../src/agents/registry/agentRegistry.js';

const setMode = (APP_MODE?: 'production' | 'staging' | 'sandbox' | 'test', extra: Record<string, unknown> = {}) =>
  config.resetForTesting({ APP_MODE, ...extra } as any);

describe('Runtime mode gate (WP-0.3)', () => {
  afterEach(() => setMode(undefined));

  it('derives test mode under vitest and treats it as sandbox', () => {
    setMode(undefined);
    expect(getAppMode()).toBe('test');
    expect(isSandboxMode()).toBe(true);
    expect(collectReadinessViolations()).toEqual([]);
  });

  it('flags default secrets, missing model provider, sqlite and :memory: in production', () => {
    setMode('production', { OPENROUTER_API_KEY: '', DB_DRIVER: 'sqlite', DATABASE_URL: ':memory:' });
    const v = collectReadinessViolations().join('\n');
    expect(v).toContain('JWT_SECRET is a published default');
    expect(v).toContain('ENCRYPTION_KEY is a published default');
    expect(v).toContain('OPENROUTER_API_KEY');
    expect(v).toContain('PROOF_SIGNING_PRIVATE_KEY');
    expect(v).toContain('DB_DRIVER=postgres');
    expect(v).toContain(':memory:');
  });

  it('accepts a correctly configured staging setup', () => {
    setMode('staging', {
      JWT_SECRET: 'a'.repeat(40),
      ENCRYPTION_KEY: 'b'.repeat(40),
      WHATSAPP_APP_SECRET: 'c'.repeat(40),
      WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'd'.repeat(40),
      OPENROUTER_API_KEY: 'sk-or-test',
      PROOF_SIGNING_PRIVATE_KEY: 'test-signing-key-present',
      DB_DRIVER: 'sqlite',
      DATABASE_URL: './data/staging.db',
    });
    expect(collectReadinessViolations()).toEqual([]);
  });

  it('refuses to fall back to in-memory SQLite when DB_DRIVER=postgres (S5)', () => {
    const manager = db as any;
    const saved = manager.client;
    try {
      manager.client = undefined;
      setMode(undefined, { DB_DRIVER: 'postgres' });
      expect(() => db.getClient()).toThrow(/Refusing to fall back/);
    } finally {
      manager.client = saved;
    }
  });
});

describe('No fabricated success outside sandbox (WP-0.2)', () => {
  let client: SQLiteDatabaseClient;
  let tenantId: string;

  beforeEach(async () => {
    setMode(undefined);
    client = new SQLiteDatabaseClient(':memory:');
    db.setClientForTesting(client);
    await new SchemaMigrator(client).applyMigrations();
    const tenant = await new TenantRepository(client).create({
      name: 'Honesty Clinic',
      slug: 'honesty-clinic',
      plan_tier: 'enterprise',
      channel_plan: 'combined',
    });
    tenantId = tenant.id;
  });

  afterEach(async () => {
    setMode(undefined);
    await client.close();
  });

  it('deterministic LLM adapter cannot be constructed outside sandbox (S2)', () => {
    setMode('staging');
    expect(() => new DeterministicLLMAdapter()).toThrow(NotConfiguredError);
  });

  it('outbound message without a transport is queued, never reported as sent (S4)', async () => {
    setMode('staging');
    await TenantContextManager.withTenant(tenantId, 'default', async () => {
      const res = await new OutboundQueueService().dispatch({
        channel: 'whatsapp',
        recipient: '+919876543210',
        idempotencyKey: 'honesty-001',
        messageType: 'text',
        payload: { text: 'Your appointment is confirmed' },
        isDirectResponse: true,
      });
      expect(res.status).toBe('queued');
      expect(res.delivered).toBe(false);
      expect(res.message.external_message_id ?? null).toBeNull();
    });
  });

  it('sandbox sends are explicitly labelled as simulated', async () => {
    await TenantContextManager.withTenant(tenantId, 'default', async () => {
      const res = await new OutboundQueueService().dispatch({
        channel: 'whatsapp',
        recipient: '+919876543210',
        idempotencyKey: 'honesty-002',
        messageType: 'text',
        payload: { text: 'hello' },
        isDirectResponse: true,
      });
      expect(res.message.external_message_id).toMatch(/^sandbox\./);
      expect(res.reason).toContain('SANDBOX');
    });
  });

  it('connector-less tools refuse outside sandbox and are tagged in sandbox (S7)', async () => {
    const registry = new ToolRegistryService();
    const ctx = { tenantId, vault: new CredentialVault() };
    for (const slug of ['calendar_check_availability', 'calendar_book_slot', 'financial_issue_refund', 'custom_http_webhook']) {
      expect(registry.getTool(slug)).not.toBeNull();
    }

    const booking = { customerId: 'c1', slotTime: '2026-10-02T10:00:00Z', title: 'Consult' };
    const sandboxOut = await registry.getTool('calendar_book_slot')!.handler(booking, ctx);
    expect(sandboxOut.sandbox).toBe(true);

    setMode('staging');
    await expect(registry.getTool('calendar_book_slot')!.handler(booking, ctx)).rejects.toThrow(NotConfiguredError);
    await expect(
      registry.getTool('financial_issue_refund')!.handler({ customerId: 'c1', transactionId: 't1', amountUsd: 5, reason: 'duplicate charge' }, ctx)
    ).rejects.toThrow(NotConfiguredError);
  });

  it('Stripe payment intents refuse outside sandbox (S6)', () => {
    setMode('staging');
    const invoice = { id: 'inv_x', totalAmountCents: 1000, currency: 'INR' } as any;
    expect(() => StripePaymentAdapter.createPaymentIntent(invoice)).toThrow(NotConfiguredError);
  });

  it('unparseable model output becomes a failed step needing approval, not a success (S3)', async () => {
    const proseAdapter: LLMProviderAdapter = {
      async execute() {
        return { content: 'Sure! Your appointment is booked for tomorrow.', promptTokens: 10, completionTokens: 10 };
      },
    };

    await TenantContextManager.withTenant(tenantId, 'default', async () => {
      await new AgentRegistryService().bootstrapSystemTemplates();
      const orchestrator = new HierarchicalOrchestrator(undefined, undefined, undefined, new ModelGateway({ adapterFor: () => proseAdapter }));
      const result = await orchestrator.dispatch({
        objective: 'Book me an appointment tomorrow',
        entryAgentSlug: 'appointment_booking_specialist',
      });

      expect(result.primaryOutcome.status).toBe('failed');
      expect(result.primaryOutcome.confidence).toBe(0);
      expect(result.primaryOutcome.policyFlags).toContain('UNPARSEABLE_MODEL_OUTPUT');
      expect(result.status).not.toBe('completed');
    });
  });
});
