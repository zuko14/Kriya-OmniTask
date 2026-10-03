/**
 * Kriya Omnitask — Governed Adaptation Production Integration Tests (WP-6.4, Milestone M6)
 * Comprehensive verification of the outer improvement loop (§6, §14, §15, §23 of CLAUDE.md; Blueprint §14, §28):
 * 1. Outcome failure signature harvesting from verification mismatches and error budgets
 * 2. Deterministic clustering and typed candidate proposals (prohibiting rewrite_agent)
 * 3. Sandboxed golden suite replay simulation resolving S21 (zero regressions policy)
 * 4. Human approval gating, role authorization, and Ed25519 Proof receipts
 * 5. Proposal rejection with human reason and Proof receipt
 * 6. Deterministic session-bucket canary routing
 * 7. Canary telemetry monitoring, automated rollback, and Attention Center P1 escalation
 * 8. Canary promotion to 100% production traffic
 * 9. REST API routes integration (/api/v1/adaptation/*)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { db } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { GovernedAdaptationService } from '../../src/adaptation/services/governedAdaptationService.js';
import { AdaptationRepository } from '../../src/adaptation/repositories/adaptationRepository.js';
import { FailureClusteringService } from '../../src/adaptation/services/failureClusteringService.js';
import { RemediationProposalService } from '../../src/adaptation/services/remediationProposalService.js';
import {
  AdaptationSimulationEngine,
  createProductionReplayEvaluator,
} from '../../src/adaptation/services/adaptationSimulationEngine.js';
import { FailureHarvestingService } from '../../src/adaptation/services/failureHarvestingService.js';
import { AdaptationCanaryRouter } from '../../src/adaptation/canary/adaptationCanaryRouter.js';
import { adaptationRoutes } from '../../src/api/routes/adaptationRoutes.js';
import { verifyReceiptOffline } from '../../src/trust/proof/proofService.js';
import { JwtService } from '../../src/security/auth/jwt.js';

describe('Governed Adaptation Production Suite (WP-6.4)', () => {
  let app: FastifyInstance;
  let repo: AdaptationRepository;
  let clustering: FailureClusteringService;
  let proposer: RemediationProposalService;
  let simulator: AdaptationSimulationEngine;
  let harvester: FailureHarvestingService;
  let canaryRouter: AdaptationCanaryRouter;
  let adaptationService: GovernedAdaptationService;

  const tenantId = 'tenant_prod_adapt_01';
  let adminToken: string;
  let ownerToken: string;
  let viewerToken: string;

  beforeEach(async () => {
    const client = db.getClient();
    const migrator = new SchemaMigrator(client);
    await migrator.applyMigrations();

    // 1. Seed tenant fixture
    await client.execute(
      `INSERT OR IGNORE INTO tenants (id, name, slug, status, created_at, updated_at)
       VALUES (?, ?, ?, 'active', datetime('now'), datetime('now'));`,
      [tenantId, 'Adaptation Clinic', 'adaptation-clinic']
    );

    await client.execute(`DELETE FROM failure_signatures WHERE tenant_id = ?;`, [tenantId]);
    await client.execute(`DELETE FROM adaptation_proposals WHERE tenant_id = ?;`, [tenantId]);
    await client.execute(`DELETE FROM adaptation_canary_evaluations WHERE tenant_id = ?;`, [tenantId]);
    await client.execute(`DELETE FROM verification_jobs WHERE tenant_id = ?;`, [tenantId]);
    await client.execute(`DELETE FROM agent_error_budgets WHERE tenant_id = ?;`, [tenantId]);
    await client.execute(`DELETE FROM attention_items WHERE tenant_id = ?;`, [tenantId]);

    // 2. Initialize Services
    repo = new AdaptationRepository(client);
    clustering = new FailureClusteringService(repo, 2);
    proposer = new RemediationProposalService(repo);
    simulator = new AdaptationSimulationEngine(repo, undefined, createProductionReplayEvaluator());
    harvester = new FailureHarvestingService(clustering, client);
    canaryRouter = new AdaptationCanaryRouter(repo);

    adaptationService = new GovernedAdaptationService(
      repo,
      clustering,
      proposer,
      simulator,
      harvester,
      canaryRouter
    );

    // 3. Auth Tokens
    adminToken = JwtService.sign({
      userId: 'admin_1',
      tenantId,
      email: 'admin@clinic.com',
      roles: ['admin'],
    });

    ownerToken = JwtService.sign({
      userId: 'owner_1',
      tenantId,
      email: 'owner@clinic.com',
      roles: ['owner'],
    });

    viewerToken = JwtService.sign({
      userId: 'viewer_1',
      tenantId,
      email: 'viewer@clinic.com',
      roles: ['read_only'],
    });

    // 4. Initialize Fastify Server
    app = Fastify({ logger: false });
    await app.register(adaptationRoutes);
    await app.ready();
  });

  // ============================================================================
  // Suite 1: Outcome Failure Signature Harvesting
  // ============================================================================
  describe('1. Outcome Failure Signature Harvesting', () => {
    it('harvests failure signatures from verification mismatches and error budgets', async () => {
      const client = db.getClient();

      // Seed a verification job mismatch (WP-4.6, migration 043)
      await client.execute(
        `INSERT INTO verification_jobs (
           id, tenant_id, run_id, tool_slug, action_input_json, action_output_json, idempotency_key,
           status, attempts, max_attempts, deadline_at, next_check_at, error_message, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 'mismatch', 1, 5, datetime('now', '+1 hour'), datetime('now'), ?, datetime('now'), datetime('now'));`,
        [
          'vjob_test_01',
          tenantId,
          'run_01',
          'scheduling_book_slot',
          '{}',
          '{}',
          'idem_test_01',
          'External calendar returned conflict slot 10:00 AM',
        ]
      );

      // Seed a throttled agent error budget (WP-6.3, migration 053)
      await client.execute(
        `INSERT OR REPLACE INTO agent_error_budgets (
           id, tenant_id, agent_slug, configured_tier_cap, effective_tier_cap, is_throttled,
           consecutive_failures, throttled_reason, sample_count, last_evaluated_at, created_at, updated_at
         ) VALUES (?, ?, ?, 'T2', 'T1', 1, 3, 'Consecutive verification failures reached threshold', 5, datetime('now'), datetime('now'), datetime('now'));`,
        ['budget_test_01', tenantId, 'payments']
      );

      const result = await adaptationService.harvestFromOutcomes(tenantId);

      expect(result.tenantId).toBe(tenantId);
      expect(result.harvestedSignaturesCount).toBeGreaterThanOrEqual(2);
      expect(result.clusters.length).toBeGreaterThanOrEqual(2);

      const schedulingCluster = result.clusters.find((c) => c.agentSlug === 'scheduling');
      expect(schedulingCluster).toBeDefined();
      expect(schedulingCluster?.failureClass).toBe('tool_failure');

      const paymentsCluster = result.clusters.find((c) => c.agentSlug === 'payments');
      expect(paymentsCluster).toBeDefined();
      expect(paymentsCluster?.failureClass).toBe('model_failure');
    });
  });

  // ============================================================================
  // Suite 2: Candidate Proposals & Strict Governance Bounds
  // ============================================================================
  describe('2. Candidate Proposals & Strict Governance Bounds', () => {
    it('generates a typed new_skill proposal replacing model judgment with deterministic code', async () => {
      await clustering.ingestFailureSignature({
        tenantId,
        failureClass: 'bad_input',
        businessType: 'clinic',
        agentId: 'agent_intake_01',
        agentSlug: 'intake',
        stage: 'phone_formatting',
        rootCause: 'Model failed to parse non-standard E.164 phone format',
        frequency: 3,
        costUsd: 0.03,
        customerImpact: 'medium',
        modelTier: 'T1',
      });

      const clusters = await clustering.getClusters(tenantId);
      const cluster = clusters[0];
      expect(cluster.candidateReady).toBe(true);

      const proposal = await proposer.proposeConvertJudgmentToSkill({
        tenantId,
        scope: 'tenant',
        cluster,
        skillSlug: 'normalize_phone_e164',
        skillName: 'E.164 Normalizer',
        inputSchema: { phone: 'string' },
        outputSchema: { e164: 'string', valid: 'boolean' },
        validationCodeSnippet: 'return parsePhone(input.phone);',
      });

      expect(proposal.proposalType).toBe('new_skill');
      expect(proposal.requiresHumanApproval).toBe(true);
      expect(proposal.proposedChanges.deterministicZeroToken).toBe(true);
      expect(proposal.simulationStatus).toBe('pending');
      expect(proposal.approvalStatus).toBe('pending');
    });

    it('strictly rejects "rewrite_agent" or untyped prompt overhauls (§6)', async () => {
      const cluster = {
        clusterId: 'cluster_fake',
        failureClass: 'model_failure' as const,
        agentSlug: 'intake',
        rootCause: 'unpredictable model output',
        signatureIds: ['sig_fake'],
        totalOccurrences: 4,
        totalCostUsd: 0.05,
        dominantModelTier: 'T2' as const,
        candidateReady: true,
      };

      await expect(
        proposer.generateProposal({
          tenantId,
          scope: 'tenant',
          cluster,
          proposalType: 'rewrite_agent' as any,
          title: 'Rewrite Entire Agent Prompt',
          description: 'Untyped prompt rewriting',
          proposedChanges: { newSystemPrompt: 'You are an all-new agent' },
        })
      ).rejects.toThrow(/Prohibition: "Rewrite the agent"/);
    });
  });

  // ============================================================================
  // Suite 3: Sandboxed Golden Suite Replay Simulation (S21 Resolution)
  // ============================================================================
  describe('3. Sandboxed Golden Suite Replay Simulation (S21)', () => {
    it('successfully evaluates candidate against agent golden suite with zero regressions', async () => {
      // Ingest and cluster
      await clustering.ingestFailureSignature({
        tenantId,
        failureClass: 'capability_gap',
        businessType: 'clinic',
        agentId: 'agent_scheduling_01',
        agentSlug: 'scheduling',
        stage: 'double_booking_check',
        rootCause: 'Model missed appointment book conflict window',
        frequency: 2,
        costUsd: 0.04,
        customerImpact: 'high',
        modelTier: 'T1',
      });

      const [cluster] = await clustering.getClusters(tenantId);

      const proposal = await proposer.generateProposal({
        tenantId,
        scope: 'tenant',
        cluster,
        proposalType: 'routing_rule',
        title: 'Upgrade Scheduling Conflict Check to Certified T2 Model',
        description: 'Ensures strict atomic conflict validation',
        proposedChanges: {
          targetTier: 'T2',
          certifiedModelRouting: true,
        },
      });

      // Run simulation using production replay evaluator
      const sim = await simulator.simulateProposal(proposal.id);

      expect(sim.validation.passed).toBe(true);
      expect(sim.validation.goldenSuiteRegressions).toBe(0);
      expect(sim.validation.fixedTargetFailureCount).toBeGreaterThan(0);
      expect(sim.proposal.simulationStatus).toBe('passed');
    });

    it('blocks approval and flags regressed when proposal breaks safety or golden checks', async () => {
      await clustering.ingestFailureSignature({
        tenantId,
        failureClass: 'bad_input',
        businessType: 'clinic',
        agentId: 'agent_intake_01',
        agentSlug: 'intake',
        stage: 'emergency_triage',
        rootCause: 'Intake misclassified urgent triage',
        frequency: 3,
        costUsd: 0.05,
        customerImpact: 'critical',
        modelTier: 'T2',
      });

      const [cluster] = await clustering.getClusters(tenantId);

      const proposal = await proposer.generateProposal({
        tenantId,
        scope: 'tenant',
        cluster,
        proposalType: 'policy_tightening',
        title: 'Disable emergency bypass to reduce false positives',
        description: 'Dangerous proposal that disables emergency bypass',
        proposedChanges: {
          disableEmergencyBypass: true, // triggers regression check in evaluator
        },
      });

      const sim = await simulator.simulateProposal(proposal.id);

      expect(sim.validation.passed).toBe(false);
      expect(sim.validation.goldenSuiteRegressions).toBeGreaterThan(0);
      expect(sim.proposal.simulationStatus).toBe('regressed');

      // Attempting approval MUST throw Gating violation
      await expect(
        adaptationService.approveProposal({
          proposalId: proposal.id,
          approvedBy: 'admin_user',
          userRole: 'admin',
        })
      ).rejects.toThrow(/Gating violation: Proposal .* has not passed golden suite simulation/);
    });
  });

  // ============================================================================
  // Suite 4: Human Approval Gating & Cryptographic Proof Receipts
  // ============================================================================
  describe('4. Human Approval Gating & Proof Receipts', () => {
    it('approves simulated proposal, generates immutable version tag, and emits Ed25519 proof receipt', async () => {
      // Create and simulate passing proposal
      await clustering.ingestFailureSignature({
        tenantId,
        failureClass: 'transient',
        businessType: 'clinic',
        agentId: 'agent_payments_01',
        agentSlug: 'payments',
        stage: 'payment_link',
        rootCause: 'Transient gateway timeout',
        frequency: 2,
        costUsd: 0.02,
        customerImpact: 'medium',
        modelTier: 'T2',
      });

      const [cluster] = await clustering.getClusters(tenantId);
      const proposal = await proposer.generateProposal({
        tenantId,
        scope: 'tenant',
        cluster,
        proposalType: 'retry_timing',
        title: 'Optimize Payment Gateway Retries',
        description: 'Increase timeout to 6000ms with exponential backoff',
        proposedChanges: {
          timeoutMs: 6000,
          maxRetries: 3,
          backoffMultiplierMs: 1500,
        },
      });

      await simulator.simulateProposal(proposal.id);

      const approved = await adaptationService.approveProposal({
        proposalId: proposal.id,
        approvedBy: 'human_operator_42',
        userRole: 'admin',
        initialCanaryWeightPct: 15,
      });

      expect(approved.proposal.approvalStatus).toBe('approved');
      expect(approved.proposal.deployedVersionTag).toMatch(/^v_adapt_retry_timing_/);
      expect(approved.canaryEval.status).toBe('canary_active');
      expect(approved.canaryEval.canaryWeightPct).toBe(15);

      // Verify that an Ed25519 proof receipt was written to proof_receipts table
      const client = db.getClient();
      const receipts = await client.query<any>(
        `SELECT * FROM proof_receipts WHERE tenant_id = ? AND action_type = 'adaptation.proposal_approved' ORDER BY sequence DESC LIMIT 1;`,
        [tenantId]
      );

      expect(receipts.length).toBe(1);
      const receipt = receipts[0];
      expect(receipt.action_type).toBe('adaptation.proposal_approved');
      expect(receipt.risk_tier).toBe('T2');

      // Verify signature offline
      const keyRow = await client.queryOne<any>(
        `SELECT public_key_pem FROM proof_signing_keys WHERE key_id = ?;`,
        [receipt.key_id]
      );
      expect(keyRow).toBeDefined();

      const verification = verifyReceiptOffline(
        {
          body: JSON.parse(receipt.body_json),
          hash: receipt.hash,
          keyId: receipt.key_id,
          signature: receipt.signature,
        },
        keyRow.public_key_pem
      );
      expect(verification.valid).toBe(true);
    });

    it('rejects proposal when role is unauthorized (Platform scope requires owner)', async () => {
      const cluster = {
        clusterId: 'cluster_platform',
        failureClass: 'capability_gap' as const,
        agentSlug: 'intake',
        rootCause: 'Platform model mapping',
        signatureIds: ['sig_p1'],
        totalOccurrences: 3,
        totalCostUsd: 0.05,
        dominantModelTier: 'T2' as const,
        candidateReady: true,
      };

      const proposal = await proposer.generateProposal({
        tenantId,
        scope: 'platform',
        cluster,
        proposalType: 'routing_rule',
        title: 'Platform Routing Rule Upgrade',
        description: 'Upgrade platform-level routing',
        proposedChanges: { targetTier: 'T3', certifiedModelRouting: true },
      });

      await simulator.simulateProposal(proposal.id);

      // Admin role is NOT sufficient for platform-scoped proposal
      await expect(
        adaptationService.approveProposal({
          proposalId: proposal.id,
          approvedBy: 'admin_user',
          userRole: 'admin',
        })
      ).rejects.toThrow(/Platform-scoped adaptation proposals require Owner role approval/);
    });
  });

  // ============================================================================
  // Suite 5: Proposal Rejection & Audit Receipts
  // ============================================================================
  describe('5. Proposal Rejection & Audit Receipts', () => {
    it('records explicit rejection with human reason and emits audit receipt', async () => {
      const [cluster] = await clustering.getClusters(tenantId);
      const proposal = await proposer.generateProposal({
        tenantId,
        scope: 'tenant',
        cluster: cluster || {
          clusterId: 'c1',
          failureClass: 'transient',
          agentSlug: 'payments',
          rootCause: 'timeout',
          signatureIds: ['s1'],
          totalOccurrences: 2,
          totalCostUsd: 0.01,
          dominantModelTier: 'T2',
          candidateReady: true,
        },
        proposalType: 'policy_tightening',
        title: 'Excessive Policy Restriction',
        description: 'Unnecessary restrictions on customer refunds',
        proposedChanges: { strictnessLevel: 'high' },
      });

      const rejected = await adaptationService.rejectProposal({
        proposalId: proposal.id,
        rejectedBy: 'chief_risk_officer',
        userRole: 'admin',
        reason: 'Unacceptable increase in customer friction on routine refunds',
      });

      expect(rejected.approvalStatus).toBe('rejected');
      expect(rejected.metadata?.rejectionReason).toBe('Unacceptable increase in customer friction on routine refunds');

      const client = db.getClient();
      const receipts = await client.query<any>(
        `SELECT * FROM proof_receipts WHERE tenant_id = ? AND action_type = 'adaptation.proposal_rejected' LIMIT 1;`,
        [tenantId]
      );
      expect(receipts.length).toBe(1);
    });
  });

  // ============================================================================
  // Suite 6: Deterministic Canary Traffic Routing
  // ============================================================================
  describe('6. Deterministic Canary Traffic Routing', () => {
    it('deterministically partitions sessions based on canaryWeightPct', async () => {
      // Create approved proposal with canary weight = 20%
      const proposal = await proposer.generateProposal({
        tenantId,
        scope: 'tenant',
        cluster: {
          clusterId: 'c_canary',
          failureClass: 'bad_input',
          agentSlug: 'scheduling',
          rootCause: 'formatting',
          signatureIds: ['s_c1'],
          totalOccurrences: 2,
          totalCostUsd: 0.02,
          dominantModelTier: 'T2',
          candidateReady: true,
        },
        proposalType: 'retry_timing',
        title: 'Scheduling Canary Adaptation',
        description: 'Canary test proposal',
        proposedChanges: { timeoutMs: 5000 },
      });

      await simulator.simulateProposal(proposal.id);
      await adaptationService.approveProposal({
        proposalId: proposal.id,
        approvedBy: 'operator_1',
        userRole: 'admin',
        initialCanaryWeightPct: 20,
      });

      // Sample 100 deterministic sessions
      let canaryCount = 0;
      for (let i = 0; i < 100; i++) {
        const decision = await canaryRouter.shouldRouteToCanary(tenantId, `session_${i}`, 'scheduling');
        if (decision.routeToCanary) {
          canaryCount++;
          expect(decision.versionTag).toMatch(/^v_adapt_retry_timing_/);
          expect(decision.canaryWeightPct).toBe(20);
        }
      }

      // 20% hash sampling across 100 sessions produces a realistic slice (between 10% and 35%)
      expect(canaryCount).toBeGreaterThanOrEqual(10);
      expect(canaryCount).toBeLessThanOrEqual(35);

      // Verify idempotency: same session always routes to the same target
      const session1 = await canaryRouter.shouldRouteToCanary(tenantId, 'fixed_session_xyz', 'scheduling');
      const session2 = await canaryRouter.shouldRouteToCanary(tenantId, 'fixed_session_xyz', 'scheduling');
      expect(session1.routeToCanary).toBe(session2.routeToCanary);
    });
  });

  // ============================================================================
  // Suite 7: Canary Telemetry Evaluation & Automated Rollback
  // ============================================================================
  describe('7. Canary Telemetry Evaluation & Automated Rollback', () => {
    it('triggers emergency automated rollback, P1 Attention escalation, and proof receipt on error spike', async () => {
      const proposal = await proposer.generateProposal({
        tenantId,
        scope: 'tenant',
        cluster: {
          clusterId: 'c_fail',
          failureClass: 'tool_failure',
          agentSlug: 'payments',
          rootCause: 'gateway issue',
          signatureIds: ['sf1'],
          totalOccurrences: 2,
          totalCostUsd: 0.02,
          dominantModelTier: 'T2',
          candidateReady: true,
        },
        proposalType: 'retry_timing',
        title: 'Payment Gateway Retry Tuning',
        description: 'Adjust retry delays',
        proposedChanges: { timeoutMs: 5000 },
      });

      await simulator.simulateProposal(proposal.id);
      await adaptationService.approveProposal({
        proposalId: proposal.id,
        approvedBy: 'lead_engineer',
        userRole: 'admin',
        initialCanaryWeightPct: 10,
      });

      // Evaluate telemetry with error rate spike (8.0% error rate > 5.0% threshold)
      const evaluation = await adaptationService.evaluateCanary({
        proposalId: proposal.id,
        baselineMetrics: {
          totalRequests: 1000,
          errorCount: 10,
          escalationCount: 15,
          errorRatePct: 1.0,
          escalationRatePct: 1.5,
          p99LatencyMs: 300,
        },
        canaryMetrics: {
          totalRequests: 100,
          errorCount: 8, // 8% error rate!
          escalationCount: 2,
          errorRatePct: 8.0,
          escalationRatePct: 2.0,
          p99LatencyMs: 320,
        },
      });

      expect(evaluation.status).toBe('rolled_back');
      expect(evaluation.canaryWeightPct).toBe(0);
      expect(evaluation.regressionDetected).toBe(true);
      expect(evaluation.rollbackReason).toContain('Canary error rate (8.00%) exceeded safety threshold');

      // Verify that Attention Center received P1 escalation
      const client = db.getClient();
      const attentionItems = await client.query<any>(
        `SELECT * FROM attention_items WHERE correlation_id = ?;`,
        [`canary_rollback_${proposal.id}`]
      );
      expect(attentionItems.length).toBe(1);
      expect(attentionItems[0].priority).toBe('P1_HIGH');

      // Verify proof receipt for rollback
      const receipts = await client.query<any>(
        `SELECT * FROM proof_receipts WHERE tenant_id = ? AND action_type = 'adaptation.canary_rollback' LIMIT 1;`,
        [tenantId]
      );
      expect(receipts.length).toBe(1);
    });

    it('advances healthy canary traffic through 10% -> 50% -> 100% promotion', async () => {
      const proposal = await proposer.generateProposal({
        tenantId,
        scope: 'tenant',
        cluster: {
          clusterId: 'c_promo',
          failureClass: 'model_failure',
          agentSlug: 'document',
          rootCause: 'extraction',
          signatureIds: ['sp1'],
          totalOccurrences: 2,
          totalCostUsd: 0.02,
          dominantModelTier: 'T1',
          candidateReady: true,
        },
        proposalType: 'extraction_correction',
        title: 'Prescription Date Extraction Correction',
        description: 'Regex improvement for dates',
        proposedChanges: { regexRule: '\\d{4}-\\d{2}-\\d{2}' },
      });

      await simulator.simulateProposal(proposal.id);
      await adaptationService.approveProposal({
        proposalId: proposal.id,
        approvedBy: 'lead_engineer',
        userRole: 'admin',
        initialCanaryWeightPct: 10,
      });

      const healthyBaseline = {
        totalRequests: 1000,
        errorCount: 10,
        escalationCount: 20,
        errorRatePct: 1.0,
        escalationRatePct: 2.0,
        p99LatencyMs: 250,
      };

      const healthyCanary = {
        totalRequests: 200,
        errorCount: 1, // 0.5% error rate
        escalationCount: 2, // 1% escalation
        errorRatePct: 0.5,
        escalationRatePct: 1.0,
        p99LatencyMs: 220,
      };

      // Turn 1: 10% -> 50%
      const step1 = await adaptationService.evaluateCanary({
        proposalId: proposal.id,
        baselineMetrics: healthyBaseline,
        canaryMetrics: healthyCanary,
      });
      expect(step1.status).toBe('canary_active');
      expect(step1.canaryWeightPct).toBe(50);

      // Turn 2: 50% -> 100% Promoted
      const step2 = await adaptationService.evaluateCanary({
        proposalId: proposal.id,
        baselineMetrics: healthyBaseline,
        canaryMetrics: healthyCanary,
      });
      expect(step2.status).toBe('promoted');
      expect(step2.canaryWeightPct).toBe(100);

      // Verify promotion proof receipt
      const client = db.getClient();
      const receipts = await client.query<any>(
        `SELECT * FROM proof_receipts WHERE tenant_id = ? AND action_type = 'adaptation.canary_promoted' LIMIT 1;`,
        [tenantId]
      );
      expect(receipts.length).toBe(1);
    });
  });

  // ============================================================================
  // Suite 8: REST API Routes Integration
  // ============================================================================
  describe('8. REST API Endpoints Integration', () => {
    it('POST /api/v1/adaptation/harvest triggers outcome failure harvesting', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/adaptation/harvest',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { windowHours: 72, candidateThreshold: 2 },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.tenantId).toBe(tenantId);
      expect(Array.isArray(body.clusters)).toBe(true);
    });

    it('POST /api/v1/adaptation/proposals/:id/simulate triggers sandboxed simulation', async () => {
      const cluster = (await clustering.getClusters(tenantId))[0] || {
        clusterId: 'api_cluster',
        failureClass: 'transient',
        agentSlug: 'intake',
        rootCause: 'network drop',
        signatureIds: ['s_api_1'],
        totalOccurrences: 2,
        totalCostUsd: 0.02,
        dominantModelTier: 'T1',
        candidateReady: true,
      };

      const proposal = await proposer.generateProposal({
        tenantId,
        scope: 'tenant',
        cluster,
        proposalType: 'retry_timing',
        title: 'API Test Proposal',
        description: 'Testing simulation via REST API',
        proposedChanges: { timeoutMs: 5000, maxRetries: 2 },
      });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/adaptation/proposals/${proposal.id}/simulate`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.proposal.simulationStatus).toBe('passed');
      expect(body.validation.passed).toBe(true);
    });

    it('POST /api/v1/adaptation/proposals/:id/approve gates unsimulated proposals', async () => {
      const unsimulatedProposal = await proposer.generateProposal({
        tenantId,
        scope: 'tenant',
        cluster: {
          clusterId: 'c_raw',
          failureClass: 'bad_input',
          agentSlug: 'intake',
          rootCause: 'untested',
          signatureIds: ['s_raw'],
          totalOccurrences: 2,
          totalCostUsd: 0.01,
          dominantModelTier: 'T1',
          candidateReady: true,
        },
        proposalType: 'policy_tightening',
        title: 'Unsimulated Proposal',
        description: 'Should fail approval',
        proposedChanges: { strictnessLevel: 'high' },
      });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/adaptation/proposals/${unsimulatedProposal.id}/approve`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { reason: 'Approving without simulation', canaryInitialWeightPct: 10 },
      });

      expect(res.statusCode).toBe(500); // Gating violation thrown
    });

    it('POST /api/v1/adaptation/proposals/:id/reject rejects proposal with human reason', async () => {
      const proposal = await proposer.generateProposal({
        tenantId,
        scope: 'tenant',
        cluster: {
          clusterId: 'c_rej',
          failureClass: 'transient',
          agentSlug: 'payments',
          rootCause: 'timeout',
          signatureIds: ['s_rej'],
          totalOccurrences: 2,
          totalCostUsd: 0.01,
          dominantModelTier: 'T2',
          candidateReady: true,
        },
        proposalType: 'retry_timing',
        title: 'Proposal to Reject',
        description: 'Testing rejection endpoint',
        proposedChanges: { timeoutMs: 5000 },
      });

      const res = await app.inject({
        method: 'POST',
        url: `/api/v1/adaptation/proposals/${proposal.id}/reject`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: { reason: 'Redundant with existing retry policy' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.proposal.approvalStatus).toBe('rejected');
    });

    it('GET /api/v1/adaptation/canary/status/:agentSlug returns routing status', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/adaptation/canary/status/intake?sessionId=session_123',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(typeof body.routeToCanary).toBe('boolean');
    });
  });
});
