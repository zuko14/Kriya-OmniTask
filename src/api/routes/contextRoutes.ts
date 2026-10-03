/**
 * Kriya Omnitask — Four-Tier Context & Token Architecture API Routes (§8, §23)
 * REST endpoints for managing conversation sessions, Tier 1 session states,
 * proactive compaction, context assembly, and per-language cost breakdowns.
 */

import { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { SessionRepository } from '../../context/repositories/sessionRepository.js';
import { FourTierMemoryService } from '../../context/memory/fourTierMemoryService.js';
import { ProactiveCompactor } from '../../context/compaction/proactiveCompactor.js';
import { TokenBudgetLadder } from '../../context/budget/tokenBudgetLadder.js';
import { LanguageCostTracker } from '../../context/cost/languageCostTracker.js';
import { authenticate } from '../middleware/authMiddleware.js';
import { requirePermission } from '../middleware/rbacMiddleware.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';
import { CryptoUtils } from '../../core/utils/crypto.js';

const CreateSessionSchema = z.object({
  customerId: z.string().optional(),
  agentSlug: z.string().default('customer_support_specialist'),
  channel: z.enum(['whatsapp', 'voice', 'web', 'email', 'sms']).default('web'),
  language: z.string().default('en'),
});

const AddTurnSchema = z.object({
  speaker: z.enum(['customer', 'agent', 'system', 'supervisor']),
  content: z.string().min(1),
  language: z.string().default('en'),
  promptTokens: z.number().int().nonnegative().default(0),
  completionTokens: z.number().int().nonnegative().default(0),
  structuredPayload: z.record(z.string(), z.unknown()).optional(),
});

const RebuildContextSchema = z.object({
  agentRolePrompt: z.string().min(1),
  taskObjective: z.string().min(1),
  maxBudgetTokens: z.number().int().positive().optional(),
});

const UpdateBudgetPolicySchema = z.object({
  taskTokenBudget: z.number().int().positive().optional(),
  sessionTokenBudget: z.number().int().positive().optional(),
  compactionThresholdPct: z.number().min(10).max(95).optional(),
  warnThresholdPct: z.number().min(10).max(95).optional(),
  optimizeThresholdPct: z.number().min(10).max(98).optional(),
  restrictThresholdPct: z.number().min(10).max(99).optional(),
  stopThresholdPct: z.number().min(50).max(100).optional(),
});

export const contextRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  const sessionRepo = new SessionRepository();
  const memoryService = new FourTierMemoryService(sessionRepo);
  const compactor = new ProactiveCompactor(sessionRepo);
  const budgetLadder = new TokenBudgetLadder(sessionRepo);
  const costTracker = new LanguageCostTracker(sessionRepo);

  app.addHook('preHandler', authenticate);

  // 1. Create Conversation Session
  app.post('/api/v1/context/sessions', {
    preHandler: [requirePermission('workflow:execute')],
  }, async (req, reply) => {
    const tenantId = TenantContextManager.getTenantId();
    const body = CreateSessionSchema.parse(req.body);
    const sessionId = `sess-${CryptoUtils.generateId()}`;

    const session = await sessionRepo.createSession({
      id: sessionId,
      tenantId,
      customerId: body.customerId,
      agentSlug: body.agentSlug,
      channel: body.channel,
      language: body.language,
    });

    return reply.status(201).send(session);
  });

  // 2. Get Session Details
  app.get('/api/v1/context/sessions/:id', {
    preHandler: [requirePermission('workflow:read')],
  }, async (req, reply) => {
    const tenantId = TenantContextManager.getTenantId();
    const { id } = req.params as { id: string };

    const session = await sessionRepo.findSessionById(id, tenantId);
    if (!session) {
      return reply.status(404).send({ error: `Session '${id}' not found.` });
    }

    return reply.send(session);
  });

  // 3. Get Tier 1 Session State
  app.get('/api/v1/context/sessions/:id/state', {
    preHandler: [requirePermission('workflow:read')],
  }, async (req, reply) => {
    const tenantId = TenantContextManager.getTenantId();
    const { id } = req.params as { id: string };

    const state = await memoryService.getTier1SessionState(id, tenantId);
    if (!state) {
      return reply.status(404).send({ error: `No session state established for '${id}'.` });
    }

    return reply.send(state);
  });

  // 4. Add Conversation Turn & Track Language Cost
  app.post('/api/v1/context/sessions/:id/turns', {
    preHandler: [requirePermission('workflow:execute')],
  }, async (req, reply) => {
    const tenantId = TenantContextManager.getTenantId();
    const { id } = req.params as { id: string };
    const body = AddTurnSchema.parse(req.body);

    const session = await sessionRepo.findSessionById(id, tenantId);
    if (!session) {
      return reply.status(404).send({ error: `Session '${id}' not found.` });
    }

    const existingTurns = await sessionRepo.listTurns(id, tenantId);
    const turnIndex = existingTurns.length + 1;
    const turnId = `turn-${CryptoUtils.generateId()}`;

    const turn = await sessionRepo.saveTurn({
      id: turnId,
      tenantId,
      sessionId: id,
      turnIndex,
      speaker: body.speaker,
      language: body.language,
      content: body.content,
      tokensPrompt: body.promptTokens,
      tokensCompletion: body.completionTokens,
      structuredPayload: body.structuredPayload,
    });

    if (body.promptTokens > 0 || body.completionTokens > 0) {
      await costTracker.trackTurnCost({
        tenantId,
        sessionId: id,
        language: body.language,
        promptTokens: body.promptTokens,
        completionTokens: body.completionTokens,
      });
    }

    return reply.status(201).send(turn);
  });

  // 5. Trigger Proactive Compaction
  app.post('/api/v1/context/sessions/:id/compact', {
    preHandler: [requirePermission('workflow:execute')],
  }, async (req, reply) => {
    const tenantId = TenantContextManager.getTenantId();
    const { id } = req.params as { id: string };
    const body = (req.body as any) || {};

    const result = await compactor.compactSession({
      sessionId: id,
      tenantId,
      force: body.force ?? true,
    });

    return reply.send(result);
  });

  // 6. Rebuild Tier 0 Context from Tiers 1-2 (The Definitive Test Endpoint)
  app.post('/api/v1/context/sessions/:id/rebuild', {
    preHandler: [requirePermission('workflow:read')],
  }, async (req, reply) => {
    const tenantId = TenantContextManager.getTenantId();
    const { id } = req.params as { id: string };
    const body = RebuildContextSchema.parse(req.body);

    const assembled = await memoryService.rebuildWorkingContextFromTiers1And2({
      sessionId: id,
      tenantId,
      agentRolePrompt: body.agentRolePrompt,
      taskObjective: body.taskObjective,
      maxBudgetTokens: body.maxBudgetTokens,
    });

    return reply.send(assembled);
  });

  // 7. Get Language Cost Breakdown
  app.get('/api/v1/context/sessions/:id/costs', {
    preHandler: [requirePermission('workflow:read')],
  }, async (req, reply) => {
    const tenantId = TenantContextManager.getTenantId();
    const { id } = req.params as { id: string };

    const breakdown = await costTracker.getSessionLanguageCostBreakdown(id, tenantId);
    return reply.send(breakdown);
  });

  // 8. Get / Evaluate Token Budget
  app.get('/api/v1/context/budget', {
    preHandler: [requirePermission('workflow:read')],
  }, async (req, reply) => {
    const tenantId = TenantContextManager.getTenantId();
    const policy = await sessionRepo.getBudgetPolicy(tenantId);
    return reply.send(policy);
  });

  // 9. Update Token Budget Policy
  app.put('/api/v1/context/budget', {
    preHandler: [requirePermission('tenant:admin')],
  }, async (req, reply) => {
    const tenantId = TenantContextManager.getTenantId();
    const body = UpdateBudgetPolicySchema.parse(req.body);

    const policy = await sessionRepo.upsertBudgetPolicy({
      tenantId,
      ...body,
    });

    return reply.send(policy);
  });
};
