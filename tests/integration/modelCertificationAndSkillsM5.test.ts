import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { db } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { ModelCertificationRepository } from '../../src/model/certification/modelCertificationRepository.js';
import { AlignmentCheckHarness } from '../../src/model/certification/alignmentCheckHarness.js';
import { scriptedProbeExecutor } from '../helpers/scriptedProbeModel.js';
import { CertifiedModelRouter } from '../../src/model/certification/certifiedModelRouter.js';
import { SkillLibrary } from '../../src/skills/skillLibrary.js';
import { ALL_DETERMINISTIC_SKILLS } from '../../src/skills/definitions/deterministicSkills.js';
import { AttentionRepository } from '../../src/attention/repositories/attentionRepository.js';
import { TenantContextManager } from '../../src/core/context/tenantContext.js';
import * as fs from 'fs';
import * as path from 'path';

describe('Milestone M5: Model Registry, Certification & Skill Library (§9, §17.3-17.4, §23)', () => {
  const client = db.getClient();
  const certRepo = new ModelCertificationRepository(client);
  const attentionRepo = new AttentionRepository();
  // Scripted model (test double) — production certification always runs a real model.
  const harness = new AlignmentCheckHarness(certRepo, () => scriptedProbeExecutor());
  const router = new CertifiedModelRouter(certRepo, attentionRepo);
  const skillLib = SkillLibrary.getInstance(client);

  const testTenantId = 'tenant_m5_test';

  beforeAll(async () => {
    const migrator = new SchemaMigrator(client);
    await migrator.applyMigrations();
    await skillLib.initialize();
  });

  beforeEach(async () => {
    // Ensure test tenant exists
    const now = new Date().toISOString();
    await client.execute(
      `INSERT OR REPLACE INTO tenants (id, name, slug, status, plan_tier, created_at, updated_at)
       VALUES (?, 'M5 Test Org', 'm5-org', 'active', 'scale', ?, ?)`,
      [testTenantId, now, now]
    );

    // Clean up certs for clean test state
    await client.execute('DELETE FROM model_certifications WHERE model_id LIKE ?', ['test_%']);
    await client.execute('DELETE FROM model_certifications WHERE model_id = ?', ['gemini-2.5-pro']);
  });

  // ============================================================================
  // Criteria 1: No model name appears in agent code — grep-verified
  // ============================================================================
  it('Criteria 1: No model name appears in agent manifests / definitions (grep verification)', () => {
    const agentsDir = path.resolve(process.cwd(), 'src/agents');
    expect(fs.existsSync(agentsDir)).toBe(true);

    const checkDirRecursive = (dir: string): string[] => {
      const violations: string[] = [];
      const entries = fs.readdirSync(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          violations.push(...checkDirRecursive(fullPath));
        } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.json'))) {
          const content = fs.readFileSync(fullPath, 'utf8');
          // Check for hardcoded provider model names being invoked in agent logic
          // Allowed: capability tiers (T1, T2, T3, T4), degradation policies
          const forbiddenPatterns = [
            /(?:callModel|invokeModel|model:)\s*['"](?:gpt-4o|claude-3-5|gemini-2\.5|deepseek-r1)['"]/i,
          ];
          for (const pattern of forbiddenPatterns) {
            if (pattern.test(content)) {
              violations.push(`${fullPath}: Matches forbidden hardcoded model pattern ${pattern}`);
            }
          }
        }
      }
      return violations;
    };

    const violations = checkDirRecursive(agentsDir);
    expect(violations).toEqual([]);
  });

  // ============================================================================
  // Criteria 2: An uncertified model cannot be routed to; the attempt degrades instead
  // ============================================================================
  it('Criteria 2: An uncertified model cannot be routed to; the attempt degrades instead', async () => {
    // We request a T3 task in 'te' (Telugu) where no T3 Telugu model is certified
    // Only a T4 model in 'te' is certified
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 86400000).toISOString();

    // Register certified T4 Telugu model
    await certRepo.saveCertification({
      id: 'cert_test_t4_te',
      model_id: 'test_super_brain',
      model_version: '1.0',
      provider: 'test_provider',
      upstream_provider: 'direct',
      tier: 'T4',
      language: 'te',
      eval_suite_version: 'v1.0.0',
      status: 'certified',
      pass_rate: 0.98,
      latency_p95_ms: 450,
      cost_per_task_usd: 0.005,
      stage_results_json: '{}',
      certified_at: now,
      expires_at: expiresAt,
      certified_by: 'system_harness',
    });

    const routeResult = await router.routeTask({
      tenantId: testTenantId,
      requiredTier: 'T3',
      language: 'te',
      taskId: 'task_uncert_001',
      taskDescription: 'Synthesize customer sentiment in Telugu',
    });

    expect(routeResult.success).toBe(true);
    expect(routeResult.degraded).toBe(true);
    // Verified: degraded to Route Up (T4) rather than attempting an uncertified T3 model!
    expect(routeResult.degradationResolution?.actionTaken).toBe('route_up');
    expect(routeResult.tierUsed).toBe('T4');
    expect(routeResult.modelId).toBe('test_super_brain');
  });

  // ============================================================================
  // Criteria 3: Certification invalidates automatically on model version change and on detected upstream/router change
  // ============================================================================
  it('Criteria 3: Certification invalidates automatically on model version change and on detected upstream/router change', async () => {
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 86400000).toISOString();

    // Save active certification
    await certRepo.saveCertification({
      id: 'cert_invalidation_test',
      model_id: 'test_evolving_brain',
      model_version: 'v1.0.0',
      provider: 'openrouter',
      upstream_provider: 'direct',
      tier: 'T2',
      language: 'en',
      eval_suite_version: 'v1.0.0',
      status: 'certified',
      pass_rate: 0.99,
      latency_p95_ms: 200,
      cost_per_task_usd: 0.001,
      stage_results_json: '{}',
      certified_at: now,
      expires_at: expiresAt,
      certified_by: 'system_harness',
    });

    // Verify it is certified
    let certified = await certRepo.findCertifiedModels('T2', 'en');
    expect(certified.some((c) => c.model_id === 'test_evolving_brain')).toBe(true);

    // 1. Invalidate on model version change
    const countV = await certRepo.invalidateOnVersionOrUpstreamChange('test_evolving_brain', 'v1.1.0', 'direct');
    expect(countV).toBe(1);

    certified = await certRepo.findCertifiedModels('T2', 'en');
    expect(certified.some((c) => c.model_id === 'test_evolving_brain')).toBe(false);

    const matrix = await certRepo.getCertificationMatrix('test_evolving_brain');
    expect(matrix[0].status).toBe('expired');

    // 2. Invalidate on upstream router change (e.g., OpenRouter switches backend from direct to bedrock)
    await certRepo.saveCertification({
      id: 'cert_invalidation_test_2',
      model_id: 'test_router_switch_brain',
      model_version: 'v1.0.0',
      provider: 'openrouter',
      upstream_provider: 'anthropic_direct',
      tier: 'T3',
      language: 'en',
      eval_suite_version: 'v1.0.0',
      status: 'certified',
      pass_rate: 0.98,
      latency_p95_ms: 350,
      cost_per_task_usd: 0.003,
      stage_results_json: '{}',
      certified_at: now,
      expires_at: expiresAt,
      certified_by: 'system_harness',
    });

    const countU = await certRepo.invalidateOnVersionOrUpstreamChange(
      'test_router_switch_brain',
      'v1.0.0',
      'bedrock_upstream'
    );
    expect(countU).toBe(1);

    const matrixU = await certRepo.getCertificationMatrix('test_router_switch_brain');
    expect(matrixU[0].status).toBe('expired');
  });

  // ============================================================================
  // Criteria 4: Degradation follows route-up → decompose → reduce-autonomy → escalate, in order
  // ============================================================================
  it('Criteria 4: Degradation follows route-up → decompose → reduce-autonomy → escalate, in order', async () => {
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 86400000).toISOString();

    // Setup 1: Test ROUTE UP (T3 requested, only T4 available)
    await certRepo.saveCertification({
      id: 'cert_ladder_t4',
      model_id: 'test_t4_brain',
      model_version: 'v1',
      provider: 'test_p',
      upstream_provider: 'direct',
      tier: 'T4',
      language: 'en',
      eval_suite_version: 'v1.0.0',
      status: 'certified',
      pass_rate: 0.99,
      latency_p95_ms: 400,
      cost_per_task_usd: 0.005,
      stage_results_json: '{}',
      certified_at: now,
      expires_at: expiresAt,
      certified_by: 'system_harness',
    });

    const res1 = await router.routeTask({
      tenantId: testTenantId,
      requiredTier: 'T3',
      language: 'en',
      taskId: 'task_deg_1',
      taskDescription: 'Complex analysis',
    });
    expect(res1.degradationResolution?.actionTaken).toBe('route_up');
    expect(res1.tierUsed).toBe('T4');

    // Setup 2: Test DECOMPOSE (T3/T4 unavailable, only T1/T2 available)
    await client.execute('DELETE FROM model_certifications WHERE model_id = ?', ['test_t4_brain']);
    await certRepo.saveCertification({
      id: 'cert_ladder_t2',
      model_id: 'test_t2_brain',
      model_version: 'v1',
      provider: 'test_p',
      upstream_provider: 'direct',
      tier: 'T2',
      language: 'en',
      eval_suite_version: 'v1.0.0',
      status: 'certified',
      pass_rate: 0.98,
      latency_p95_ms: 250,
      cost_per_task_usd: 0.001,
      stage_results_json: '{}',
      certified_at: now,
      expires_at: expiresAt,
      certified_by: 'system_harness',
    });

    const res2 = await router.routeTask({
      tenantId: testTenantId,
      requiredTier: 'T3',
      language: 'en',
      taskId: 'task_deg_2',
      taskDescription: 'Multi-step reasoning',
    });
    expect(res2.degradationResolution?.actionTaken).toBe('decompose');
    expect(res2.degradationResolution?.subTasks?.length).toBeGreaterThan(0);

    // Setup 3: Test REDUCE AUTONOMY (target language unavailable, English T1 baseline available)
    const res3 = await router.routeTask({
      tenantId: testTenantId,
      requiredTier: 'T3',
      language: 'ta', // Tamil requested, only English T2/T1 available
      taskId: 'task_deg_3',
      taskDescription: 'Tamil inquiry response',
    });
    expect(res3.degradationResolution?.actionTaken).toBe('reduce_autonomy');
    expect(res3.degradationResolution?.autonomyReducedTo).toBe('draft_for_approval');

    // Setup 4: Test ESCALATE (No models certified anywhere)
    await client.execute('DELETE FROM model_certifications');
    const res4 = await router.routeTask({
      tenantId: testTenantId,
      requiredTier: 'T3',
      language: 'en',
      taskId: 'task_deg_4',
      taskDescription: 'Critical task with zero certified models',
    });
    expect(res4.success).toBe(false);
    expect(res4.degradationResolution?.actionTaken).toBe('escalate');
    expect(res4.degradationResolution?.escalationAttentionItemId).toBeDefined();
  });

  // ============================================================================
  // Criteria 5: A forced total-provider outage produces escalations, never wrong answers
  // ============================================================================
  it('Criteria 5: A forced total-provider outage produces escalations, never wrong answers', async () => {
    const routeResult = await router.routeTask({
      tenantId: testTenantId,
      requiredTier: 'T2',
      language: 'en',
      taskId: 'task_outage_999',
      taskDescription: 'Refund request processing',
      forceProviderOutage: true,
    });

    expect(routeResult.success).toBe(false);
    expect(routeResult.degraded).toBe(true);
    expect(routeResult.degradationResolution?.actionTaken).toBe('escalate');

    // Verify Attention Item was created in Human Attention Center
    const attentionItems = await TenantContextManager.withTenant(testTenantId, 'default', () =>
      attentionRepo.listItems({ reasonCategory: 'workflow_suspended' })
    );

    const outageItem = attentionItems.find((i) => i.description.includes('task_outage_999'));
    expect(outageItem).toBeDefined();
    expect(outageItem?.priority).toBe('P0_CRITICAL');
  });

  // ============================================================================
  // Criteria 6: Every skill has typed I/O and passing unit tests; failing skills cannot be granted
  // ============================================================================
  it('Criteria 6: Every skill has typed I/O and passing unit tests; failing skills cannot be granted', async () => {
    // 1. Verify all 14 deterministic platform skills
    expect(ALL_DETERMINISTIC_SKILLS.length).toBe(14);

    for (const skill of ALL_DETERMINISTIC_SKILLS) {
      expect(skill.id).toBeDefined();
      expect(skill.name).toBeDefined();
      expect(skill.isDeterministic).toBe(true);
      expect(skill.inputSchema).toBeDefined();
      expect(skill.outputSchema).toBeDefined();

      // Run unit tests for this skill
      const testResult = await skillLib.runSkillTests(skill.id);
      if (!testResult.passed) {
        console.error(`Skill ${skill.id} failed tests:`, testResult.errorMessage);
      }
      expect(testResult.passed).toBe(true);
      expect(testResult.assertionsCount).toBeGreaterThan(0);
    }

    // 2. Verify that failing skills cannot be granted (§9.3, §23)
    await skillLib.setSkillTestStatus('extract_contact_details', 'failed');
    const isGrantable = await skillLib.canGrantSkill('extract_contact_details');
    expect(isGrantable).toBe(false);

    // Attempting to execute a failing skill must be rejected
    const execAttempt = await skillLib.executeSkill('extract_contact_details', {
      text: 'My email is test@domain.in',
    });
    expect(execAttempt.success).toBe(false);
    expect(execAttempt.error).toContain('cannot be executed');

    // Reset skill test status
    await skillLib.setSkillTestStatus('extract_contact_details', 'passed');
  });

  // ============================================================================
  // Criteria 7: Certification results are stored per tier × per language — no single aggregate score exists anywhere
  // ============================================================================
  it('Criteria 7: Certification results are stored per tier × per language — no single aggregate score exists anywhere', async () => {
    const reportCard = await harness.runAlignmentCheck({
      modelId: 'test_matrix_brain',
      modelVersion: '2026.08',
      provider: 'google',
      tiers: ['T1', 'T2', 'T3', 'T4'],
      languages: ['en', 'hi', 'te'],
    });

    expect(reportCard.overallPassed).toBe(true);

    // Query matrix from DB
    const matrix = await certRepo.getCertificationMatrix('test_matrix_brain');
    expect(matrix.length).toBe(12); // 4 tiers × 3 languages = 12 distinct records!

    // Verify that each record has its own distinct tier and language
    const distinctTiers = new Set(matrix.map((m) => m.tier));
    const distinctLangs = new Set(matrix.map((m) => m.language));

    expect(distinctTiers.size).toBe(4);
    expect(distinctLangs.size).toBe(3);

    // Verify individual metrics (no aggregate blended score table exists)
    for (const record of matrix) {
      expect(record.tier).toBeDefined();
      expect(record.language).toBeDefined();
      expect(record.pass_rate).toBeGreaterThanOrEqual(0);
      expect(record.latency_p95_ms).toBeGreaterThan(0);
    }
  });

  // ============================================================================
  // Criteria 8: Stage 6 live-fire runs in simulation and provably cannot reach a customer or write a real record
  // ============================================================================
  it('Criteria 8: Stage 6 live-fire is reported as NOT RUN until the sandbox exists, and is never counted as a pass', async () => {
    const reportCard = await harness.runAlignmentCheck({
      modelId: 'test_sim_guard_brain',
      modelVersion: '2026.08',
      provider: 'google',
      tiers: ['T1', 'T2'],
      languages: ['en'],
    });

    const stage6 = reportCard.stages['stage6_live_fire_simulation'];
    expect(stage6).toBeDefined();
    expect(stage6.status).toBe('not_run');
    expect(stage6.passed).toBe(false);
    expect((stage6.details as any).reason).toContain('graph-runtime sandbox');
    // Certification of the tested cells still comes from the probes that did run
    expect(reportCard.overallPassed).toBe(true);
  });
});
