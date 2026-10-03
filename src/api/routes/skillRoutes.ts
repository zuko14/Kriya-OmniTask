/**
 * Kriya AI — Skill Library REST Routes
 * Authenticated endpoints for skill listing, testing, grantability checking, and execution.
 */

import { FastifyPluginAsync } from 'fastify';
import { SkillLibrary } from '../../skills/skillLibrary.js';
import { authenticate } from '../middleware/authMiddleware.js';
import { requirePermission } from '../middleware/rbacMiddleware.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';

export const skillRoutes: FastifyPluginAsync = async (fastify) => {
  const skillLib = SkillLibrary.getInstance();

  // 1. List all skills with test status and metadata (§9.3, §17.4)
  fastify.get('/api/v1/skills', {
    preHandler: [authenticate, requirePermission('agent:read')],
  }, async (request, reply) => {
    const user = request.user!;
    return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
      const skills = await skillLib.listSkills();
      return reply.send({ success: true, count: skills.length, skills });
    }, { userId: user.userId, roles: user.roles });
  });

  // 2. Run tests for a specific skill
  fastify.post('/api/v1/skills/:skillId/test', {
    preHandler: [authenticate, requirePermission('tool:execute')],
  }, async (request, reply) => {
    const user = request.user!;
    return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
      const { skillId } = request.params as { skillId: string };
      const testResult = await skillLib.runSkillTests(skillId);
      return reply.send({ success: testResult.passed, testResult });
    }, { userId: user.userId, roles: user.roles });
  });

  // 3. Run all skill tests
  fastify.post('/api/v1/skills/test-all', {
    preHandler: [authenticate, requirePermission('tool:execute')],
  }, async (request, reply) => {
    const user = request.user!;
    return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
      const results = await skillLib.runAllSkillTests();
      const allPassed = Object.values(results).every((r) => r.passed);
      return reply.send({ success: allPassed, results });
    }, { userId: user.userId, roles: user.roles });
  });

  // 4. Check grantability of skill (§9.3: failing skills cannot be granted)
  fastify.get('/api/v1/skills/:skillId/grantable', {
    preHandler: [authenticate, requirePermission('agent:read')],
  }, async (request, reply) => {
    const user = request.user!;
    return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
      const { skillId } = request.params as { skillId: string };
      const isGrantable = await skillLib.canGrantSkill(skillId);
      return reply.send({ success: true, skillId, isGrantable });
    }, { userId: user.userId, roles: user.roles });
  });

  // 5. Execute skill with schema validation
  fastify.post('/api/v1/skills/:skillId/execute', {
    preHandler: [authenticate, requirePermission('tool:execute')],
  }, async (request, reply) => {
    const user = request.user!;
    return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
      const { skillId } = request.params as { skillId: string };
      const input = request.body as any;
      const execResult = await skillLib.executeSkill(skillId, input);
      return reply.status(execResult.success ? 200 : 400).send(execResult);
    }, { userId: user.userId, roles: user.roles });
  });
};
