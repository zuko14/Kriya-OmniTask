/**
 * Kriya AI — Evals-as-CI & Regression Gating Test Suite (WP-6.2)
 * Comprehensive unit and integration verification for agent golden suites,
 * model swap gating, charter update gating, pass^k consistency, and REST APIs (§14, §18 of CLAUDE.md).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { db, SQLiteDatabaseClient } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { TenantRepository } from '../../src/storage/repositories/tenantRepository.js';
import { TenantContextManager } from '../../src/core/context/tenantContext.js';
import { EvalsAsCiService } from '../../src/evaluation/ci/service/evalsAsCiService.js';
import { EvaluationCiRepository } from '../../src/evaluation/ci/repositories/evaluationCiRepository.js';
import {
  ALL_GOLDEN_SUITES,
  INTAKE_GOLDEN_SUITE,
  SCHEDULING_GOLDEN_SUITE,
  PAYMENTS_GOLDEN_SUITE,
  DOCUMENT_GOLDEN_SUITE,
  ATTENTION_GOLDEN_SUITE,
} from '../../src/evaluation/ci/suites/index.js';
import { buildServer } from '../../src/api/server.js';
import { JwtService } from '../../src/security/auth/jwt.js';

describe('Evals-as-CI & Regression Gating Suite (WP-6.2)', () => {
  let client: SQLiteDatabaseClient;
  let tenantId: string;
  let server: FastifyInstance;
  let service: EvalsAsCiService;
  let repo: EvaluationCiRepository;

  beforeEach(async () => {
    client = new SQLiteDatabaseClient(':memory:');
    db.setClientForTesting(client);

    const migrator = new SchemaMigrator(client);
    await migrator.applyMigrations();

    const tenantRepo = new TenantRepository(client);
    const tenant = await tenantRepo.create({
      name: 'CI Test Clinic',
      slug: 'ci-clinic',
      plan_tier: 'enterprise',
      channel_plan: 'combined',
    });
    tenantId = tenant.id;

    repo = new EvaluationCiRepository(client);
    service = new EvalsAsCiService(repo);

    server = await buildServer();
  });

  afterEach(async () => {
    if (server) {
      await server.close();
    }
  });

  describe('Agent Golden Suites Schema & Dataset Integrity', () => {
    it('defines complete Phase 0 agent suites with correct counts and safety categorization', () => {
      expect(Object.keys(ALL_GOLDEN_SUITES)).toEqual([
        'intake',
        'scheduling',
        'payments',
        'document',
        'attention',
      ]);

      // Intake Golden Suite (32 cases)
      expect(INTAKE_GOLDEN_SUITE.testCases.length).toBe(32);
      const intakeSafetyCases = INTAKE_GOLDEN_SUITE.testCases.filter((tc) => tc.isCriticalSafety);
      expect(intakeSafetyCases.length).toBeGreaterThanOrEqual(5); // emergency + injection
      expect(INTAKE_GOLDEN_SUITE.targetPassRate).toBe(0.90);

      // Scheduling Golden Suite (30 cases)
      expect(SCHEDULING_GOLDEN_SUITE.testCases.length).toBe(30);
      const schedSafetyCases = SCHEDULING_GOLDEN_SUITE.testCases.filter((tc) => tc.isCriticalSafety);
      expect(schedSafetyCases.length).toBeGreaterThanOrEqual(3); // adversarial DoS / cross-customer

      // Payments Golden Suite
      expect(PAYMENTS_GOLDEN_SUITE.testCases.length).toBeGreaterThanOrEqual(7);
      const paySafetyCases = PAYMENTS_GOLDEN_SUITE.testCases.filter((tc) => tc.isCriticalSafety);
      expect(paySafetyCases.length).toBeGreaterThanOrEqual(3); // over-mandate, forged webhook, injection

      // Document Golden Suite
      expect(DOCUMENT_GOLDEN_SUITE.testCases.length).toBeGreaterThanOrEqual(5);
      const docZeroRetention = DOCUMENT_GOLDEN_SUITE.testCases.filter((tc) => tc.expectedOutcome.zeroRetentionCheck);
      expect(docZeroRetention.length).toBeGreaterThanOrEqual(3);

      // Attention Golden Suite
      expect(ATTENTION_GOLDEN_SUITE.testCases.length).toBeGreaterThanOrEqual(5);
      const p0Emergency = ATTENTION_GOLDEN_SUITE.testCases.find((tc) => tc.id === 'att_p0_emergency_bypass');
      expect(p0Emergency?.expectedOutcome.emergencyRolePaged).toBe('emergency_on_call');
    });
  });

  describe('EvalsAsCiService Suite Execution & Pass^k Consistency (S27)', () => {
    it('runs golden suites across all Phase 0 agents with >= 90% pass rate and zero safety breaches', async () => {
      for (const slug of ['intake', 'scheduling', 'payments', 'document', 'attention'] as const) {
        const report = await service.evaluateAgentSuite(slug);
        expect(report.verdict).toBe('release_approved');
        expect(report.passRate).toBeGreaterThanOrEqual(0.90);
        expect(report.criticalSafetyBreaches).toBe(0);
        expect(report.totalCases).toBe(ALL_GOLDEN_SUITES[slug].testCases.length);
      }
    });

    it('S27: executes pass^k trials (k=3) and separates provider errors from reasoning failures', async () => {
      const tc = INTAKE_GOLDEN_SUITE.testCases[0];

      // 1. Success on all 3 trials -> passKRatio = 1.0
      const passKResult = await service.evaluateCase(
        tc,
        async () => ({ output: 'ok', routedTo: 'scheduling', latencyMs: 50, costUsd: 0.0001 }),
        3
      );
      expect(passKResult.passed).toBe(true);
      expect(passKResult.passKRatio).toBe(1.0);
      expect(passKResult.trialsPassed).toBe(3);
      expect(passKResult.trialsTotal).toBe(3);

      // 2. Simulated transient provider network error (HTTP 429) on trial 1, success on 2 & 3
      let trialCall = 0;
      const transientProviderResult = await service.evaluateCase(
        tc,
        async () => {
          trialCall++;
          if (trialCall === 1) {
            throw new Error('OpenRouter HTTP 429: rate limit exceeded');
          }
          return { output: 'ok', routedTo: 'scheduling', latencyMs: 60, costUsd: 0.0001 };
        },
        3
      );
      // 2 out of 3 trials passed (67% pass ratio; threshold for strict is 0.8)
      expect(transientProviderResult.trialsPassed).toBe(2);
      expect(transientProviderResult.trialsTotal).toBe(3);
      expect(transientProviderResult.passKRatio).toBe(0.67);
      expect(transientProviderResult.failureReasons.some((r) => r.includes('rate limit'))).toBe(true);
      expect(transientProviderResult.errorCategory).toBe('provider');
    });
  });

  describe('Model-Swap Regression Gating', () => {
    it('approves model swap when proposed model matches or improves baseline', async () => {
      const result = await TenantContextManager.withTenant(tenantId, 'default', async () => {
        return service.evaluateModelSwap({
          tenantId,
          currentModelId: 'deepseek/deepseek-v4-flash',
          proposedModelId: 'google/gemini-2.5-flash',
          agentSlugs: ['intake', 'scheduling'],
        });
      }, { userId: 'u1', roles: ['admin'] });

      expect(result.verdict).toBe('release_approved');
      expect(result.safetyBreachesCount).toBe(0);
      expect(result.proposedPassRate).toBeGreaterThanOrEqual(result.baselinePassRate);
      expect(result.passRateDelta).toBeGreaterThanOrEqual(0);
      expect(result.agentReports.intake.passed).toBe(true);
      expect(result.agentReports.scheduling.passed).toBe(true);
    });

    it('blocks model swap with release_blocked_regression if proposed model regresses on pass rate', async () => {
      const result = await TenantContextManager.withTenant(tenantId, 'default', async () => {
        return service.evaluateModelSwap({
          tenantId,
          currentModelId: 'production-v1',
          proposedModelId: 'regressed-candidate-v2',
          agentSlugs: ['intake'],
        });
      }, { userId: 'u1', roles: ['admin'] });

      expect(result.verdict).toBe('release_blocked_regression');
      expect(result.passRateDelta).toBeLessThan(0);
      expect(result.reasons.some((r) => r.includes('regressed'))).toBe(true);
    });

    it('immediately blocks model swap if proposed model exhibits ANY critical safety breach', async () => {
      const result = await TenantContextManager.withTenant(tenantId, 'default', async () => {
        return service.evaluateModelSwap({
          tenantId,
          currentModelId: 'production-v1',
          proposedModelId: 'safety-bug-candidate',
          agentSlugs: ['intake'],
        });
      }, { userId: 'u1', roles: ['admin'] });

      expect(result.verdict).toBe('release_blocked_regression');
      expect(result.safetyBreachesCount).toBeGreaterThan(0);
      expect(result.reasons.some((r) => r.includes('safety breach'))).toBe(true);
    });
  });

  describe('Charter-Update Regression Gating', () => {
    it('approves charter update when proposed charter preserves capabilities and safety', async () => {
      const result = await TenantContextManager.withTenant(tenantId, 'default', async () => {
        return service.evaluateCharterUpdate({
          tenantId,
          agentSlug: 'intake',
          currentCharter: { version: '1.0.0', autonomousRouting: true },
          proposedCharter: { version: '1.1.0', autonomousRouting: true, updatedPrompt: 'optimized' },
        });
      }, { userId: 'u1', roles: ['admin'] });

      expect(result.verdict).toBe('release_approved');
      expect(result.blockedByRegression).toBe(false);
      expect(result.proposedPassRate).toBeGreaterThanOrEqual(result.currentPassRate);
    });

    it('blocks charter update when proposed charter breaks emergency handling', async () => {
      const result = await TenantContextManager.withTenant(tenantId, 'default', async () => {
        return service.evaluateCharterUpdate({
          tenantId,
          agentSlug: 'intake',
          currentCharter: { version: '1.0.0', autonomousRouting: true },
          proposedCharter: { version: '1.1.0', disableEmergencyHandling: true },
        });
      }, { userId: 'u1', roles: ['admin'] });

      expect(result.verdict).toBe('release_blocked_regression');
      expect(result.blockedByRegression).toBe(true);
      expect(result.reasons.some((r) => r.includes('CHARTER UPDATE BLOCKED'))).toBe(true);
    });
  });

  describe('Full CI Pipeline Execution', () => {
    it('runs CI pipeline across all suites and generates passing report with exitCode 0', async () => {
      const report = await service.runCiPipeline({
        tenantId,
        passKTrials: 1,
        strictMode: false,
      });

      expect(report.passed).toBe(true);
      expect(report.exitCode).toBe(0);
      expect(report.overallVerdict).toBe('release_approved');
      expect(report.totalTestCases).toBeGreaterThanOrEqual(75);
      expect(report.criticalSafetyPassRate).toBe(1.0);
      expect(report.blockers.length).toBe(0);
      expect(report.suitesEvaluated).toBe(5);
    });
  });

  describe('REST Endpoints Integration', () => {
    let adminToken: string;

    beforeEach(() => {
      adminToken = JwtService.signToken({
        userId: 'u_admin',
        email: 'admin@ci-clinic.com',
        tenantId,
        roles: ['owner', 'admin'],
      });
    });

    it('POST /api/v1/evaluation/ci/run executes CI suites and returns report', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/evaluation/ci/run',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          agentSlugs: ['document', 'attention'],
          strictMode: false,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.exitCode).toBe(0);
      expect(body.passed).toBe(true);
      expect(body.suitesEvaluated).toBe(2);
      expect(body.agentReports.document).toBeDefined();
      expect(body.agentReports.attention).toBeDefined();
    });

    it('POST /api/v1/evaluation/ci/gate-model-swap rejects regressed candidate with 422', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/evaluation/ci/gate-model-swap',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          tenantId,
          currentModelId: 'deepseek/deepseek-v4-flash',
          proposedModelId: 'regressed-v1',
          agentSlugs: ['intake'],
        },
      });

      expect(res.statusCode).toBe(422);
      const body = res.json();
      expect(body.verdict).toBe('release_blocked_regression');
      expect(body.reasons.length).toBeGreaterThan(0);
    });

    it('POST /api/v1/evaluation/ci/gate-model-swap approves parity candidate with 200', async () => {
      const res = await server.inject({
        method: 'POST',
        url: '/api/v1/evaluation/ci/gate-model-swap',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          tenantId,
          currentModelId: 'deepseek/deepseek-v4-flash',
          proposedModelId: 'gemini-2.5-flash',
          agentSlugs: ['scheduling'],
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.verdict).toBe('release_approved');
      expect(body.safetyBreachesCount).toBe(0);
    });

    it('GET /api/v1/evaluation/ci/runs returns historical audited gate runs', async () => {
      // First trigger a model swap check to record a run
      await server.inject({
        method: 'POST',
        url: '/api/v1/evaluation/ci/gate-model-swap',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          tenantId,
          currentModelId: 'model-a',
          proposedModelId: 'model-b',
          agentSlugs: ['payments'],
        },
      });

      const res = await server.inject({
        method: 'GET',
        url: '/api/v1/evaluation/ci/runs?evaluationType=model_swap_gate',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.count).toBeGreaterThanOrEqual(1);
      expect(body.runs[0].evaluation_type).toBe('model_swap_gate');
    });
  });
});
