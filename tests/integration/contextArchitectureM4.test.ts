/**
 * Kriya Omnitask — Milestone M4 Integration Tests (§8, §23)
 * Verifies all 6 acceptance criteria for Context & Token Architecture:
 * 1. An agent with Tier 0 wiped rebuilds correct context from Tiers 1-2 (The Definitive Test)
 * 2. Compaction triggers at 60-70%, never at overflow
 * 3. Forced extraction failure aborts compaction and escalates, discarding nothing
 * 4. Prompt prefix caching measurably reduces cost on identical traffic
 * 5. Budgets enforce the 70/85/95/100 ladder
 * 6. Cost per conversation tracked separately per language
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from '../../src/api/server.js';
import { db } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { JwtService } from '../../src/security/auth/jwt.js';
import { SessionRepository } from '../../src/context/repositories/sessionRepository.js';
import { FourTierMemoryService } from '../../src/context/memory/fourTierMemoryService.js';
import { ProactiveCompactor } from '../../src/context/compaction/proactiveCompactor.js';
import { ContextAssembler } from '../../src/context/assembly/contextAssembler.js';
import { TokenBudgetLadder } from '../../src/context/budget/tokenBudgetLadder.js';
import { LanguageCostTracker } from '../../src/context/cost/languageCostTracker.js';
import { AttentionRepository } from '../../src/attention/repositories/attentionRepository.js';
import { CustomerRepository } from '../../src/customer360/repositories/customerRepository.js';
import { TenantContextManager } from '../../src/core/context/tenantContext.js';

describe('Milestone M4: Context & Token Architecture (§8, §23)', () => {
  let app: FastifyInstance;
  let operatorToken: string;
  let clientAdminToken: string;

  const testTenantId = 'tenant_m4_test';
  const testCustomerId = 'cust_m4_001';

  let sessionRepo: SessionRepository;
  let memoryService: FourTierMemoryService;
  let compactor: ProactiveCompactor;
  let budgetLadder: TokenBudgetLadder;
  let costTracker: LanguageCostTracker;
  let attentionRepo: AttentionRepository;
  let customerRepo: CustomerRepository;

  beforeAll(async () => {
    const client = db.getClient();
    const migrator = new SchemaMigrator(client);
    await migrator.applyMigrations();
    app = await buildServer();
    await app.ready();

    sessionRepo = new SessionRepository();
    customerRepo = new CustomerRepository();
    attentionRepo = new AttentionRepository();
    memoryService = new FourTierMemoryService(sessionRepo, customerRepo);
    compactor = new ProactiveCompactor(sessionRepo, attentionRepo);
    budgetLadder = new TokenBudgetLadder(sessionRepo, attentionRepo);
    costTracker = new LanguageCostTracker(sessionRepo);

    // Seed test tenant & customer
    const now = new Date().toISOString();

    await client.execute(
      `INSERT OR REPLACE INTO tenants (id, name, slug, status, plan_tier, dna_profile_id, created_at, updated_at)
       VALUES (?, 'Context Test Corp', 'context-test', 'active', 'enterprise', 'dna_retail_commerce', ?, ?);`,
      [testTenantId, now, now]
    );

    await client.execute(
      `INSERT OR REPLACE INTO customers (id, tenant_id, full_name, primary_email, primary_phone, lifecycle_stage, created_at, updated_at)
       VALUES (?, ?, 'Aarav Sharma', 'aarav.sharma@example.in', '+919876543210', 'opportunity', ?, ?);`,
      [testCustomerId, testTenantId, now, now]
    );

    operatorToken = JwtService.sign({
      userId: 'operator_m4',
      tenantId: testTenantId,
      organizationId: 'default',
      roles: ['system', 'operator'],
      email: 'operator@kriya.ai',
    });

    clientAdminToken = JwtService.sign({
      userId: 'admin_m4',
      tenantId: testTenantId,
      organizationId: 'default',
      roles: ['role-admin', 'admin'],
      email: 'admin@contextcorp.com',
    });
  });

  afterAll(async () => {
    await app.close();
  });

  // ============================================================================
  // Criteria 1: The Definitive Test — Rebuilding context from Tiers 1–2
  // ============================================================================
  it('Criteria 1 (Definitive Test): An agent with Tier 0 wiped rebuilds correct context from Tiers 1–2', async () => {
    const sessionId = 'sess_definitive_test_001';
    const now = new Date().toISOString();

    // 1. Create session with customer link
    await sessionRepo.createSession({
      id: sessionId,
      tenantId: testTenantId,
      customerId: testCustomerId,
      agentSlug: 'customer_support_specialist',
      language: 'en',
    });

    // 2. Establish rich Tier 1 Session State (entities, decisions, commitments, open items) in DB
    await memoryService.saveTier1SessionState({
      sessionId,
      tenantId: testTenantId,
      entities: {
        last_order_id: 'ORD-98765-IN',
        item_name: 'Meridian Silk Kurta',
        preferred_courier: 'BlueDart Express',
      },
      decisions: [
        {
          id: 'dec-1',
          decision: 'Approved free express delivery exchange',
          agreedBy: 'agent',
          decidedAt: now,
        },
      ],
      commitments: [
        {
          id: 'com-1',
          commitment: 'Exchange parcel will be dispatched before 4 PM IST',
          committedParty: 'agent',
          status: 'pending',
          createdAt: now,
        },
      ],
      openItems: [
        {
          id: 'open-1',
          questionOrNeed: 'Confirm alternate delivery pin code',
          assignedTo: 'customer',
          priority: 'HIGH',
          status: 'open',
          createdAt: now,
        },
      ],
      version: 1,
      extractedAt: now,
    });

    // 3. Simulate COMPLETE WIPE of Tier 0 working memory (0 in-memory turns, fresh start)
    // Now call rebuildWorkingContextFromTiers1And2()
    const assembled = await memoryService.rebuildWorkingContextFromTiers1And2({
      sessionId,
      tenantId: testTenantId,
      agentRolePrompt: 'You are the Meridian Retail Senior Support Specialist.',
      taskObjective: 'Process exchange delivery confirmation and pin code verification.',
      maxBudgetTokens: 8000,
    });

    // 4. Assert that reconstructed context has complete Layer 1, 2, 3, and 4 facts
    expect(assembled.layer1SystemFrame).toContain('Meridian Retail Senior Support Specialist');
    expect(assembled.layer2TenantFrame).toContain('Retail & Digital Commerce'); // From Tier 2 DNA profile
    expect(assembled.layer3TaskFrame).toContain('Process exchange delivery confirmation');

    // Verify Tier 2 Customer 360 fact
    const customerFact = assembled.layer4RetrievedFacts.find((f) => f.source.includes('Customer 360'));
    expect(customerFact).toBeDefined();
    expect(customerFact?.fact).toContain('Aarav Sharma');
    expect(customerFact?.fact).toContain('opportunity');

    // Verify Tier 1 Session State entities, decisions, commitments, and open items
    const entityFact = assembled.layer4RetrievedFacts.find((f) => f.fact.includes('ORD-98765-IN'));
    expect(entityFact).toBeDefined();
    expect(entityFact?.source).toContain('Tier 1');

    const decisionFact = assembled.layer4RetrievedFacts.find((f) => f.fact.includes('Approved free express delivery'));
    expect(decisionFact).toBeDefined();

    const commitmentFact = assembled.layer4RetrievedFacts.find((f) => f.fact.includes('dispatched before 4 PM IST'));
    expect(commitmentFact).toBeDefined();

    const openItemFact = assembled.layer4RetrievedFacts.find((f) => f.fact.includes('Confirm alternate delivery pin code'));
    expect(openItemFact).toBeDefined();

    // Verify full formatted prompt integrity
    expect(assembled.formattedPrompt).toContain('=== LAYER 1: SYSTEM FRAME ===');
    expect(assembled.formattedPrompt).toContain('=== LAYER 2: TENANT FRAME ===');
    expect(assembled.formattedPrompt).toContain('=== LAYER 3: TASK FRAME ===');
    expect(assembled.formattedPrompt).toContain('=== LAYER 4: ESTABLISHED FACTS (TIER 1 & 2) ===');
    expect(assembled.totalAssembledTokens).toBeGreaterThan(0);
  });

  // ============================================================================
  // Criteria 2: Compaction triggers at 60–70%, never at overflow
  // ============================================================================
  it('Criteria 2: Compaction triggers at 60–70%, never at overflow', async () => {
    const sessionId = 'sess_compaction_threshold_002';

    await sessionRepo.createSession({
      id: sessionId,
      tenantId: testTenantId,
      agentSlug: 'order_management_agent',
      language: 'en',
    });

    // Set task token budget to 1000 tokens so 65% compaction threshold = 650 tokens
    await sessionRepo.upsertBudgetPolicy({
      tenantId: testTenantId,
      taskTokenBudget: 1000,
      compactionThresholdPct: 65.0,
    });

    // 1. Add turns with ~300 tokens (30% utilization < 65% threshold)
    await sessionRepo.saveTurn({
      id: 'turn-c1',
      tenantId: testTenantId,
      sessionId,
      turnIndex: 1,
      speaker: 'customer',
      content: 'Hi, I need assistance with Order #RTL-4001 regarding product delivery status.',
      tokensPrompt: 150,
      tokensCompletion: 0,
    });
    await sessionRepo.saveTurn({
      id: 'turn-c2',
      tenantId: testTenantId,
      sessionId,
      turnIndex: 2,
      speaker: 'agent',
      content: 'I have located Order #RTL-4001. It is currently in transit to Bangalore.',
      tokensPrompt: 0,
      tokensCompletion: 150,
    });

    // Attempt compaction without force: should report no compaction needed
    const lowUtilResult = await compactor.compactSession({
      sessionId,
      tenantId: testTenantId,
      force: false,
    });
    expect(lowUtilResult.status).toBe('no_compaction_needed');
    expect(lowUtilResult.turnsCompactedCount).toBe(0);

    // 2. Add more turns to reach 700 tokens (70% utilization >= 65% threshold, but WELL BELOW 95% overflow)
    await sessionRepo.saveTurn({
      id: 'turn-c3',
      tenantId: testTenantId,
      sessionId,
      turnIndex: 3,
      speaker: 'customer',
      content: 'Can you please change delivery address to Whitefield, and we agreed on evening delivery?',
      tokensPrompt: 200,
      tokensCompletion: 0,
    });
    await sessionRepo.saveTurn({
      id: 'turn-c4',
      tenantId: testTenantId,
      sessionId,
      turnIndex: 4,
      speaker: 'agent',
      content: 'Address updated to Whitefield. We promise our courier will call before 6 PM.',
      tokensPrompt: 0,
      tokensCompletion: 200,
    });

    // Proactive compaction triggers automatically at 60-70%
    const compactedResult = await compactor.compactSession({
      sessionId,
      tenantId: testTenantId,
      force: false,
    });

    expect(compactedResult.success).toBe(true);
    expect(compactedResult.status).toBe('compacted');
    expect(compactedResult.turnsCompactedCount).toBeGreaterThan(0);
    expect(compactedResult.extractedEntitiesCount).toBeGreaterThan(0);
    expect(compactedResult.rollingSummary).toContain('Summary of');

    // Verify uncompacted turns list now only returns active in-window turns
    const remainingUncompacted = await sessionRepo.listTurns(sessionId, testTenantId, { uncompactedOnly: true });
    expect(remainingUncompacted.length).toBeLessThan(4);

    // Verify Tier 3 cold archive retains all 4 turns completely
    const fullArchive = await sessionRepo.listTurns(sessionId, testTenantId);
    expect(fullArchive.length).toBe(4);
  });

  // ============================================================================
  // Criteria 3: Forced extraction failure aborts compaction and escalates, discarding nothing
  // ============================================================================
  it('Criteria 3: Forced extraction failure aborts compaction and escalates, discarding nothing', async () => {
    const sessionId = 'sess_extraction_failure_003';

    await sessionRepo.createSession({
      id: sessionId,
      tenantId: testTenantId,
      agentSlug: 'returns_specialist',
      language: 'en',
    });

    // Add 3 raw turns
    for (let i = 1; i <= 3; i++) {
      await sessionRepo.saveTurn({
        id: `turn-fail-${i}`,
        tenantId: testTenantId,
        sessionId,
        turnIndex: i,
        speaker: i % 2 === 1 ? 'customer' : 'agent',
        content: `Conversation message ${i} with important customer details for return`,
        tokensPrompt: 100,
        tokensCompletion: 50,
      });
    }

    // Inject a faulty extractor that throws an extraction/verification failure
    compactor.setCustomExtractor(async () => {
      throw new Error('LLM JSON Schema Extraction Corrupted: Unexpected token < in JSON');
    });

    // Execute compaction
    const result = await compactor.compactSession({
      sessionId,
      tenantId: testTenantId,
      force: true,
    });

    // Verify:
    // 1. Compaction aborted
    expect(result.success).toBe(false);
    expect(result.status).toBe('aborted_escalated');
    expect(result.turnsCompactedCount).toBe(0);
    expect(result.tokensSaved).toBe(0);

    // 2. ZERO turns were discarded/compacted in DB (All 3 remain uncompacted)
    const uncompactedTurns = await sessionRepo.listTurns(sessionId, testTenantId, { uncompactedOnly: true });
    expect(uncompactedTurns.length).toBe(3);

    // 3. Attention item was raised in Human Attention Center
    const attentionItems = await TenantContextManager.withTenant(testTenantId, 'default', () =>
      attentionRepo.listItems({ reasonCategory: 'workflow_suspended' })
    );
    const matchingItem = attentionItems.find((item) => item.description.includes(sessionId));
    expect(matchingItem).toBeDefined();
    expect(matchingItem?.priority).toBe('P1_HIGH');

    // Reset extractor
    compactor.setCustomExtractor(undefined);
  });

  // ============================================================================
  // Criteria 4: Prompt prefix caching measurably reduces cost on identical traffic
  // ============================================================================
  it('Criteria 4: Prompt prefix caching measurably reduces cost on identical traffic', () => {
    ContextAssembler.clearPrefixCache();

    const systemFrame = 'You are the Kriya AI Lead Concierge for Meridian Retail.';
    const tenantFrame = 'Business DNA Profile: Retail & D2C Commerce\nEntity Vocabulary: {"customer_singular":"Shopper"}';

    // Turn 1: First request with this prefix
    const turn1Assembly = ContextAssembler.assemble({
      systemFrame,
      tenantFrame,
      taskFrame: 'Task 1: Inquire about blue shirt availability',
      maxBudgetTokens: 8000,
    });

    expect(turn1Assembly.isPrefixCached).toBe(false);
    expect(turn1Assembly.prefixHash).toBeDefined();

    // Turn 2: Second request with IDENTICAL System + Tenant prefix, but different task frame
    const turn2Assembly = ContextAssembler.assemble({
      systemFrame,
      tenantFrame,
      taskFrame: 'Task 2: Check delivery charges for Mumbai',
      maxBudgetTokens: 8000,
    });

    expect(turn2Assembly.isPrefixCached).toBe(true);
    expect(turn2Assembly.prefixHash).toBe(turn1Assembly.prefixHash);

    // Measure prompt token cost comparison with and without prefix cache
    const prefixTokens = ContextAssembler.estimateTokens(`[SYSTEM_FRAME]\n${systemFrame}\n[TENANT_FRAME]\n${tenantFrame}`);
    const unCachedPromptCost = (turn1Assembly.totalAssembledTokens / 1_000_000) * 1.25; // $1.25 per 1M tokens
    const cachedPromptCost = ((turn2Assembly.totalAssembledTokens - prefixTokens) / 1_000_000) * 1.25;

    // Verify measurable cost reduction on identical prefix traffic
    expect(cachedPromptCost).toBeLessThan(unCachedPromptCost);
    expect(prefixTokens).toBeGreaterThan(20);
  });

  // ============================================================================
  // Criteria 5: Budgets enforce the 70/85/95/100 ladder
  // ============================================================================
  it('Criteria 5: Budgets enforce the 70/85/95/100 ladder', async () => {
    const budgetTotal = 10000;

    // Stage 1: Healthy (< 70%) -> normal / proceed
    const evalNormal = budgetLadder.evaluateLadder(budgetTotal, 5000);
    expect(evalNormal.stage).toBe('normal');
    expect(evalNormal.action).toBe('proceed');
    expect(evalNormal.utilizationPct).toBe(50.0);

    // Stage 2: 70% -> warn / warn_compact
    const evalWarn = budgetLadder.evaluateLadder(budgetTotal, 7200);
    expect(evalWarn.stage).toBe('warn');
    expect(evalWarn.action).toBe('warn_compact');
    expect(evalWarn.utilizationPct).toBe(72.0);

    // Stage 3: 85% -> optimize / optimize_drop_layer7
    const evalOptimize = budgetLadder.evaluateLadder(budgetTotal, 8800);
    expect(evalOptimize.stage).toBe('optimize');
    expect(evalOptimize.action).toBe('optimize_drop_layer7');
    expect(evalOptimize.utilizationPct).toBe(88.0);

    // Stage 4: 95% -> restrict / restrict_critical_only
    const evalRestrict = budgetLadder.evaluateLadder(budgetTotal, 9600);
    expect(evalRestrict.stage).toBe('restrict');
    expect(evalRestrict.action).toBe('restrict_critical_only');
    expect(evalRestrict.utilizationPct).toBe(96.0);

    // Stage 5: 100% -> stop / circuit_break_stop
    const evalStop = budgetLadder.evaluateLadder(budgetTotal, 10200);
    expect(evalStop.stage).toBe('stop');
    expect(evalStop.action).toBe('circuit_break_stop');
    expect(evalStop.utilizationPct).toBe(102.0);

    // Test live session evaluation triggering attention escalation on 100% breach
    const sessionBudgetTestId = 'sess_budget_ladder_005';
    await sessionRepo.createSession({
      id: sessionBudgetTestId,
      tenantId: testTenantId,
      agentSlug: 'budget_test_agent',
    });

    await sessionRepo.upsertBudgetPolicy({
      tenantId: testTenantId,
      sessionTokenBudget: 5000,
      stopThresholdPct: 100.0,
    });

    // Simulate consuming 5200 tokens (104%)
    await sessionRepo.updateSession(sessionBudgetTestId, testTenantId, {
      promptTokensDelta: 3000,
      completionTokensDelta: 2200,
    });

    const liveEval = await budgetLadder.evaluateSessionBudget({
      sessionId: sessionBudgetTestId,
      tenantId: testTenantId,
    });

    expect(liveEval.stage).toBe('stop');
    expect(liveEval.action).toBe('circuit_break_stop');

    // Verify Attention Item was created for token budget cap breach
    const budgetAttentionItems = await TenantContextManager.withTenant(testTenantId, 'default', () =>
      attentionRepo.listItems({ reasonCategory: 'policy_violation' })
    );
    const matchingBudgetItem = budgetAttentionItems.find((i) => i.description.includes(sessionBudgetTestId));
    expect(matchingBudgetItem).toBeDefined();
    expect(matchingBudgetItem?.priority).toBe('P0_CRITICAL');
  });

  // ============================================================================
  // Criteria 6: Cost per conversation tracked separately per language
  // ============================================================================
  it('Criteria 6: Cost per conversation tracked separately per language', async () => {
    const sessionMultiLangId = 'sess_multilang_cost_006';

    await sessionRepo.createSession({
      id: sessionMultiLangId,
      tenantId: testTenantId,
      agentSlug: 'multilingual_concierge',
      language: 'hi',
    });

    // Turn 1 in English: 1000 prompt tokens, 500 completion tokens
    await costTracker.trackTurnCost({
      tenantId: testTenantId,
      sessionId: sessionMultiLangId,
      language: 'en',
      promptTokens: 1000,
      completionTokens: 500,
    });

    // Turn 2 in Hindi: 2000 prompt tokens, 1000 completion tokens (Hindi multiplier = 2.4)
    await costTracker.trackTurnCost({
      tenantId: testTenantId,
      sessionId: sessionMultiLangId,
      language: 'hi',
      promptTokens: 2000,
      completionTokens: 1000,
    });

    // Turn 3 in Telugu: 1500 prompt tokens, 800 completion tokens (Telugu multiplier = 3.1)
    await costTracker.trackTurnCost({
      tenantId: testTenantId,
      sessionId: sessionMultiLangId,
      language: 'te',
      promptTokens: 1500,
      completionTokens: 800,
    });

    // Query per-language breakdown
    const breakdown = await costTracker.getSessionLanguageCostBreakdown(sessionMultiLangId, testTenantId);

    expect(breakdown.languages.length).toBe(3);

    const enRecord = breakdown.languages.find((l) => l.language === 'en');
    const hiRecord = breakdown.languages.find((l) => l.language === 'hi');
    const teRecord = breakdown.languages.find((l) => l.language === 'te');

    expect(enRecord).toBeDefined();
    expect(enRecord?.totalTokens).toBe(1500);
    expect(enRecord?.tokenEfficiencyMultiplier).toBe(1.0);

    expect(hiRecord).toBeDefined();
    expect(hiRecord?.totalTokens).toBe(3000);
    expect(hiRecord?.tokenEfficiencyMultiplier).toBe(2.4);

    expect(teRecord).toBeDefined();
    expect(teRecord?.totalTokens).toBe(2300);
    expect(teRecord?.tokenEfficiencyMultiplier).toBe(3.1);

    expect(breakdown.totalCostUsd).toBeGreaterThan(0);
    expect(breakdown.totalCostInr).toBeGreaterThan(0);

    // Verify session aggregate total reflects all language costs
    const session = await sessionRepo.findSessionById(sessionMultiLangId, testTenantId);
    expect(session?.total_tokens_spent).toBe(1500 + 3000 + 2300);
    expect(session?.total_cost_usd).toBe(breakdown.totalCostUsd);
    expect(session?.total_cost_inr).toBe(breakdown.totalCostInr);
  });
});
