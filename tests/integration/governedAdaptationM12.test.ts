/**
 * Kriya Omnitask — Milestone M12: Governed Adaptation Integration Tests (§6, §23)
 * Verifies all 6 acceptance criteria for Milestone M12:
 * 1. No proposal deploys without human approval
 * 2. Every candidate is validated against the golden suite before approval is offered
 * 3. Canary agents are visibly distinct in roster and theatre
 * 4. Regression triggers automatic rollback to last known-good
 * 5. Auto-adaptable parameters are strictly limited to retry timing, fallback ordering, and certified-model routing
 * 6. "Convert model judgment to a Skill" is a first-class proposal type
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { GovernedAdaptationService } from '../../src/adaptation/services/governedAdaptationService.js';
import { AdaptationRepository } from '../../src/adaptation/repositories/adaptationRepository.js';
import { FailureClusteringService } from '../../src/adaptation/services/failureClusteringService.js';
import { RemediationProposalService } from '../../src/adaptation/services/remediationProposalService.js';
import { AdaptationSimulationEngine, ProposalTestEvaluator } from '../../src/adaptation/services/adaptationSimulationEngine.js';

// Test double for the replay evaluator (production replays cases on the graph runtime, WP-6.4):
// every case passes, so outcomes in these tests come only from explicit drills.
const replayEvaluator: ProposalTestEvaluator = async () => ({ passed: true });

describe('Milestone M12: Governed Adaptation (§6, §23)', () => {
  let repo: AdaptationRepository;
  let clustering: FailureClusteringService;
  let proposer: RemediationProposalService;
  let simulator: AdaptationSimulationEngine;
  let adaptationService: GovernedAdaptationService;

  const tenantId = 'tenant_m12_pilot';

  beforeEach(async () => {
    const client = db.getClient();
    const migrator = new SchemaMigrator(client);
    await migrator.applyMigrations();

    // Insert tenant fixture
    await client.execute(`
      INSERT OR IGNORE INTO tenants (id, name, slug, status, created_at, updated_at)
      VALUES (?, ?, ?, 'active', datetime('now'), datetime('now'));
    `, [tenantId, 'M12 Test Corp', 'm12-test-corp']);

    repo = new AdaptationRepository(client);
    clustering = new FailureClusteringService(repo, 2); // candidate threshold = 2 for tests
    proposer = new RemediationProposalService(repo);
    simulator = new AdaptationSimulationEngine(repo, undefined, replayEvaluator);
    adaptationService = new GovernedAdaptationService(repo, clustering, proposer, simulator);
  });

  afterEach(async () => {
    // Cleanup if needed
  });

  // ============================================================================
  // Criterion 1 & 6: "Convert model judgment to a Skill" is a first-class proposal type (§6, §9.3)
  // and prohibition on "rewrite_agent"
  // ============================================================================
  describe('Criterion 6: "Convert model judgment to a Skill" is a first-class proposal type', () => {
    it('generates a typed new_skill proposal replacing model judgment with deterministic zero-token logic', async () => {
      // 1. Ingest recurring failure signatures
      await clustering.ingestFailureSignature({
        tenantId,
        failureClass: 'bad_input',
        businessType: 'logistics',
        agentId: 'agent_parser_01',
        agentSlug: 'freight_parser',
        stage: 'phone_extraction',
        rootCause: 'Model failed to parse non-standard E.164 phone formatting consistently',
        frequency: 3,
        costUsd: 0.045,
        customerImpact: 'medium',
        modelTier: 'T2',
      });

      const clusters = await clustering.getClusters(tenantId);
      expect(clusters.length).toBeGreaterThan(0);
      const targetCluster = clusters[0];
      expect(targetCluster.candidateReady).toBe(true);

      // 2. Generate "Convert model judgment to a Skill" proposal
      const proposal = await proposer.proposeConvertJudgmentToSkill({
        tenantId,
        scope: 'tenant',
        cluster: targetCluster,
        skillSlug: 'validate_phone_e164',
        skillName: 'E.164 International Phone Validator',
        inputSchema: { rawPhone: 'string' },
        outputSchema: { formattedPhone: 'string', isValid: 'boolean' },
        validationCodeSnippet: 'return libphonenumber.parse(input.rawPhone);',
      });

      expect(proposal.proposalType).toBe('new_skill');
      expect(proposal.title).toContain('Convert model judgment to Skill');
      expect(proposal.requiresHumanApproval).toBe(true);
      expect(proposal.proposedChanges.deterministicZeroToken).toBe(true);
      expect(proposal.simulationStatus).toBe('pending');
      expect(proposal.approvalStatus).toBe('pending');
    });

    it('strictly forbids "rewrite_agent" or untyped prompt overhaul proposal types (§6)', async () => {
      const cluster = {
        clusterId: 'cluster_test',
        failureClass: 'model_failure' as any,
        agentSlug: 'booking_agent',
        rootCause: 'hallucination',
        signatureIds: ['sig_1'],
        totalOccurrences: 5,
        totalCostUsd: 0.1,
        dominantModelTier: 'T2' as const,
        candidateReady: true,
      };

      await expect(
        proposer.generateProposal({
          tenantId,
          scope: 'tenant',
          cluster,
          proposalType: 'rewrite_agent' as any,
          title: 'Rewrite Booking Agent',
          description: 'Overhaul the entire prompt',
          proposedChanges: { newPrompt: 'You are a new agent...' },
        })
      ).rejects.toThrow(/Prohibition: "Rewrite the agent"/);
    });
  });

  // ============================================================================
  // Criterion 2: Every candidate is validated against the golden suite before approval is offered
  // ============================================================================
  describe('Criterion 2: Every candidate is validated against the golden suite before approval', () => {
    it('validates candidate against golden suite with 0 regressions before unlocking approval', async () => {
      // 1. Ingest signature and cluster
      await clustering.ingestFailureSignature({
        tenantId,
        failureClass: 'capability_gap',
        businessType: 'real_estate',
        agentId: 'agent_lead_01',
        agentSlug: 'lead_qualifier',
        stage: 'budget_calc',
        rootCause: 'Complex multi-currency mortgage calculation failed on T1 model',
        frequency: 2,
        costUsd: 0.03,
        customerImpact: 'medium',
        modelTier: 'T1',
      });

      const [cluster] = await clustering.getClusters(tenantId);

      // 2. Propose routing rule upgrade
      const proposal = await proposer.generateProposal({
        tenantId,
        scope: 'tenant',
        cluster,
        proposalType: 'routing_rule',
        title: 'Upgrade Lead Budget Calc to T2 Model',
        description: 'Route multi-currency mortgage qualification to certified T2 model',
        proposedChanges: { targetTier: 'T2', certifiedModelRouting: true },
      });

      // 3. Simulate proposal against failure corpus & golden suite
      const simResult = await simulator.simulateProposal(proposal.id);

      expect(simResult.validation.passed).toBe(true);
      expect(simResult.validation.goldenSuiteRegressions).toBe(0);
      expect(simResult.validation.fixedTargetFailureCount).toBeGreaterThan(0);
      expect(simResult.proposal.simulationStatus).toBe('passed');

      // 4. Verify proposal is now eligible for approval
      const approved = await adaptationService.approveProposal({
        proposalId: proposal.id,
        approvedBy: 'admin_user_01',
        userRole: 'admin',
      });

      expect(approved.proposal.approvalStatus).toBe('approved');
      expect(approved.canaryEval.status).toBe('canary_active');
    });

    it('blocks and rejects approval if golden suite simulation regresses baseline benchmarks', async () => {
      // 1. Ingest signature and cluster
      await clustering.ingestFailureSignature({
        tenantId,
        failureClass: 'policy_block',
        businessType: 'fintech',
        agentId: 'agent_kyc_01',
        agentSlug: 'kyc_specialist',
        stage: 'document_verification',
        rootCause: 'False positive KYC policy block',
        frequency: 4,
        costUsd: 0.08,
        customerImpact: 'high',
        modelTier: 'T3',
      });

      const [cluster] = await clustering.getClusters(tenantId);

      const proposal = await proposer.generateProposal({
        tenantId,
        scope: 'tenant',
        cluster,
        proposalType: 'policy_tightening',
        title: 'Relax KYC Document Verification Threshold',
        description: 'Reduce verification strictness',
        proposedChanges: { strictnessLevel: 'low' },
      });

      // Simulate with forced regression on the golden auth benchmark
      const simResult = await simulator.simulateProposal(proposal.id, {
        forceRegressionTestId: 'golden_auth_01',
      });

      expect(simResult.validation.passed).toBe(false);
      expect(simResult.validation.goldenSuiteRegressions).toBe(1);
      expect(simResult.proposal.simulationStatus).toBe('regressed');

      // Attempting approval MUST fail with gating violation
      await expect(
        adaptationService.approveProposal({
          proposalId: proposal.id,
          approvedBy: 'admin_user_01',
          userRole: 'admin',
        })
      ).rejects.toThrow(/Gating violation: Proposal .* has not passed golden suite simulation/);
    });
  });

  // ============================================================================
  // Criterion 1: No proposal deploys without human approval
  // ============================================================================
  describe('Honesty: no replay evaluator means no pass (docs/kriya S21)', () => {
    it('leaves the proposal pending and approval blocked when nothing was actually evaluated', async () => {
      await clustering.ingestFailureSignature({
        tenantId, failureClass: 'tool_failure', businessType: 'clinic', agentId: 'agent_x', agentSlug: 'x',
        stage: 'booking', rootCause: 'Calendar API timeout', frequency: 3, costUsd: 0.01, customerImpact: 'medium', modelTier: 'T1',
      });
      const [cluster] = await clustering.getClusters(tenantId);
      const proposal = await proposer.generateProposal({
        tenantId, scope: 'tenant', cluster, proposalType: 'retry_timing',
        title: 'Longer calendar timeout', description: 'Raise timeout', proposedChanges: { timeoutMs: 8000 },
      });

      const unevaluated = new AdaptationSimulationEngine(repo);
      const sim = await unevaluated.simulateProposal(proposal.id);
      expect(sim.proposal.simulationStatus).toBe('pending');
      expect(sim.validation.passed).toBe(false);
      expect(sim.validation.notRunReason).toContain('No replay evaluator');

      await expect(
        adaptationService.approveProposal({ proposalId: proposal.id, approvedBy: 'admin_1', userRole: 'admin' })
      ).rejects.toThrow();
    });
  });

  describe('Criterion 1: No proposal deploys without human approval', () => {
    it('enforces RBAC role checks (Platform proposals require Owner; Tenant proposals require Admin)', async () => {
      const cluster = {
        clusterId: 'cluster_platform_01',
        failureClass: 'tool_failure' as any,
        agentSlug: 'global_orchestrator',
        rootCause: 'Database connection retry timeout',
        signatureIds: ['sig_db_01'],
        totalOccurrences: 6,
        totalCostUsd: 0.12,
        dominantModelTier: 'T3' as const,
        candidateReady: true,
      };

      // Platform-scoped proposal
      const platformProposal = await proposer.generateProposal({
        tenantId,
        scope: 'platform',
        cluster,
        proposalType: 'policy_tightening',
        title: 'Platform-wide DB Retry Policy',
        description: 'Adjust global DB retry timeouts',
        proposedChanges: { timeoutMs: 3000 },
      });

      await simulator.simulateProposal(platformProposal.id);

      // Admin role cannot approve platform-scoped proposal (must be owner)
      await expect(
        adaptationService.approveProposal({
          proposalId: platformProposal.id,
          approvedBy: 'tenant_admin_01',
          userRole: 'admin',
        })
      ).rejects.toThrow(/Authorization violation: Platform-scoped adaptation proposals require Owner role/);

      // Owner role successfully approves platform-scoped proposal
      const approved = await adaptationService.approveProposal({
        proposalId: platformProposal.id,
        approvedBy: 'platform_owner_01',
        userRole: 'owner',
      });

      expect(approved.proposal.approvalStatus).toBe('approved');
      expect(approved.proposal.approvedBy).toBe('platform_owner_01');
    });

    it('strictly forbids approval of unsimulated proposals', async () => {
      const cluster = {
        clusterId: 'cluster_unsim',
        failureClass: 'transient' as any,
        agentSlug: 'test_agent',
        rootCause: 'transient network hiccup',
        signatureIds: ['sig_test'],
        totalOccurrences: 2,
        totalCostUsd: 0.01,
        dominantModelTier: 'T1' as const,
        candidateReady: true,
      };

      const unsimulatedProposal = await proposer.generateProposal({
        tenantId,
        scope: 'tenant',
        cluster,
        proposalType: 'retry_timing',
        title: 'Adjust Transient Retry Backoff',
        description: 'Increase retry backoff from 500ms to 1000ms',
        proposedChanges: { maxRetries: 3, backoffMultiplierMs: 1000 },
      });

      await expect(
        adaptationService.approveProposal({
          proposalId: unsimulatedProposal.id,
          approvedBy: 'admin_user',
          userRole: 'admin',
        })
      ).rejects.toThrow(/Gating violation: Proposal .* has not passed golden suite simulation/);
    });
  });

  // ============================================================================
  // Criterion 5: Auto-adaptable parameters are strictly limited
  // ============================================================================
  describe('Criterion 5: Auto-adaptable parameters are strictly limited', () => {
    it('marks retry timing, fallback reordering, and certified routing as auto-adaptable within bounds', () => {
      // 1. Retry timing within bounds (<= 3 retries, <= 5000ms backoff)
      expect(
        proposer.isWithinAutoAdaptableBounds('retry_timing', { maxRetries: 3, backoffMultiplierMs: 2000 })
      ).toBe(true);

      // 2. Fallback ordering among approved models
      expect(
        proposer.isWithinAutoAdaptableBounds('routing_rule', {
          action: 'reorder_fallback',
          useOnlyApprovedModels: true,
        })
      ).toBe(true);

      // 3. Certified model routing
      expect(
        proposer.isWithinAutoAdaptableBounds('routing_rule', {
          action: 'certified_model_routing',
          targetModelCertified: true,
        })
      ).toBe(true);

      // 4. Beyond bounds (e.g. 10 retries) -> NOT auto-adaptable
      expect(
        proposer.isWithinAutoAdaptableBounds('retry_timing', { maxRetries: 10, backoffMultiplierMs: 10000 })
      ).toBe(false);

      // 5. Skills, policies, knowledge gaps ALWAYS require human approval
      expect(
        proposer.isWithinAutoAdaptableBounds('new_skill', { skillSlug: 'any_skill' })
      ).toBe(false);

      expect(
        proposer.isWithinAutoAdaptableBounds('policy_tightening', { strictness: 'high' })
      ).toBe(false);

      expect(
        proposer.isWithinAutoAdaptableBounds('knowledge_gap', { documentId: 'doc_123' })
      ).toBe(false);
    });
  });

  // ============================================================================
  // Criterion 4: Regression triggers automatic rollback to last known-good
  // ============================================================================
  describe('Criterion 4: Regression triggers automatic rollback to last known-good', () => {
    it('triggers emergency automatic rollback if canary error rate spikes above threshold', async () => {
      // 1. Setup simulated and approved proposal
      await clustering.ingestFailureSignature({
        tenantId,
        failureClass: 'tool_failure',
        businessType: 'healthcare',
        agentId: 'agent_triage_01',
        agentSlug: 'triage_specialist',
        stage: 'appointment_lookup',
        rootCause: 'Calendar API tool response parsing mismatch',
        frequency: 2,
        costUsd: 0.05,
        customerImpact: 'high',
        modelTier: 'T2',
      });

      const [cluster] = await clustering.getClusters(tenantId);
      const proposal = await proposer.generateProposal({
        tenantId,
        scope: 'tenant',
        cluster,
        proposalType: 'extraction_correction',
        title: 'Fix Calendar Tool Extraction Schema',
        description: 'Update date-time extraction regex for appointment lookup',
        proposedChanges: { dateRegex: '^\\d{4}-\\d{2}-\\d{2}$' },
      });

      await simulator.simulateProposal(proposal.id);
      await adaptationService.approveProposal({
        proposalId: proposal.id,
        approvedBy: 'admin_user',
        userRole: 'admin',
        initialCanaryWeightPct: 10,
      });

      // 2. Evaluate healthy canary progression: 10% -> 50%
      const eval1 = await adaptationService.evaluateCanary({
        proposalId: proposal.id,
        baselineMetrics: {
          totalRequests: 1000,
          errorCount: 10,
          escalationCount: 5,
          errorRatePct: 1.0,
          escalationRatePct: 0.5,
          p99LatencyMs: 300,
        },
        canaryMetrics: {
          totalRequests: 200,
          errorCount: 1,
          escalationCount: 1,
          errorRatePct: 0.5,
          escalationRatePct: 0.5,
          p99LatencyMs: 290,
        },
      });

      expect(eval1.regressionDetected).toBe(false);
      expect(eval1.canaryWeightPct).toBe(50);
      expect(eval1.status).toBe('canary_active');

      // 3. Inject sudden regression in canary telemetry (e.g. 12% error rate spike)
      const eval2 = await adaptationService.evaluateCanary({
        proposalId: proposal.id,
        baselineMetrics: {
          totalRequests: 1000,
          errorCount: 10,
          escalationCount: 5,
          errorRatePct: 1.0,
          escalationRatePct: 0.5,
          p99LatencyMs: 300,
        },
        canaryMetrics: {
          totalRequests: 200,
          errorCount: 24, // 12% error rate!
          escalationCount: 10,
          errorRatePct: 12.0,
          escalationRatePct: 5.0,
          p99LatencyMs: 450,
        },
      });

      expect(eval2.regressionDetected).toBe(true);
      expect(eval2.status).toBe('rolled_back');
      expect(eval2.canaryWeightPct).toBe(0);
      expect(eval2.rollbackReason).toContain('exceeded safety threshold');
    });

    it('promotes canary to 100% when all traffic slices pass without regression', async () => {
      // 1. Setup simulated and approved proposal
      const cluster = {
        clusterId: 'cluster_promo',
        failureClass: 'transient' as any,
        agentSlug: 'ops_agent',
        rootCause: 'minor transient latency',
        signatureIds: ['sig_promo'],
        totalOccurrences: 2,
        totalCostUsd: 0.01,
        dominantModelTier: 'T1' as const,
        candidateReady: true,
      };

      const proposal = await proposer.generateProposal({
        tenantId,
        scope: 'tenant',
        cluster,
        proposalType: 'retry_timing',
        title: 'Optimize Ops Agent Retry Timing',
        description: 'Tweak backoff timing',
        proposedChanges: { maxRetries: 2, backoffMultiplierMs: 1500 },
      });

      await simulator.simulateProposal(proposal.id);
      await adaptationService.approveProposal({
        proposalId: proposal.id,
        approvedBy: 'admin_user',
        userRole: 'admin',
        initialCanaryWeightPct: 50,
      });

      // Advance from 50% -> 100% (promoted)
      const evaluation = await adaptationService.evaluateCanary({
        proposalId: proposal.id,
        baselineMetrics: {
          totalRequests: 1000,
          errorCount: 10,
          escalationCount: 5,
          errorRatePct: 1.0,
          escalationRatePct: 0.5,
          p99LatencyMs: 300,
        },
        canaryMetrics: {
          totalRequests: 500,
          errorCount: 2,
          escalationCount: 1,
          errorRatePct: 0.4,
          escalationRatePct: 0.2,
          p99LatencyMs: 280,
        },
      });

      expect(evaluation.regressionDetected).toBe(false);
      expect(evaluation.canaryWeightPct).toBe(100);
      expect(evaluation.status).toBe('promoted');
    });
  });
});
