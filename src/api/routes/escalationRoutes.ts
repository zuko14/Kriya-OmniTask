/**
 * Kriya AI — Failure Escalation REST Routes
 * Authenticated endpoints for submitting failures, querying decision traces, and inspecting failure records.
 */

import { FastifyPluginAsync } from 'fastify';
import { FailureEscalationChain } from '../../orchestration/escalation/failureEscalationChain.js';
import { EscalationRepository } from '../../orchestration/escalation/repositories/escalationRepository.js';
import { StructuredFailureRecordSchema } from '../../orchestration/escalation/types/escalationTypes.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';
import { CryptoUtils } from '../../core/utils/crypto.js';
import { authenticate } from '../middleware/authMiddleware.js';
import { requirePermission } from '../middleware/rbacMiddleware.js';

export const escalationRoutes: FastifyPluginAsync = async (fastify) => {
  const chain = FailureEscalationChain.getInstance();
  const repo = new EscalationRepository();

  // 1. Submit a specialist failure into the Failure Escalation Chain (§5)
  fastify.post('/api/v1/escalation/failures', {
    preHandler: [authenticate, requirePermission('agent:write')],
  }, async (request, reply) => {
    const user = request.user!;
    return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
      const tenantId = user.tenantId;
      const correlationId = TenantContextManager.getCorrelationId();
      const body = request.body as any;

      const validatedFailure = StructuredFailureRecordSchema.parse({
        id: body.id || `fail_${CryptoUtils.generateId()}`,
        tenantId,
        taskId: body.taskId,
        correlationId: body.correlationId || correlationId,
        agentId: body.agentId,
        agentSlug: body.agentSlug,
        failureClass: body.failureClass,
        stage: body.stage || 'execution',
        errorMessage: body.errorMessage,
        attemptsCount: body.attemptsCount || 1,
        inputsHash: body.inputsHash || CryptoUtils.hashSha256(JSON.stringify(body.inputData || {})),
        toolResponses: body.toolResponses || {},
        confidence: body.confidence !== undefined ? body.confidence : 0.0,
        recoverable: body.recoverable !== undefined ? body.recoverable : true,
        riskTier: body.riskTier || 'LOW',
        isIdempotent: body.isIdempotent !== undefined ? body.isIdempotent : true,
        remediationStatus: 'pending',
        escalationLevel: 'specialist',
        metadata: body.metadata || {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const result = await chain.handleFailure(validatedFailure);
      return reply.send({
        success: true,
        resolved: result.resolved,
        finalLevel: result.finalLevel,
        remediation: result.remediation,
        trace: result.trace,
      });
    }, { userId: user.userId, roles: user.roles });
  });

  // 2. Get unified decision trace by Task ID (§5, §18.5)
  fastify.get('/api/v1/escalation/traces/:taskId', {
    preHandler: [authenticate, requirePermission('audit:read')],
  }, async (request, reply) => {
    const user = request.user!;
    return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
      const { taskId } = request.params as { taskId: string };
      const tenantId = user.tenantId;

      const trace = await repo.getTraceByTaskId(taskId, tenantId);
      if (!trace) {
        return reply.status(404).send({
          error: {
            code: 'NOT_FOUND',
            message: `Escalation trace for task '${taskId}' not found.`,
            statusCode: 404,
          },
        });
      }

      return reply.send({ success: true, trace });
    }, { userId: user.userId, roles: user.roles });
  });

  // 3. List recent failure records for tenant
  fastify.get('/api/v1/escalation/failures', {
    preHandler: [authenticate, requirePermission('audit:read')],
  }, async (request, reply) => {
    const user = request.user!;
    return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
      const tenantId = user.tenantId;
      const query = request.query as any;
      const limit = query?.limit ? parseInt(query.limit, 10) : 50;

      const failures = await repo.listFailureRecords(tenantId, limit);
      return reply.send({ success: true, count: failures.length, failures });
    }, { userId: user.userId, roles: user.roles });
  });
};
