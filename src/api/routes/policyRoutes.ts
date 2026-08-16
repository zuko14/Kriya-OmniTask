/**
 * Xylarc AI — Policy-as-Code Engine REST Routes
 * Fastify routes for policy evaluations, rule management, and compliance audit inspection.
 */

import { FastifyInstance } from 'fastify';
import { PolicyEngine } from '../../policy/engine/policyEngine.js';
import {
  PolicyRuleRepository,
  PolicyEvaluationRepository,
} from '../../policy/repositories/policyRepository.js';
import {
  PolicyRuleSchema,
  PolicyCategoryEnum,
} from '../../policy/types/policyTypes.js';
import { authenticate } from '../middleware/authMiddleware.js';
import { requirePermission } from '../middleware/rbacMiddleware.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';
import { z } from 'zod';

const EvaluatePolicyBodySchema = z.object({
  actionType: z.enum([
    'tool_execution',
    'agent_output',
    'outbound_message',
    'financial_transaction',
    'consent_check',
    'custom',
  ]),
  context: z.record(z.unknown()),
  category: PolicyCategoryEnum.optional(),
  resourceId: z.string().optional(),
});

export async function policyRoutes(fastify: FastifyInstance): Promise<void> {
  const engine = new PolicyEngine();
  const ruleRepo = new PolicyRuleRepository();
  const evalRepo = new PolicyEvaluationRepository();

  // 1. Evaluate Policy Context
  fastify.post(
    '/api/v1/policies/evaluate',
    { preHandler: [authenticate, requirePermission('agent:read')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const body = EvaluatePolicyBodySchema.parse(request.body);

        const result = await engine.evaluate({
          actionType: body.actionType,
          context: body.context,
          category: body.category,
          resourceId: body.resourceId,
          actorType: 'user',
          actorId: user.userId,
        });

        return reply.status(200).send(result);
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 2. List Active Policy Rules
  fastify.get(
    '/api/v1/policies/rules',
    { preHandler: [authenticate, requirePermission('agent:read')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const rules = await ruleRepo.listActiveRules(user.tenantId);
        return reply.status(200).send({
          total: rules.length,
          rules,
        });
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 3. Create or Override Tenant Policy Rule
  fastify.post(
    '/api/v1/policies/rules',
    { preHandler: [authenticate, requirePermission('tenant:write')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const body = PolicyRuleSchema.parse(request.body);

        const rule = await ruleRepo.saveRule({
          tenantId: user.tenantId,
          slug: body.slug,
          name: body.name,
          description: body.description,
          category: body.category,
          severity: body.severity,
          action: body.action,
          condition: body.condition,
          isEnabled: body.isEnabled,
          isSystem: false,
        });

        return reply.status(201).send(rule);
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 4. Delete Custom Tenant Policy Rule
  fastify.delete(
    '/api/v1/policies/rules/:slug',
    { preHandler: [authenticate, requirePermission('tenant:write')] },
    async (request, reply) => {
      const user = request.user!;
      const { slug } = request.params as { slug: string };
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        await ruleRepo.deleteRule(slug, user.tenantId);
        return reply.status(200).send({ success: true, slug });
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 5. Query Policy Evaluation Audit Ledger
  fastify.get(
    '/api/v1/policies/evaluations',
    { preHandler: [authenticate, requirePermission('audit:read')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const evaluations = await evalRepo.listRecent(50);
        return reply.status(200).send({
          total: evaluations.length,
          evaluations,
        });
      }, { userId: user.userId, roles: user.roles });
    }
  );
}
