/**
 * Kriya AI — Release Gating, Canary Routing, One-Step Rollback & India Hosting Production Tests
 * Milestone M8 / WP-8.5 Comprehensive Unit & Integration Verification Suite.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { SQLiteDatabaseClient, db } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { DeploymentRepository } from '../../src/deployment/repositories/deploymentRepository.js';
import { DeploymentService } from '../../src/deployment/service/deploymentService.js';
import { CanaryRoutingEngine } from '../../src/deployment/canary/canaryRoutingEngine.js';
import { OneStepRollbackEngine } from '../../src/deployment/rollback/oneStepRollbackEngine.js';
import { ApiVersionManager } from '../../src/deployment/versioning/apiVersionManager.js';
import { TenantContextManager } from '../../src/core/context/tenantContext.js';
import { DataResidencyEngine } from '../../src/deployment/residency/dataResidencyEngine.js';
import { AttentionService } from '../../src/attention/service/attentionService.js';
import { ProofService } from '../../src/trust/proof/proofService.js';
import { deploymentRoutes } from '../../src/api/routes/deploymentRoutes.js';
import { JwtService } from '../../src/security/auth/jwt.js';

describe('WP-8.5: Release Gating, Canary Routing, One-Step Rollback & India Hosting Production Suite', () => {
  let client: SQLiteDatabaseClient;
  let repo: DeploymentRepository;
  let attentionService: AttentionService;
  let proofService: ProofService;
  let service: DeploymentService;
  let app: FastifyInstance;

  const adminToken = JwtService.sign({
    userId: 'admin_sre_1',
    tenantId: 'tenant_india_primary',
    organizationId: 'org_kriya',
    email: 'sre@kriya.ai',
    roles: ['super_admin', 'owner'],
  });

  const tenantToken = JwtService.sign({
    userId: 'user_dev_1',
    tenantId: 'tenant_india_primary',
    organizationId: 'org_kriya',
    email: 'dev@kriya.ai',
    roles: ['admin'],
  });

  beforeEach(async () => {
    client = db.getClient() as SQLiteDatabaseClient;

    const migrator = new SchemaMigrator(client);
    await migrator.applyMigrations();

    await client.execute('DELETE FROM release_deployments;');
    await client.execute('DELETE FROM canary_routing_configurations;');
    await client.execute('DELETE FROM canary_telemetry_snapshots;');
    await client.execute('DELETE FROM deployment_rollback_events;');
    await client.execute('DELETE FROM api_version_registrations;');
    await client.execute('DELETE FROM data_residency_configs;');
    await client.execute('DELETE FROM attention_items;');
    await client.execute('DELETE FROM proof_receipts;');

    await client.execute(
      `INSERT OR IGNORE INTO tenants (id, name, slug, status, created_at, updated_at)
       VALUES (?, ?, ?, 'active', datetime('now'), datetime('now'));`,
      ['tenant_india_primary', 'India Primary Tenant', 'india-primary']
    );
    await client.execute(
      `INSERT OR IGNORE INTO tenants (id, name, slug, status, created_at, updated_at)
       VALUES (?, ?, ?, 'active', datetime('now'), datetime('now'));`,
      ['default', 'Default System Tenant', 'default']
    );

    repo = new DeploymentRepository(client);
    attentionService = new AttentionService(client);
    proofService = new ProofService();
    service = new DeploymentService(repo, attentionService, proofService);

    app = Fastify({ logger: false });
    // Register test error handler matching domain error mappings
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
  // 1. Canary Routing Engine & Session Affinity
  // ==========================================================================
  describe('CanaryRoutingEngine', () => {
    it('should compute deterministic 0-99 bucket with perfect session affinity', () => {
      const tenantA = 'tenant_clinic_apollo_1';
      const tenantB = 'tenant_hospital_fortis_2';

      const bucketA1 = CanaryRoutingEngine.computeTenantBucket(tenantA);
      const bucketA2 = CanaryRoutingEngine.computeTenantBucket(tenantA);
      const bucketB = CanaryRoutingEngine.computeTenantBucket(tenantB);

      expect(bucketA1).toBeGreaterThanOrEqual(0);
      expect(bucketA1).toBeLessThan(100);
      expect(bucketA1).toBe(bucketA2); // Perfect deterministic consistency

      // 100 sequential queries for the same tenant must never jitter
      for (let i = 0; i < 100; i++) {
        expect(CanaryRoutingEngine.computeTenantBucket(tenantA)).toBe(bucketA1);
      }
    });

    it('should route all requests to stable when canary weight is 0%', () => {
      const decision1 = CanaryRoutingEngine.routeTenant('tenant_any_1', 0);
      const decision2 = CanaryRoutingEngine.routeTenant('tenant_any_2', 0);

      expect(decision1.target).toBe('stable');
      expect(decision2.target).toBe('stable');
    });

    it('should route all requests to canary when canary weight is 100%', () => {
      const decision1 = CanaryRoutingEngine.routeTenant('tenant_any_1', 100);
      const decision2 = CanaryRoutingEngine.routeTenant('tenant_any_2', 100);

      expect(decision1.target).toBe('canary');
      expect(decision2.target).toBe('canary');
    });

    it('should route deterministically based on bucket vs target weight', () => {
      const tenant = 'test_sample_tenant';
      const bucket = CanaryRoutingEngine.computeTenantBucket(tenant);

      // If weight is higher than bucket -> canary
      const higherWeight = bucket + 1;
      const decisionCanary = CanaryRoutingEngine.routeTenant(tenant, higherWeight);
      expect(decisionCanary.target).toBe('canary');

      // If weight is lower or equal to bucket -> stable
      const lowerWeight = bucket;
      const decisionStable = CanaryRoutingEngine.routeTenant(tenant, lowerWeight);
      expect(decisionStable.target).toBe('stable');
    });

    it('should advance canary progression in phased increments under healthy metrics', () => {
      // 0% -> 5%
      const step1 = CanaryRoutingEngine.evaluateTelemetry(0, { errorRatePct: 0.1, p99LatencyMs: 320 });
      expect(step1.action).toBe('advance');
      expect(step1.recommendedWeightPct).toBe(5);
      expect(step1.verdict).toBe('healthy');

      // 5% -> 10%
      const step2 = CanaryRoutingEngine.evaluateTelemetry(5, { errorRatePct: 0.2, p99LatencyMs: 400 });
      expect(step2.recommendedWeightPct).toBe(10);

      // 10% -> 25%
      const step3 = CanaryRoutingEngine.evaluateTelemetry(10, { errorRatePct: 0.15, p99LatencyMs: 410 });
      expect(step3.recommendedWeightPct).toBe(25);

      // 25% -> 50%
      const step4 = CanaryRoutingEngine.evaluateTelemetry(25, { errorRatePct: 0.3, p99LatencyMs: 450 });
      expect(step4.recommendedWeightPct).toBe(50);

      // 50% -> 100%
      const step5 = CanaryRoutingEngine.evaluateTelemetry(50, { errorRatePct: 0.2, p99LatencyMs: 480 });
      expect(step5.recommendedWeightPct).toBe(100);

      // 100% -> hold
      const step6 = CanaryRoutingEngine.evaluateTelemetry(100, { errorRatePct: 0.2, p99LatencyMs: 480 });
      expect(step6.action).toBe('hold');
      expect(step6.recommendedWeightPct).toBe(100);
    });

    it('should hold traffic when metrics approach warning boundary', () => {
      // Error rate 0.85% (approaching 1.0% limit)
      const warningEval = CanaryRoutingEngine.evaluateTelemetry(25, {
        errorRatePct: 0.85,
        p99LatencyMs: 600,
        maxAllowedErrorRatePct: 1.0,
      });

      expect(warningEval.action).toBe('hold');
      expect(warningEval.verdict).toBe('warning');
      expect(warningEval.recommendedWeightPct).toBe(25);
      expect(warningEval.reason).toContain('operating near threshold limits');
    });

    it('should trigger immediate emergency rollback when error rate or P99 latency spikes', () => {
      // Error spike
      const errorSpike = CanaryRoutingEngine.evaluateTelemetry(25, {
        errorRatePct: 2.4, // > 1.0%
        p99LatencyMs: 500,
      });
      expect(errorSpike.action).toBe('rollback');
      expect(errorSpike.recommendedWeightPct).toBe(0);
      expect(errorSpike.verdict).toBe('critical');

      // Latency spike
      const latencySpike = CanaryRoutingEngine.evaluateTelemetry(50, {
        errorRatePct: 0.1,
        p99LatencyMs: 1850, // > 1500ms
      });
      expect(latencySpike.action).toBe('rollback');
      expect(latencySpike.recommendedWeightPct).toBe(0);
      expect(latencySpike.verdict).toBe('critical');
    });
  });

  // ==========================================================================
  // 2. One-Step Rollback Automation & Cryptographic Proof Receipts
  // ==========================================================================
  describe('OneStepRollbackEngine', () => {
    it('should execute instant one-step rollback with 0% weight, proof receipt, and Attention Center P1 dispatch', async () => {
      // Create active deployment
      const dep = await service.createDeployment('v2.4.0-canary', 'production', 'sre_operator_1');
      await service.setCanaryTrafficWeight(dep.id, 25);

      const verifyBefore = await repo.getDeploymentById(dep.id);
      expect(verifyBefore?.canaryWeightPct).toBe(25);
      expect(verifyBefore?.status).toBe('canary');

      // Execute One-Step Rollback
      const rollbackResult = await service.executeInstantRollback(dep.id, {
        rollbackType: 'automated_telemetry',
        reason: 'P99 Latency breached 1500ms SLO threshold on production cluster',
        executedBy: 'automated_canary_guardian',
      });

      expect(rollbackResult.success).toBe(true);
      expect(rollbackResult.deployment.status).toBe('rolled_back');
      expect(rollbackResult.deployment.canaryWeightPct).toBe(0);
      expect(rollbackResult.deployment.rolledBackAt).toBeDefined();

      // Check Proof Receipt
      expect(rollbackResult.proofReceiptId).toBeDefined();
      const receiptsResult = await TenantContextManager.withTenant('default', 'org_kriya', () =>
        proofService.listReceipts()
      );
      const rollbackReceipt = receiptsResult.receipts.find((r) => r.body.receiptId === rollbackResult.proofReceiptId);
      expect(rollbackReceipt).toBeDefined();
      expect(rollbackReceipt?.body.actionType).toBe('deployment.rollback');
      expect(rollbackReceipt?.body.target.externalRef).toBe(dep.id);

      // Check Attention Escalation
      expect(rollbackResult.attentionItemId).toBeDefined();
      const rollbackItem = await TenantContextManager.withTenant('default', 'org_kriya', () =>
        attentionService.getItem(rollbackResult.attentionItemId!)
      );
      expect(rollbackItem).toBeDefined();
      expect(rollbackItem.priority).toBe('P1_HIGH');
      expect(rollbackItem.reason_category).toBe('slo_burn');
      expect(rollbackItem.title).toContain('CRITICAL: Deployment Rollback');

      // Check Rollback Event History
      const events = await service.listRollbackEvents(dep.id);
      expect(events.length).toBe(1);
      expect(events[0].previousWeightPct).toBe(25);
      expect(events[0].targetWeightPct).toBe(0);
      expect(events[0].rollbackType).toBe('automated_telemetry');
    });

    it('should be safe and idempotent if rollback is requested repeatedly', async () => {
      const dep = await service.createDeployment('v2.4.1', 'production', 'operator_1');
      await service.setCanaryTrafficWeight(dep.id, 10);

      // First rollback
      const res1 = await service.executeInstantRollback(dep.id, {
        rollbackType: 'manual_operator',
        reason: 'Operator manual drain',
        executedBy: 'admin_1',
      });
      expect(res1.success).toBe(true);
      expect(res1.deployment.status).toBe('rolled_back');

      // Second rollback
      const res2 = await service.executeInstantRollback(dep.id, {
        rollbackType: 'manual_operator',
        reason: 'Operator manual drain duplicate',
        executedBy: 'admin_1',
      });
      expect(res2.success).toBe(true);
      expect(res2.message).toContain('was already rolled back');
    });
  });

  // ==========================================================================
  // 3. API Versioning & Contract-Locked Gate
  // ==========================================================================
  describe('ApiVersionManager & Contract Locking', () => {
    it('should compare semver strings accurately', () => {
      expect(ApiVersionManager.compareSemver('1.0.0', '1.0.0')).toBe(0);
      expect(ApiVersionManager.compareSemver('1.2.0', '1.1.9')).toBe(1);
      expect(ApiVersionManager.compareSemver('0.9.5', '1.0.0')).toBe(-1);
      expect(ApiVersionManager.compareSemver('v2.0.1', '2.0.0')).toBe(1);
    });

    it('should enforce minimum client version contract locking (426 Upgrade Required)', async () => {
      await service.registerApiVersion({
        apiVersion: 'v1',
        status: 'active',
        minSupportedClientVersion: '1.2.0',
        notes: 'Initial production API with breaking protocol update',
      });

      // Compatible client (1.2.5 >= 1.2.0)
      const allowedResult = await service.validateClientContract('v1', '1.2.5');
      expect(allowedResult.allowed).toBe(true);

      // Incompatible client (1.1.0 < 1.2.0)
      const blockedResult = await service.validateClientContract('v1', '1.1.0');
      expect(blockedResult.allowed).toBe(false);
      expect(blockedResult.statusCode).toBe(426);
      expect(blockedResult.errorMessage).toContain('is obsolete for API');
    });

    it('should append Deprecation and Sunset headers according to RFC 8594', async () => {
      const sunsetDate = new Date(Date.now() + 86400000 * 30).toISOString();
      await service.registerApiVersion({
        apiVersion: 'v0-legacy',
        status: 'deprecated',
        minSupportedClientVersion: '0.5.0',
        sunsetAt: sunsetDate,
        notes: 'Legacy pre-production interface',
      });

      const result = await service.validateClientContract('v0-legacy', '0.6.0');
      expect(result.allowed).toBe(true);
      expect(result.headers?.['Deprecation']).toBe('true');
      expect(result.headers?.['Sunset']).toBeDefined();
    });

    it('should block requests to sunset API versions with HTTP 410 Gone', async () => {
      const pastSunset = new Date(Date.now() - 1000).toISOString();
      await service.registerApiVersion({
        apiVersion: 'v0-retired',
        status: 'sunset',
        minSupportedClientVersion: '0.1.0',
        sunsetAt: pastSunset,
      });

      const result = await service.validateClientContract('v0-retired', '0.1.0');
      expect(result.allowed).toBe(false);
      expect(result.statusCode).toBe(410);
      expect(result.errorMessage).toContain('has been sunset');
    });
  });

  // ==========================================================================
  // 4. India Data Residency & Sovereign Hosting Governance
  // ==========================================================================
  describe('DataResidencyEngine & India Hosting', () => {
    it('should validate India DPDP Act 2023 compliant hosting regions (ap-south-1)', async () => {
      const tenantId = 'tenant_delhi_heart_centre';
      await service.upsertDataResidency(tenantId, {
        jurisdiction: 'IN_DPDP_2023',
        primaryRegion: 'ap-south-1',
        allowedRegions: ['ap-south-1', 'ap-south-2'],
        strictDataLocalization: true,
        crossBorderTransferPermitted: false,
        approvedLlmInferenceRegions: ['ap-south-1', 'ap-south-2'],
      });

      // Legitimate local operation
      const localOp = await service.validateDataResidency(tenantId, {
        targetRegion: 'ap-south-1',
        isLlmInference: false,
        crossBorderTransfer: false,
      });
      expect(localOp.valid).toBe(true);

      // Prohibited cross-border transfer
      const crossBorderOp = await service.validateDataResidency(tenantId, {
        targetRegion: 'us-east-1',
        isLlmInference: false,
        crossBorderTransfer: true,
      });
      expect(crossBorderOp.valid).toBe(false);
      expect(crossBorderOp.reason).toContain('Cross-border data transfer prohibited');
    });

    it('should gate LLM inference strictly to approved sovereign regions', async () => {
      const tenantId = 'tenant_mumbai_health';
      await service.upsertDataResidency(tenantId, {
        jurisdiction: 'IN_DPDP_2023',
        primaryRegion: 'ap-south-1',
        allowedRegions: ['ap-south-1'],
        strictDataLocalization: true,
        crossBorderTransferPermitted: false,
        approvedLlmInferenceRegions: ['ap-south-1'],
      });

      // Approved inference in Mumbai
      const approvedInf = await service.validateDataResidency(tenantId, {
        targetRegion: 'ap-south-1',
        isLlmInference: true,
        crossBorderTransfer: false,
      });
      expect(approvedInf.valid).toBe(true);

      // Unapproved inference in US or EU
      const unapprovedInf = await service.validateDataResidency(tenantId, {
        targetRegion: 'eu-central-1',
        isLlmInference: true,
        crossBorderTransfer: false,
      });
      expect(unapprovedInf.valid).toBe(false);
      expect(unapprovedInf.reason).toContain('Model inference region');
    });

    it('should export canonical India hosting blueprint with multi-AZ replication and KMS localization', () => {
      const blueprint = service.getIndiaHostingBlueprint();

      expect(blueprint.product).toBe('Kriya Omnitask');
      expect(blueprint.jurisdiction).toBe('Republic of India');
      expect(blueprint.primaryRegion.code).toBe('ap-south-1');
      expect(blueprint.disasterRecoveryRegion.code).toBe('ap-south-2');
      expect(blueprint.storageLocalization.kmsRegion).toBe('ap-south-1');
      expect(blueprint.networkIngress.edgePops).toContain('Mumbai');
      expect(blueprint.networkIngress.edgePops).toContain('Bengaluru');
      expect(blueprint.inferenceGovernance.crossBorderTransferConsentEnforced).toBe(true);
    });
  });

  // ==========================================================================
  // 5. REST API Integration Endpoints
  // ==========================================================================
  describe('Fastify REST API Integration', () => {
    it('should support full canary evaluation and automated rollback via API', async () => {
      // 1. Create release
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/deployment/releases',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          versionTag: 'v3.0.0-rc1',
          environment: 'production',
          deployedBy: 'ci_pipeline_admin',
        },
      });
      expect(createRes.statusCode).toBe(201);
      const deployment = createRes.json();

      // 2. Set canary weight to 10%
      const weightRes = await app.inject({
        method: 'POST',
        url: `/api/v1/deployment/releases/${deployment.id}/canary`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { canaryWeightPct: 10 },
      });
      expect(weightRes.statusCode).toBe(200);

      // 3. Check Tenant Route Assignment
      const routeCheck = await app.inject({
        method: 'GET',
        url: `/api/v1/deployment/canary/${deployment.id}/route-check?tenantId=tenant_india_primary`,
        headers: { authorization: `Bearer ${tenantToken}` },
      });
      expect(routeCheck.statusCode).toBe(200);
      expect(routeCheck.json().weightPct).toBe(10);
      expect(['canary', 'stable']).toContain(routeCheck.json().target);

      // 4. Send Telemetry with Error Spike -> Auto-Rollback
      const telemetryRes = await app.inject({
        method: 'POST',
        url: '/api/v1/deployment/canary/evaluate',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          deploymentId: deployment.id,
          sampleWindowSeconds: 60,
          totalRequests: 1000,
          errorCount: 35, // 3.5% > 1.0% limit
          p95LatencyMs: 400,
          p99LatencyMs: 650,
        },
      });

      expect(telemetryRes.statusCode).toBe(200);
      const evalBody = telemetryRes.json();
      expect(evalBody.evaluation.action).toBe('rollback');
      expect(evalBody.rollbackResult).toBeDefined();
      expect(evalBody.rollbackResult.deployment.status).toBe('rolled_back');
      expect(evalBody.rollbackResult.deployment.canaryWeightPct).toBe(0);

      // 5. Inspect Rollback Events Audit Trail
      const auditRes = await app.inject({
        method: 'GET',
        url: `/api/v1/deployment/releases/${deployment.id}/rollback-events`,
        headers: { authorization: `Bearer ${tenantToken}` },
      });
      expect(auditRes.statusCode).toBe(200);
      expect(auditRes.json().count).toBe(1);
      expect(auditRes.json().events[0].rollbackType).toBe('automated_telemetry');
    });

    it('should execute manual instant rollback via POST /api/v1/deployment/releases/:id/rollback/instant', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/deployment/releases',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { versionTag: 'v3.1.0', environment: 'production', deployedBy: 'admin' },
      });
      const dep = createRes.json();

      const instantRes = await app.inject({
        method: 'POST',
        url: `/api/v1/deployment/releases/${dep.id}/rollback/instant`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          rollbackType: 'manual_operator',
          reason: 'Emergency operator abort due to third-party provider outage',
          executedBy: 'lead_sre_operator',
        },
      });

      expect(instantRes.statusCode).toBe(200);
      const body = instantRes.json();
      expect(body.success).toBe(true);
      expect(body.deployment.status).toBe('rolled_back');
      expect(body.proofReceiptId).toBeDefined();
      expect(body.attentionItemId).toBeDefined();
    });

    it('should manage API version registry and data residency through REST endpoints', async () => {
      // Register API Version
      const verRes = await app.inject({
        method: 'POST',
        url: '/api/v1/deployment/versions',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          apiVersion: 'v1.1',
          status: 'active',
          minSupportedClientVersion: '1.1.0',
          notes: 'Production release with DPDP residency controls',
        },
      });
      expect(verRes.statusCode).toBe(201);

      // List API Versions
      const listVerRes = await app.inject({
        method: 'GET',
        url: '/api/v1/deployment/versions',
        headers: { authorization: `Bearer ${tenantToken}` },
      });
      expect(listVerRes.statusCode).toBe(200);
      expect(listVerRes.json().count).toBeGreaterThanOrEqual(1);

      // Upsert Data Residency
      const resRes = await app.inject({
        method: 'POST',
        url: '/api/v1/deployment/residency',
        headers: { authorization: `Bearer ${tenantToken}` },
        payload: {
          jurisdiction: 'IN_DPDP_2023',
          primaryRegion: 'ap-south-1',
          allowedRegions: ['ap-south-1', 'ap-south-2'],
          strictDataLocalization: true,
          crossBorderTransferPermitted: false,
          approvedLlmInferenceRegions: ['ap-south-1'],
        },
      });
      expect(resRes.statusCode).toBe(200);
      expect(resRes.json().jurisdiction).toBe('IN_DPDP_2023');

      // Validate Residency Rule via REST
      const valRes = await app.inject({
        method: 'POST',
        url: '/api/v1/deployment/residency/validate',
        headers: { authorization: `Bearer ${tenantToken}` },
        payload: {
          targetRegion: 'ap-south-1',
          isLlmInference: true,
          crossBorderTransfer: false,
        },
      });
      expect(valRes.statusCode).toBe(200);
      expect(valRes.json().valid).toBe(true);

      // Fetch India Hosting Blueprint (Public)
      const hostRes = await app.inject({
        method: 'GET',
        url: '/api/v1/deployment/hosting/config',
      });
      expect(hostRes.statusCode).toBe(200);
      expect(hostRes.json().primaryRegion.code).toBe('ap-south-1');
    });
  });
});
