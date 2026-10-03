/**
 * Kriya AI — Attention Routing & Human Attention Center Unit Tests (docs/kriya WP-4.6)
 * Verifies branch operating hours, deterministic rule matching, emergency P0 bypass,
 * tool read-backs, compensation, and multi-tenant isolation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db, SQLiteDatabaseClient } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { TenantRepository } from '../../src/storage/repositories/tenantRepository.js';
import { TenantContextManager } from '../../src/core/context/tenantContext.js';
import { BranchRepository } from '../../src/attention/repositories/branchRepository.js';
import { RoutingRuleRepository } from '../../src/attention/repositories/routingRuleRepository.js';
import { AttentionRepository } from '../../src/attention/repositories/attentionRepository.js';
import { AttentionService } from '../../src/attention/service/attentionService.js';
import { AttentionRouter } from '../../src/attention/routing/attentionRouter.js';
import { attentionTools } from '../../src/attention/service/attentionTools.js';
import { DEFAULT_ATTENTION_CHARTER } from '../../src/agents/phase0/attentionAgent.js';
import { buildAgentFromCharter } from '../../src/agents/charter/agentCharter.js';
import { ToolRegistryService } from '../../src/tools/registry/toolRegistry.js';

const STANDARD_HOURS: Record<string, Array<[string, string]>> = {
  mon: [['09:00', '18:00']],
  tue: [['09:00', '18:00']],
  wed: [['09:00', '18:00']],
  thu: [['09:00', '18:00']],
  fri: [['09:00', '18:00']],
  sat: [['10:00', '14:00']],
};

describe('Attention Routing & Escalation (WP-4.6)', () => {
  let client: SQLiteDatabaseClient;
  let tenantA: string;
  let tenantB: string;

  const inA = <T>(fn: () => Promise<T>) =>
    TenantContextManager.withTenant(tenantA, 'default', fn, { userId: 'op_a', roles: ['operations_lead'] });
  const inB = <T>(fn: () => Promise<T>) =>
    TenantContextManager.withTenant(tenantB, 'default', fn, { userId: 'op_b', roles: ['operations_lead'] });

  beforeEach(async () => {
    client = new SQLiteDatabaseClient(':memory:');
    db.setClientForTesting(client);
    await new SchemaMigrator(client).applyMigrations();

    const tenants = new TenantRepository(client);
    tenantA = (await tenants.create({ name: 'Tenant A', slug: 'att-a', plan_tier: 'enterprise', channel_plan: 'combined' })).id;
    tenantB = (await tenants.create({ name: 'Tenant B', slug: 'att-b', plan_tier: 'enterprise', channel_plan: 'combined' })).id;
  });

  afterEach(async () => {
    await client.close();
  });

  describe('Branch & Operating Hours', () => {
    it('creates branches with timezone and operating hours', async () => {
      await inA(async () => {
        const branchRepo = new BranchRepository(client);
        const branch = await branchRepo.createBranch({
          name: 'Bengaluru Koramangala',
          code: 'blr-kor',
          timezone: 'Asia/Kolkata',
          workingHours: STANDARD_HOURS,
          emergencyRole: 'clinical_lead',
        });

        expect(branch.id).toBeDefined();
        expect(branch.name).toBe('Bengaluru Koramangala');
        expect(branch.code).toBe('blr-kor');
        expect(branch.emergency_role).toBe('clinical_lead');

        const found = await branchRepo.findByCode('blr-kor');
        expect(found?.id).toBe(branch.id);
      });
    });

    it('evaluates whether a branch is within working hours', async () => {
      await inA(async () => {
        const branchRepo = new BranchRepository(client);
        const branch = await branchRepo.createBranch({
          name: 'NYC Center',
          code: 'nyc-midtown',
          timezone: 'America/New_York',
          workingHours: {
            mon: [['09:00', '17:00']],
          },
        });

        // Monday 2026-10-05 10:00:00 EDT (14:00 UTC) -> within working hours
        const mondayInHours = new Date('2026-10-05T14:00:00Z');
        const resIn = branchRepo.isWithinWorkingHours(branch, mondayInHours);
        expect(resIn.inHours).toBe(true);

        // Monday 2026-10-05 20:00:00 EDT (Tuesday 00:00 UTC) -> after hours
        const mondayNight = new Date('2026-10-06T00:00:00Z');
        const resNight = branchRepo.isWithinWorkingHours(branch, mondayNight);
        expect(resNight.inHours).toBe(false);

        // Sunday 2026-10-04 12:00 EDT -> closed all day
        const sundayClosed = new Date('2026-10-04T16:00:00Z');
        const resSun = branchRepo.isWithinWorkingHours(branch, sundayClosed);
        expect(resSun.inHours).toBe(false);

        // Next available calculation from Sunday should point to Monday 09:00
        const nextAvail = branchRepo.getNextAvailableTime(branch, sundayClosed);
        expect(nextAvail).toContain('2026-10-05 09:00:00');
        expect(nextAvail).toContain('America/New_York');
      });
    });
  });

  describe('Deterministic Routing Engine', () => {
    it('bypasses hours gating for P0_CRITICAL emergency triage (S37, D7)', async () => {
      await inA(async () => {
        const branchRepo = new BranchRepository(client);
        const branch = await branchRepo.createBranch({
          name: 'Apollo Hospital Indiranagar',
          code: 'ind-emergency',
          timezone: 'Asia/Kolkata',
          workingHours: {
            mon: [['09:00', '17:00']],
          },
          emergencyRole: 'emergency_triage_physician',
        });

        const router = new AttentionRouter(client);
        // Sunday night at 2 AM (clearly outside operating hours)
        const sundayNight = new Date('2026-10-04T20:30:00Z'); // 02:00 AM IST Monday

        const decision = await router.route(
          {
            correlationId: 'em-1',
            sourceAgentId: 'intake',
            title: 'Severe chest pain emergency reported',
            description: 'Patient reports acute crushing chest pain for 30 minutes',
            reasonCategory: 'sensitive_complaint',
            branchId: branch.id,
          },
          'P0_CRITICAL',
          sundayNight
        );

        // Must route immediately with afterHours = 0 and no delay
        expect(decision.assignedRole).toBe('emergency_triage_physician');
        expect(decision.afterHours).toBe(0);
        expect(decision.nextAvailableAt).toBeNull();
        expect(decision.routingRuleId).toBe('system_p0_emergency_bypass');
      });
    });

    it('matches custom routing rules by priority order and conditions', async () => {
      await inA(async () => {
        const ruleRepo = new RoutingRuleRepository(client);
        const router = new AttentionRouter(client);

        // Rule 1: High priority rule for financial / refund requests -> billing_supervisor
        await ruleRepo.createRule({
          name: 'Financial Escalations',
          priorityOrder: 10,
          conditions: {
            reasonCategories: ['financial_threshold'],
          },
          targetRole: 'billing_supervisor',
        });

        // Rule 2: Cardiology department items -> cardiology_care_coordinator
        await ruleRepo.createRule({
          name: 'Cardiology Specialist Route',
          priorityOrder: 20,
          conditions: {
            departments: ['cardiology'],
          },
          targetRole: 'cardiology_care_coordinator',
        });

        // Test matching Rule 1
        const decision1 = await router.route(
          {
            correlationId: 'fin-1',
            sourceAgentId: 'scheduling',
            title: 'Refund exceeding limit requested',
            description: 'Customer requests $500 refund',
            reasonCategory: 'financial_threshold',
          },
          'P1_HIGH'
        );
        expect(decision1.assignedRole).toBe('billing_supervisor');
        expect(decision1.reason).toContain('Financial Escalations');

        // Test matching Rule 2 via context department
        const decision2 = await router.route(
          {
            correlationId: 'card-1',
            sourceAgentId: 'scheduling',
            title: 'Doctor rescheduling conflict',
            description: 'Conflict in cardiology clinic',
            reasonCategory: 'workflow_suspended',
            contextData: { department: 'cardiology' },
          },
          'P2_MEDIUM'
        );
        expect(decision2.assignedRole).toBe('cardiology_care_coordinator');
        expect(decision2.reason).toContain('Cardiology Specialist Route');
      });
    });

    it('falls back to deterministic category role when no rule matches', async () => {
      await inA(async () => {
        const router = new AttentionRouter(client);

        const decision = await router.route(
          {
            correlationId: 'sec-1',
            sourceAgentId: 'runtime',
            title: 'Prompt injection anomaly',
            description: 'Suspicious payload detected',
            reasonCategory: 'security_anomaly',
          },
          'P1_HIGH'
        );

        expect(decision.assignedRole).toBe('compliance_officer');
        expect(decision.routingRuleId).toBe('system_default_fallback');
      });
    });
  });

  describe('Attention Service Integration & Queries', () => {
    it('creates attention item with routed role, branch, and after-hours metadata', async () => {
      await inA(async () => {
        const service = new AttentionService(client);
        const branch = await service.createBranch({
          name: 'Main Clinic',
          code: 'main-branch',
          timezone: 'Asia/Kolkata',
          workingHours: {
            mon: [['09:00', '18:00']],
          },
        });

        const item = await service.escalateToHuman({
          correlationId: 'esc-routed-1',
          sourceAgentId: 'intake',
          title: 'Routine booking assistance',
          description: 'Customer asking questions about tests',
          reasonCategory: 'low_confidence',
          branchId: branch.id,
        });

        expect(item.id).toBeDefined();
        expect(item.assigned_role).toBe('operations_lead');
        expect(item.branch_id).toBe(branch.id);
        expect(item.status).toBe('pending');

        // Query by assigned_role filter
        const items = await service.listItems({ assignedRole: 'operations_lead' });
        expect(items.length).toBeGreaterThanOrEqual(1);
        expect(items.some((i) => i.id === item.id)).toBe(true);

        // Query by branch filter
        const branchItems = await service.listItems({ branchId: branch.id });
        expect(branchItems.some((i) => i.id === item.id)).toBe(true);
      });
    });

    it('re-routes an item to a different role or user', async () => {
      await inA(async () => {
        const service = new AttentionService(client);
        const item = await service.escalateToHuman({
          correlationId: 're-route-1',
          sourceAgentId: 'intake',
          title: 'Medical inquiry',
          description: 'Need doctor advice',
          reasonCategory: 'low_confidence',
        });

        const updated = await service.routeItem(item.id, {
          assignedRole: 'head_physician',
          assignedUserId: 'doc_42',
        });

        expect(updated.assigned_role).toBe('head_physician');
        expect(updated.assigned_user_id).toBe('doc_42');
      });
    });

    it('strictly isolates attention items and branches between tenants', async () => {
      let itemAId: string;
      let branchAId: string;

      await inA(async () => {
        const service = new AttentionService(client);
        const branchA = await service.createBranch({
          name: 'Branch A',
          workingHours: STANDARD_HOURS,
        });
        branchAId = branchA.id;

        const itemA = await service.escalateToHuman({
          correlationId: 'tenant-iso-1',
          sourceAgentId: 'intake',
          title: 'Tenant A confidential issue',
          description: 'Secret data',
          reasonCategory: 'sensitive_complaint',
          branchId: branchA.id,
        });
        itemAId = itemA.id;
      });

      await inB(async () => {
        const service = new AttentionService(client);
        const branchRepo = new BranchRepository(client);

        // Tenant B cannot see Tenant A's branch
        const branch = await branchRepo.findById(branchAId);
        expect(branch).toBeNull();

        // Tenant B cannot see Tenant A's attention item
        const items = await service.listItems();
        expect(items.find((i) => i.id === itemAId)).toBeUndefined();
      });
    });
  });

  describe('Attention Tools Verification & Compensation', () => {
    it('executes attention tools with read-back verification and takeover compensation', async () => {
      await inA(async () => {
        const service = new AttentionService(client);
        const tools = attentionTools(() => service);
        const toolMap = new Map(tools.map((t) => [t.definition.slug, t]));

        // 1. Create an item
        const item = await service.escalateToHuman({
          correlationId: 'tool-test-1',
          customerId: 'cust_999',
          sourceAgentId: 'intake',
          title: 'Billing clarification',
          description: 'Customer questions charges',
          reasonCategory: 'financial_threshold',
        });

        // 2. Claim item tool with read-back verify
        const claimTool = toolMap.get('attention_claim_item')!;
        expect(claimTool.verify).toBeDefined();

        const claimRes = await claimTool.handler({ itemId: item.id, userId: 'agent_sarah' }, {} as any);
        expect((claimRes.item as any).status).toBe('claimed');

        const claimVerify = await claimTool.verify!({ itemId: item.id, userId: 'agent_sarah' }, claimRes, {} as any);
        expect(claimVerify.state).toBe('verified');

        // 3. Takeover tool with read-back verify and compensate
        const takeoverTool = toolMap.get('attention_takeover')!;
        expect(takeoverTool.verify).toBeDefined();
        expect(takeoverTool.compensate).toBeDefined();

        const toRes = await takeoverTool.handler(
          { customerId: 'cust_999', channel: 'whatsapp', userId: 'agent_sarah', reason: 'Angry customer' },
          {} as any
        );
        expect((toRes.takeover as any).is_active).toBe(1);

        // Verify read-back confirms takeover is active
        const toVerify = await takeoverTool.verify!(
          { customerId: 'cust_999', channel: 'whatsapp', userId: 'agent_sarah', reason: 'Angry customer' },
          toRes,
          {} as any
        );
        expect(toVerify.state).toBe('verified');

        // Saga compensate ends takeover
        await takeoverTool.compensate!(
          { customerId: 'cust_999', channel: 'whatsapp', userId: 'agent_sarah', reason: 'Angry customer' },
          toRes,
          {} as any
        );
        const isUnderTakeover = await service.isUnderTakeover('cust_999');
        expect(isUnderTakeover).toBe(false);

        // 4. Resolve item tool with read-back verify
        const resolveTool = toolMap.get('attention_resolve_item')!;
        const resRes = await resolveTool.handler(
          { itemId: item.id, action: 'approved', notes: 'Waived $10 service fee' },
          {} as any
        );
        expect((resRes.item as any).status).toBe('resolved');

        const resVerify = await resolveTool.verify!(
          { itemId: item.id, action: 'approved', notes: 'Waived $10 service fee' },
          resRes,
          {} as any
        );
        expect(resVerify.state).toBe('verified');
      });
    });

    it('builds Attention agent from charter', async () => {
      const registry = new ToolRegistryService();
      const agent = buildAgentFromCharter(DEFAULT_ATTENTION_CHARTER, { registry });
      expect(agent.agentSlug).toBe('attention');
      expect(agent.graph.nodes.some((n) => n.id === 'plan')).toBe(true);
      expect(agent.graph.nodes.some((n) => n.id === 'finish')).toBe(true);
    });
  });
});
