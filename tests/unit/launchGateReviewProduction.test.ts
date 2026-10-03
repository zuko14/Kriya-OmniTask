/**
 * Kriya AI — Production Launch Gate Review Test Suite
 * Milestone M8 / WP-8.6 Comprehensive Unit & Integration Verification Suite.
 *
 * Verifies all 10 non-negotiable production launch criteria:
 * 1. G1: No simulated adapter reachable in APP_MODE=production (boot check + test refusal)
 * 2. G2: Postgres in production; PITR backup restored successfully in a drill
 * 3. G3: Consequential action path: Policy -> Mandate -> Tool -> Verify -> Proof
 * 4. G4: Live model provider tests pass for >= 2 providers (fallback proven)
 * 5. G5: WhatsApp + payment provider verified end-to-end in test mode
 * 6. G6: Golden eval suites pass for all five agents; measured action rate published honestly per risk tier
 * 7. G7: Tenant isolation suite passes on relational boundaries
 * 8. G8: Kill switches (global, tenant, agent, tool) operational and tested
 * 9. G9: CI green; one-step instant rollback rehearsed
 * 10. G10: No unsupported superlatives in UI or copy (no "100%", no uncertified "compliant")
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { SQLiteDatabaseClient, db } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { DeploymentRepository } from '../../src/deployment/repositories/deploymentRepository.js';
import { LaunchGateReviewEngine } from '../../src/deployment/gate/launchGateReviewEngine.js';
import { ProofService } from '../../src/trust/proof/proofService.js';
import { PitrEngine } from '../../src/reliability/pitr/pitrEngine.js';
import { TenantContextManager } from '../../src/core/context/tenantContext.js';
import { DeterministicHashEmbeddingAdapter } from '../../src/knowledge/embeddings/embeddingAdapters.js';
import { HermeticMockBrowserDriver } from '../../src/reach/driver/browserDriver.js';
import { ReachKillSwitch } from '../../src/reach/security/reachKillSwitch.js';
import { PolicyViolationError, TenantIsolationError } from '../../src/core/errors/errors.js';
import { deploymentRoutes } from '../../src/api/routes/deploymentRoutes.js';
import { JwtService } from '../../src/security/auth/jwt.js';

describe('WP-8.6: Launch Gate Review & Production Readiness Verification Suite', () => {
  let client: SQLiteDatabaseClient;
  let repo: DeploymentRepository;
  let proofService: ProofService;
  let pitrEngine: PitrEngine;
  let engine: LaunchGateReviewEngine;
  let app: FastifyInstance;

  const adminToken = JwtService.sign({
    userId: 'admin_ops_director',
    tenantId: 'tenant_kriya_prod',
    organizationId: 'org_kriya_global',
    email: 'ops@kriya.ai',
    roles: ['super_admin', 'owner'],
  });

  const tenantToken = JwtService.sign({
    userId: 'user_viewer_1',
    tenantId: 'tenant_kriya_prod',
    organizationId: 'org_kriya_global',
    email: 'viewer@kriya.ai',
    roles: ['viewer'],
  });

  beforeEach(async () => {
    client = db.getClient() as SQLiteDatabaseClient;

    const migrator = new SchemaMigrator(client);
    await migrator.applyMigrations();

    await client.execute('DELETE FROM launch_gate_reviews;');
    await client.execute('DELETE FROM proof_receipts;');
    await client.execute('DELETE FROM release_deployments;');

    await client.execute(
      `INSERT OR IGNORE INTO tenants (id, name, slug, status, created_at, updated_at)
       VALUES (?, ?, ?, 'active', datetime('now'), datetime('now'));`,
      ['tenant_kriya_prod', 'Kriya Production Tenant', 'kriya-prod']
    );
    await client.execute(
      `INSERT OR IGNORE INTO tenants (id, name, slug, status, created_at, updated_at)
       VALUES (?, ?, ?, 'active', datetime('now'), datetime('now'));`,
      ['default', 'Default System Tenant', 'default']
    );

    repo = new DeploymentRepository(client);
    proofService = new ProofService(client);
    pitrEngine = new PitrEngine(client);
    engine = new LaunchGateReviewEngine(client, repo, proofService, pitrEngine);

    app = Fastify({ logger: false });
    app.setErrorHandler((error: any, _request, reply) => {
      const statusCode = error.statusCode || 500;
      reply.status(statusCode).send({
        error: error.name,
        message: error.message,
        statusCode,
      });
    });

    await app.register(deploymentRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  // ==========================================================================
  // Criterion 1: No simulated adapter reachable in production
  // ==========================================================================
  it('G1: refuses execution of simulated adapters when APP_MODE=production', async () => {
    const prevMode = process.env.APP_MODE;
    try {
      process.env.APP_MODE = 'production';

      const embeddingAdapter = new DeterministicHashEmbeddingAdapter();
      await expect(embeddingAdapter.embed(['sample text'])).rejects.toThrow(PolicyViolationError);

      const browserDriver = new HermeticMockBrowserDriver();
      await expect(
        browserDriver.createSession({ tenantId: 'tenant_prod', allowedDomains: ['example.com'] })
      ).rejects.toThrow(PolicyViolationError);
    } finally {
      if (prevMode !== undefined) {
        process.env.APP_MODE = prevMode;
      } else {
        delete process.env.APP_MODE;
      }
    }

    const check = await engine.evaluateGate1_NoSimulatedAdapters('production');
    expect(check.status).toBe('PASS');
    expect(check.evidence.embeddingAdapterRefusedInProduction).toBe(true);
    expect(check.evidence.browserDriverRefusedInProduction).toBe(true);
  });

  // ==========================================================================
  // Criterion 2: PostgreSQL in production & PITR verified
  // ==========================================================================
  it('G2: verifies database driver requirements and PITR recovery readiness', async () => {
    // In staging/sandbox, sqlite passes
    const stagingCheck = await engine.evaluateGate2_PostgresPitrVerified('staging');
    expect(stagingCheck.status).toBe('PASS');
    expect(stagingCheck.evidence.pitrEngineAvailable).toBe(true);

    // In production, sqlite triggers expected violation if driver is not postgres
    const prodCheck = await engine.evaluateGate2_PostgresPitrVerified('production');
    expect(prodCheck.evidence.pitrEngineAvailable).toBe(true);
    if (prodCheck.evidence.configuredDriver === 'sqlite') {
      expect(prodCheck.status).toBe('FAIL');
      expect(prodCheck.errors[0]).toContain('Production mode requires DB_DRIVER=postgres');
    }
  });

  // ==========================================================================
  // Criterion 3: Consequential action path strictly validated
  // ==========================================================================
  it('G3: verifies complete 5-stage consequential action chain (Policy -> Mandate -> Tool -> Verify -> Proof)', async () => {
    const check = await engine.evaluateGate3_ConsequentialActionChain();
    expect(check.status).toBe('PASS');
    expect(check.evidence.pipeline).toEqual([
      'PolicyEngine',
      'MandateService',
      'ToolRegistry',
      'ToolVerification',
      'ProofService',
    ]);
    expect(check.evidence.mandateEnforcement).toBe(true);
    expect(check.evidence.postActionReadbackRequired).toBe(true);
    expect(check.evidence.ed25519ProofReceiptIssuance).toBe(true);
  });

  // ==========================================================================
  // Criterion 4: Live model provider tests pass for >= 2 providers
  // ==========================================================================
  it('G4: validates multi-provider resilience and fallback capability for at least 2 providers', async () => {
    const check = await engine.evaluateGate4_ModelProviderFallback();
    expect(check.status).toBe('PASS');
    expect(Number(check.evidence.configuredProvidersCount)).toBeGreaterThanOrEqual(2);
    expect(check.evidence.fallbackRoutingOperational).toBe(true);
  });

  // ==========================================================================
  // Criterion 5: WhatsApp + payment provider verified end-to-end in test mode
  // ==========================================================================
  it('G5: verifies WhatsApp HMAC-SHA256 signature verification and payment gateway test mode', async () => {
    const check = await engine.evaluateGate5_WhatsAppPaymentTestMode();
    expect(check.status).toBe('PASS');
    expect(check.evidence.whatsappSignatureValidation).toBe(true);
    expect(check.evidence.whatsappMessageBuilt).toBe(true);
    expect(check.evidence.paymentProviderTestMode).toBe(true);
  });

  // ==========================================================================
  // Criterion 6: Golden eval suites pass for all five agents with honest metrics
  // ==========================================================================
  it('G6: validates golden evaluation suites across all 5 workforce agents with zero fabrication', async () => {
    const check = await engine.evaluateGate6_GoldenEvalHonesty();
    expect(check.status).toBe('PASS');
    expect(check.evidence.registeredSuites).toEqual(
      expect.arrayContaining(['intake', 'scheduling', 'payments', 'document', 'attention'])
    );
    expect(check.evidence.zeroFabricationCompliant).toBe(true);

    const rates = check.evidence.verifiedActionRateByTier as any;
    expect(rates.T0.measured).toBe(true);
    expect(rates.T0.rate).toBeGreaterThan(95.0);
    expect(rates.T1.measured).toBe(true);
    expect(rates.T2.measured).toBe(true);
    expect(rates.T3.measured).toBe(true);
  });

  // ==========================================================================
  // Criterion 7: Tenant isolation verified on relational boundaries
  // ==========================================================================
  it('G7: verifies tenant boundary enforcement and throws TenantIsolationError outside active scope', async () => {
    const check = await engine.evaluateGate7_TenantIsolationVerified();
    expect(check.status).toBe('PASS');
    expect(check.evidence.isolationOutsideContextEnforced).toBe(true);
    expect(check.evidence.tenantContextPreserved).toBe(true);

    // Direct assertion
    expect(() => TenantContextManager.getRequired()).toThrow(TenantIsolationError);
  });

  // ==========================================================================
  // Criterion 8: Kill switches (global, tenant, agent, tool) operational and tested
  // ==========================================================================
  it('G8: verifies four-level operational kill switches (Global, Tenant, Agent, Tool)', async () => {
    const ks = ReachKillSwitch.getInstance();

    // Verify global kill switch
    ks.setGlobalKillSwitch(true, 'Emergency shutdown test');
    expect(ks.isGlobalKillSwitchActive().active).toBe(true);
    expect(() => ks.assertNotKilled('tenant_123')).toThrow();
    ks.setGlobalKillSwitch(false);
    expect(ks.isGlobalKillSwitchActive().active).toBe(false);

    // Verify tenant kill switch
    ks.setTenantKillSwitch('tenant_123', true, 'Tenant compromise detected');
    expect(ks.isTenantKillSwitchActive('tenant_123').active).toBe(true);
    expect(() => ks.assertNotKilled('tenant_123')).toThrow();
    ks.setTenantKillSwitch('tenant_123', false);
    expect(ks.isTenantKillSwitchActive('tenant_123').active).toBe(false);

    // Gate evaluation
    const check = await engine.evaluateGate8_KillSwitchesOperational();
    expect(check.status).toBe('PASS');
    expect(check.evidence.globalKillSwitchOperational).toBe(true);
    expect(check.evidence.tenantKillSwitchOperational).toBe(true);
  });

  // ==========================================================================
  // Criterion 9: Rollback rehearsed and verified
  // ==========================================================================
  it('G9: validates one-step instant rollback readiness and zero-delay traffic retraction', async () => {
    const check = await engine.evaluateGate9_RollbackRehearsed();
    expect(check.status).toBe('PASS');
    expect(check.evidence.oneStepRollbackEngineReady).toBe(true);
    expect(check.evidence.instantTrafficRetractionToZeroPct).toBe(true);
  });

  // ==========================================================================
  // Criterion 10: No unsupported superlatives in UI or copy
  // ==========================================================================
  it('G10: ensures copy and UI strings contain no unsupported superlatives or fake baselines', async () => {
    const check = await engine.evaluateGate10_NoSuperlativesCopy();
    expect(check.status).toBe('PASS');
    expect(check.evidence.copySanitizationPassed).toBe(true);
  });

  // ==========================================================================
  // Aggregate Evaluation & Cryptographic Proof Receipt Issuance
  // ==========================================================================
  it('executes full end-to-end evaluateAllGates, issues signed Ed25519 proof receipt, and persists to database', async () => {
    const report = await TenantContextManager.withTenant(
      'tenant_kriya_prod',
      'org_kriya_global',
      async () => {
        return engine.evaluateAllGates({
          reviewer: 'ops_director_sarah',
          enforceAllGates: true,
          targetEnvironment: 'staging',
        });
      },
      { userId: 'admin_ops_director', roles: ['super_admin'] }
    );

    expect(report.reviewId).toMatch(/^lgr_/);
    expect(report.gates).toHaveLength(10);
    expect(report.summary.totalGates).toBe(10);
    expect(report.summary.passedCount).toBe(10);
    expect(report.summary.failedCount).toBe(0);
    expect(report.overallStatus).toBe('PASSED');
    expect(report.signedPayloadHash).toHaveLength(64);
    expect(report.signature).toBeDefined();

    // Verify proof receipt issuance
    expect(report.proofReceiptId).toBeDefined();

    // Verify database persistence
    const saved = await repo.getLaunchGateReview(report.reviewId);
    expect(saved).not.toBeNull();
    expect(saved?.reviewId).toBe(report.reviewId);
    expect(saved?.overallStatus).toBe('PASSED');
    expect(saved?.gates).toHaveLength(10);

    // Verify latest review retrieval
    const latest = await repo.getLatestLaunchGateReview();
    expect(latest?.reviewId).toBe(report.reviewId);
  });

  // ==========================================================================
  // REST API Endpoints Verification
  // ==========================================================================
  it('POST /api/v1/deployment/launch-gate/evaluate: evaluates all gates and returns signed report', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/deployment/launch-gate/evaluate',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json',
      },
      payload: {
        reviewer: 'kriya_chief_architect',
        targetEnvironment: 'staging',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.reviewId).toMatch(/^lgr_/);
    expect(body.gates).toHaveLength(10);
    expect(body.reviewer).toBe('kriya_chief_architect');
    expect(body.overallStatus).toBe('PASSED');
  });

  it('GET /api/v1/deployment/launch-gate/status: returns latest launch gate evaluation', async () => {
    // 1. Evaluate first
    await app.inject({
      method: 'POST',
      url: '/api/v1/deployment/launch-gate/evaluate',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json',
      },
      payload: {
        reviewer: 'sre_lead',
        targetEnvironment: 'staging',
      },
    });

    // 2. Query status as viewer
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/deployment/launch-gate/status',
      headers: {
        authorization: `Bearer ${tenantToken}`,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.reviewId).toBeDefined();
    expect(body.reviewer).toBe('sre_lead');
    expect(body.gates).toHaveLength(10);
  });

  it('GET /api/v1/deployment/launch-gate/reviews: lists historic launch gate reviews', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/deployment/launch-gate/evaluate',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json',
      },
      payload: {
        reviewer: 'audit_team',
        targetEnvironment: 'staging',
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/deployment/launch-gate/reviews',
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.count).toBeGreaterThanOrEqual(1);
    expect(body.reviews[0].reviewer).toBe('audit_team');
  });

  it('GET /api/v1/deployment/launch-gate/reviews/:reviewId: retrieves specific review and 404s on missing', async () => {
    const evalRes = await app.inject({
      method: 'POST',
      url: '/api/v1/deployment/launch-gate/evaluate',
      headers: {
        authorization: `Bearer ${adminToken}`,
        'content-type': 'application/json',
      },
      payload: {
        reviewer: 'qa_lead',
        targetEnvironment: 'staging',
      },
    });

    const reviewId = evalRes.json().reviewId;

    const getRes = await app.inject({
      method: 'GET',
      url: `/api/v1/deployment/launch-gate/reviews/${reviewId}`,
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
    });

    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().reviewId).toBe(reviewId);

    // Test missing reviewId returns 404
    const notFoundRes = await app.inject({
      method: 'GET',
      url: '/api/v1/deployment/launch-gate/reviews/non_existent_review_id',
      headers: {
        authorization: `Bearer ${adminToken}`,
      },
    });

    expect(notFoundRes.statusCode).toBe(404);
  });
});
