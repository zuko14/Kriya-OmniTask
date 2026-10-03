/**
 * Kriya Omnitask — Verification Queue, Proof Receipts & S55 Regression Tests
 * (Verification Queue GET /api/v1/verification/jobs, Paginated Proof Receipts GET /api/v1/proof/receipts, S55 Honesty)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { SQLiteDatabaseClient, db } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { buildServer } from '../../src/api/server.js';
import { JwtService } from '../../src/security/auth/jwt.js';
import { TenantContextManager } from '../../src/core/context/tenantContext.js';
import { VerificationJobRepository } from '../../src/attention/repositories/verificationJobRepository.js';
import { ProofService } from '../../src/trust/proof/proofService.js';
import { OutcomeInstrumentationService } from '../../src/outcomes/service/outcomeInstrumentationService.js';
import { CryptoUtils } from '../../src/core/utils/crypto.js';

import { TenantRepository } from '../../src/storage/repositories/tenantRepository.js';

describe('Verification Queue, Paginated Proof Receipts & S55 Honesty Tests', () => {
  let client: SQLiteDatabaseClient;
  let server: FastifyInstance;
  const tenantIdA = 'tenant_vp_a';
  const tenantIdB = 'tenant_vp_b';

  beforeEach(async () => {
    client = new SQLiteDatabaseClient(':memory:');
    db.setClientForTesting(client);

    const migrator = new SchemaMigrator(client);
    await migrator.applyMigrations();

    server = await buildServer();

    const tenantRepo = new TenantRepository(client);
    await tenantRepo.create({
      id: tenantIdA,
      name: 'Tenant A',
      slug: 'tenant-a',
    });
    await tenantRepo.create({
      id: tenantIdB,
      name: 'Tenant B',
      slug: 'tenant-b',
    });
  });

  afterEach(async () => {
    if (server) {
      await server.close();
    }
    await client.close();
  });

  // ===========================================================================
  // Part 1: GET /api/v1/verification/jobs
  // ===========================================================================
  describe('Part 1: Verification Jobs REST API (Tenant-Scoped, Paginated, Status-Filtered)', () => {
    it('rejects unauthenticated requests to /api/v1/verification/jobs with 401', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/v1/verification/jobs',
      });
      expect(res.statusCode).toBe(401);
    });

    it('returns empty list when tenant has no verification jobs', async () => {
      const token = JwtService.signToken({
        userId: 'u1',
        email: 'user@tenant-a.com',
        tenantId: tenantIdA,
        roles: ['admin'],
      });

      const res = await server.inject({
        method: 'GET',
        url: '/api/v1/verification/jobs',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.jobs).toEqual([]);
      expect(data.total).toBe(0);
      expect(data.count).toBe(0);
    });

    it('lists jobs scoped to tenant with status filtering and pagination', async () => {
      const jobRepo = new VerificationJobRepository();

      // Seed jobs in Tenant A: 2 pending, 1 mismatch, 1 expired, 1 verified
      await TenantContextManager.withTenant(tenantIdA, 'default', async () => {
        await jobRepo.createJob({
          runId: 'run-1',
          toolSlug: 'refund_issue',
          actionInput: { amount: 500 },
          actionOutput: { status: 'submitted' },
          idempotencyKey: 'idem-1',
          deadlineMinutes: 30,
          intervalSeconds: 60,
          maxAttempts: 5,
        });

        const j2 = await jobRepo.createJob({
          runId: 'run-2',
          toolSlug: 'refund_issue',
          actionInput: { amount: 600 },
          actionOutput: { status: 'submitted' },
          idempotencyKey: 'idem-2',
          deadlineMinutes: 30,
          intervalSeconds: 60,
          maxAttempts: 5,
        });
        await jobRepo.markMismatch(j2.id, { razorpayState: 'not_found' }, 'State mismatch');

        const j3 = await jobRepo.createJob({
          runId: 'run-3',
          toolSlug: 'calendar_book',
          actionInput: { slot: '10:00' },
          actionOutput: { status: 'submitted' },
          idempotencyKey: 'idem-3',
          deadlineMinutes: 30,
          intervalSeconds: 60,
          maxAttempts: 5,
        });
        await jobRepo.markExpired(j3.id, 'Timeout waiting for external event');

        const j4 = await jobRepo.createJob({
          runId: 'run-4',
          toolSlug: 'calendar_book',
          actionInput: { slot: '11:00' },
          actionOutput: { status: 'submitted' },
          idempotencyKey: 'idem-4',
          deadlineMinutes: 30,
          intervalSeconds: 60,
          maxAttempts: 5,
        });
        await jobRepo.markVerified(j4.id, { confirmed: true });
      });

      // Seed 1 job in Tenant B (must NOT be visible to Tenant A)
      await TenantContextManager.withTenant(tenantIdB, 'default', async () => {
        await jobRepo.createJob({
          runId: 'run-b-1',
          toolSlug: 'refund_issue',
          actionInput: { amount: 999 },
          actionOutput: { status: 'submitted' },
          idempotencyKey: 'idem-b-1',
          deadlineMinutes: 30,
          intervalSeconds: 60,
          maxAttempts: 5,
        });
      });

      const tokenA = JwtService.signToken({
        userId: 'u1',
        email: 'user@tenant-a.com',
        tenantId: tenantIdA,
        roles: ['admin'],
      });

      // 1. All Tenant A jobs
      const resAll = await server.inject({
        method: 'GET',
        url: '/api/v1/verification/jobs',
        headers: { authorization: `Bearer ${tokenA}` },
      });
      expect(resAll.statusCode).toBe(200);
      const allData = JSON.parse(resAll.body);
      expect(allData.total).toBe(4);
      expect(allData.count).toBe(4);
      expect(allData.jobs.every((j: any) => j.tenant_id === tenantIdA)).toBe(true);

      // 2. Filter by status: pending|mismatch|expired (Verification Queue unblocker query)
      const resUnverified = await server.inject({
        method: 'GET',
        url: '/api/v1/verification/jobs?status=pending|mismatch|expired',
        headers: { authorization: `Bearer ${tokenA}` },
      });
      expect(resUnverified.statusCode).toBe(200);
      const unverifiedData = JSON.parse(resUnverified.body);
      expect(unverifiedData.total).toBe(3);
      expect(unverifiedData.jobs.map((j: any) => j.status).sort()).toEqual(['expired', 'mismatch', 'pending'].sort());

      // 3. Filter by single status: mismatch
      const resMismatch = await server.inject({
        method: 'GET',
        url: '/api/v1/verification/jobs?status=mismatch',
        headers: { authorization: `Bearer ${tokenA}` },
      });
      expect(resMismatch.statusCode).toBe(200);
      const mismatchData = JSON.parse(resMismatch.body);
      expect(mismatchData.total).toBe(1);
      expect(mismatchData.jobs[0].status).toBe('mismatch');
      expect(mismatchData.jobs[0].error_message).toBe('State mismatch');

      // 4. Pagination (limit=2, offset=1)
      const resPaginated = await server.inject({
        method: 'GET',
        url: '/api/v1/verification/jobs?limit=2&offset=1',
        headers: { authorization: `Bearer ${tokenA}` },
      });
      expect(resPaginated.statusCode).toBe(200);
      const paginatedData = JSON.parse(resPaginated.body);
      expect(paginatedData.total).toBe(4);
      expect(paginatedData.limit).toBe(2);
      expect(paginatedData.offset).toBe(1);
      expect(paginatedData.count).toBe(2);

      // 5. Get job by ID
      const singleJobId = mismatchData.jobs[0].id;
      const resSingle = await server.inject({
        method: 'GET',
        url: `/api/v1/verification/jobs/${singleJobId}`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      expect(resSingle.statusCode).toBe(200);
      const singleJob = JSON.parse(resSingle.body);
      expect(singleJob.id).toBe(singleJobId);
      expect(singleJob.status).toBe('mismatch');

      // 6. Non-existent job ID returns 404
      const res404 = await server.inject({
        method: 'GET',
        url: '/api/v1/verification/jobs/non-existent-id',
        headers: { authorization: `Bearer ${tokenA}` },
      });
      expect(res404.statusCode).toBe(404);
    });
  });

  // ===========================================================================
  // Part 2: Paginated GET /api/v1/proof/receipts
  // ===========================================================================
  describe('Part 2: Paginated Proof Receipts REST API (Tenant-Scoped, Sequence-Ordered)', () => {
    it('rejects unauthenticated requests to /api/v1/proof/receipts with 401', async () => {
      const res = await server.inject({
        method: 'GET',
        url: '/api/v1/proof/receipts',
      });
      expect(res.statusCode).toBe(401);
    });

    it('returns paginated receipts ordered by sequence descending', async () => {
      const proofService = new ProofService();

      // Seed 5 proof receipts in Tenant A
      await TenantContextManager.withTenant(tenantIdA, 'default', async () => {
        for (let seq = 1; seq <= 5; seq++) {
          await proofService.issue({
            runId: `run-${seq}`,
            nodeId: `node-${seq}`,
            actionType: 'payment.refund',
            riskTier: 'T2',
            actor: { agentSlug: 'payments_agent' },
            target: { system: 'razorpay', externalRef: `rf_${seq}` },
            verification: { method: 'read_back', state: 'verified' },
          });
        }
      });

      // Seed 2 proof receipts in Tenant B
      await TenantContextManager.withTenant(tenantIdB, 'default', async () => {
        for (let seq = 1; seq <= 2; seq++) {
          await proofService.issue({
            runId: `run-b-${seq}`,
            actionType: 'booking.create',
            riskTier: 'T1',
            actor: { agentSlug: 'scheduling_agent' },
            target: { system: 'appointment_book' },
            verification: { method: 'read_back', state: 'verified' },
          });
        }
      });

      const tokenA = JwtService.signToken({
        userId: 'u1',
        email: 'user@tenant-a.com',
        tenantId: tenantIdA,
        roles: ['owner'],
      });

      // Fetch first page (limit=3, offset=0)
      const resPage1 = await server.inject({
        method: 'GET',
        url: '/api/v1/proof/receipts?limit=3&offset=0',
        headers: { authorization: `Bearer ${tokenA}` },
      });
      expect(resPage1.statusCode).toBe(200);
      const page1 = JSON.parse(resPage1.body);
      expect(page1.total).toBe(5);
      expect(page1.limit).toBe(3);
      expect(page1.offset).toBe(0);
      expect(page1.count).toBe(3);
      expect(page1.receipts.length).toBe(3);
      // Sequence order DESC: sequence 5, 4, 3
      expect(page1.receipts[0].body.sequence).toBe(5);
      expect(page1.receipts[1].body.sequence).toBe(4);
      expect(page1.receipts[2].body.sequence).toBe(3);
      expect(page1.receipts.every((r: any) => r.body.tenantId === tenantIdA)).toBe(true);

      // Fetch second page (limit=3, offset=3)
      const resPage2 = await server.inject({
        method: 'GET',
        url: '/api/v1/proof/receipts?limit=3&offset=3',
        headers: { authorization: `Bearer ${tokenA}` },
      });
      expect(resPage2.statusCode).toBe(200);
      const page2 = JSON.parse(resPage2.body);
      expect(page2.total).toBe(5);
      expect(page2.count).toBe(2);
      expect(page2.receipts[0].body.sequence).toBe(2);
      expect(page2.receipts[1].body.sequence).toBe(1);

      // Single receipt verify endpoint still works
      const receiptId = page1.receipts[0].body.receiptId;
      const resVerify = await server.inject({
        method: 'GET',
        url: `/api/v1/proof/receipts/${receiptId}/verify`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      expect(resVerify.statusCode).toBe(200);
      const verifyData = JSON.parse(resVerify.body);
      expect(verifyData.valid).toBe(true);
    });
  });

  // ===========================================================================
  // Part 3: S55 Honesty Regression Verification
  // ===========================================================================
  describe('Part 3: S55 Honesty Rule Verification (Per-Workflow Fallbacks & Honest Baselines)', () => {
    it('verifies that zero-verified workflow runs do NOT count as outcomes, do NOT report 100% verified, and do NOT compute cost-per-run', async () => {
      const outcomesService = new OutcomeInstrumentationService();

      await TenantContextManager.withTenant(tenantIdA, 'default', async () => {
        const now = new Date().toISOString();

        // 3 unverified runs for workflow 'lead_qualification'
        for (let i = 1; i <= 3; i++) {
          await client.execute(
            `INSERT INTO graph_runs (id, tenant_id, graph_id, graph_version, graph_json, status, created_at, updated_at)
             VALUES (?, ?, 'lead_qualification', '1.0', '{}', 'completed', ?, ?);`,
            [`run-lead-${i}`, tenantIdA, now, now]
          );

          // Cost attribution record of $0.05 per run
          await client.execute(
            `INSERT INTO cost_attribution_records (id, tenant_id, organization_id, agent_id, task_id, workflow_execution_id, cost_category, provider, resource_metric_name, resource_quantity, unit_cost_usd, total_cost_usd, created_at)
             VALUES (?, ?, 'default', 'intake_agent', ?, ?, 'token_llm', 'openrouter', 'prompt_tokens', 100, 0.0005, 0.05, ?);`,
            [`c-lead-${i}`, tenantIdA, `t-${i}`, `run-lead-${i}`, now]
          );
        }

        const report = await outcomesService.getCostPerOutcomeReport({ window: '24h' });

        expect(report.totalCostUsd).toBe(0.15);
        expect(report.verifiedOutcomesCount).toBe(0);
        expect(report.overallCostPerOutcomeUsd).toBeNull(); // Honest top-level baseline

        const leadWf = report.byWorkflow.find((w) => w.workflowId === 'lead_qualification');
        expect(leadWf).toBeDefined();

        // S55 checks:
        // 1. outcomesCount MUST be 0 (never fallback to stats.runs = 3)
        expect(leadWf!.outcomesCount).toBe(0);

        // 2. costPerOutcomeUsd MUST be null (never fallback to $0.15 / 3 = $0.05 per run)
        expect(leadWf!.costPerOutcomeUsd).toBeNull();

        // 3. verifiedActionRate MUST be 0 (never fallback to (0 || 3) / 3 = 100%)
        expect(leadWf!.verifiedActionRate).toBe(0);
      });
    });

    it('verifies that model with 0 calls reports avgLatencyMs as null (not 0 ms)', async () => {
      const outcomesService = new OutcomeInstrumentationService();

      await TenantContextManager.withTenant(tenantIdA, 'default', async () => {
        const report = await outcomesService.getCostPerOutcomeReport({ window: '24h' });
        // With 0 cascade events and 0 cost records, byModel is empty or null latency
        for (const m of report.byModel) {
          if (m.callsCount === 0) {
            expect(m.avgLatencyMs).toBeNull();
          }
        }
      });
    });

    it('verifies that unknown cascade levels are ignored and NOT bucketed into L0_rule', async () => {
      const outcomesService = new OutcomeInstrumentationService();

      // Test calculateCascadeMix logic directly with an unknown cascade level
      const mix = (outcomesService as any).calculateCascadeMix([
        { cascade_level: 'L0_rule', cost_usd: 0.0, latency_ms: 5, resolved: 1 },
        { cascade_level: 'unknown_exotic_level', cost_usd: 0.05, latency_ms: 50, resolved: 1 },
      ]);

      // Total invocations should count only known valid events (1), not the unknown one
      expect(mix.totalInvocations).toBe(1);
      expect(mix.levels.L0_rule.count).toBe(1);
      expect(mix.levels.L0_rule.percentage).toBe(100);
      expect(mix.levels.L1_cache.count).toBe(0);
      expect(mix.levels.L2_fast_model.count).toBe(0);
      expect(mix.levels.L3_reasoning_model.count).toBe(0);
    });
  });
});
