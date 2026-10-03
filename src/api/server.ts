/**
 * Kriya AI — Production Fastify API Server
 * Configures security headers, correlation IDs, structured error handling, and routing.
 */

import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { AppError } from '../core/errors/errors.js';
import { logger } from '../core/logger/logger.js';
import { CryptoUtils } from '../core/utils/crypto.js';
import { DistributedContextManager } from '../observability/tracing/distributedContext.js';
import { PlatformMetrics } from '../observability/metrics/platformMetrics.js';
import { healthRoutes } from './routes/healthRoutes.js';
import { authRoutes } from './routes/authRoutes.js';
import { tenantRoutes } from './routes/tenantRoutes.js';
import { orgRoutes } from './routes/orgRoutes.js';
import { userRoutes } from './routes/userRoutes.js';
import { customerRoutes } from './routes/customerRoutes.js';
import { channelRoutes } from './routes/channelRoutes.js';
import { agentRoutes } from './routes/agentRoutes.js';
import { orchestrationRoutes } from './routes/orchestrationRoutes.js';
import { toolRoutes } from './routes/toolRoutes.js';
import { policyRoutes } from './routes/policyRoutes.js';
import { workflowRoutes } from './routes/workflowRoutes.js';
import { workforceRoutes } from './routes/workforceRoutes.js';
import { knowledgeRoutes } from './routes/knowledgeRoutes.js';
import { digitalTwinRoutes } from './routes/digitalTwinRoutes.js';
import { biRoutes } from './routes/biRoutes.js';
import { observabilityRoutes } from './routes/observabilityRoutes.js';
import { verificationRoutes } from './routes/verificationRoutes.js';
import { attentionRoutes } from './routes/attentionRoutes.js';
import { simulationRoutes } from './routes/simulationRoutes.js';
import { trustRoutes } from './routes/trustRoutes.js';
import { evaluationRoutes } from './routes/evaluationRoutes.js';
import { multilingualRoutes } from './routes/multilingualRoutes.js';
import { securityHardeningRoutes } from './routes/securityHardeningRoutes.js';
import { reliabilityRoutes } from './routes/reliabilityRoutes.js';
import { modelResilienceRoutes } from './routes/modelResilienceRoutes.js';
import { costRoutes } from './routes/costRoutes.js';
import { governanceRoutes } from './routes/governanceRoutes.js';
import { adminRoutes } from './routes/adminRoutes.js';
import { billingRoutes } from './routes/billingRoutes.js';
import { infrastructureRoutes } from './routes/infrastructureRoutes.js';
import { sreRoutes } from './routes/sreRoutes.js';
import { deploymentRoutes } from './routes/deploymentRoutes.js';
import { hardeningRoutes } from './routes/hardeningRoutes.js';
import { dnaRoutes } from './routes/dnaRoutes.js';
import { contextRoutes } from './routes/contextRoutes.js';
import { skillRoutes } from './routes/skillRoutes.js';
import { escalationRoutes } from './routes/escalationRoutes.js';
import { modelCertificationRoutes } from './routes/modelCertificationRoutes.js';
import { brainRoutes } from './routes/brainRoutes.js';
import { externalRetrievalRoutes } from './routes/externalRetrievalRoutes.js';
import { realtimeStreamRoutes } from './routes/realtimeStreamRoutes.js';
import { adaptationRoutes } from './routes/adaptationRoutes.js';
import { mcpRoutes } from './routes/mcpRoutes.js';
import { outcomeRoutes } from './routes/outcomeRoutes.js';
import { autonomyRoutes } from './routes/autonomyRoutes.js';
import { dpdpRoutes } from './routes/dpdpRoutes.js';

export async function buildServer(): Promise<FastifyInstance> {
  const fastify = Fastify({
    logger: false, // We use our structured JSON logger
    trustProxy: true,
    disableRequestLogging: true,
  });

  // 1. CORS
  await fastify.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // 2. Rate Limiting
  await fastify.register(rateLimit, {
    max: 1000,
    timeWindow: '1 minute',
  });

  // 3. W3C Distributed Tracing Context & Request Hook
  fastify.addHook('onRequest', async (request, reply) => {
    const traceCtx = DistributedContextManager.extractFromHeaders(request.headers);
    (request as any).traceContext = traceCtx;
    (request as any).startTime = Date.now();

    request.headers['x-correlation-id'] = traceCtx.correlationId;
    reply.header('x-correlation-id', traceCtx.correlationId);
    reply.header(
      'traceparent',
      DistributedContextManager.formatTraceparent(traceCtx.traceId, traceCtx.spanId, traceCtx.traceFlags)
    );
    if (traceCtx.tracestate && Object.keys(traceCtx.tracestate).length > 0) {
      reply.header('tracestate', DistributedContextManager.formatTracestate(traceCtx.tracestate));
    }
  });

  // Prometheus HTTP Request Metrics Hook
  fastify.addHook('onResponse', async (request, reply) => {
    const startTime = (request as any).startTime || Date.now();
    const durationSeconds = Math.max(0.0001, (Date.now() - startTime) / 1000);
    const route = (request as any).routerPath || request.url.split('?')[0] || 'unknown';
    const tenantId = (request as any).user?.tenantId || 'anonymous';

    PlatformMetrics.httpRequestsTotal.inc({
      method: request.method,
      route,
      status_code: reply.statusCode,
      tenant_id: tenantId,
    });

    PlatformMetrics.httpRequestDurationSeconds.observe(
      {
        method: request.method,
        route,
        status_code: reply.statusCode,
      },
      durationSeconds
    );
  });

  // 4. Centralized Domain Error Handler
  fastify.setErrorHandler((error, request, reply) => {
    const correlationId = (request.headers['x-correlation-id'] as string) || CryptoUtils.generateId();

    if (error instanceof AppError) {
      error.correlationId = correlationId;
      logger.warn(`Handled domain error: ${error.code} - ${error.message}`, {
        code: error.code,
        statusCode: error.statusCode,
        path: request.url,
        method: request.method,
      });

      return reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          statusCode: error.statusCode,
          correlationId,
          details: error.details,
        },
      });
    }

    // Zod & Schema Validation errors
    const errObj = error as any;
    if (errObj?.name === 'ZodError' || (errObj && errObj.issues)) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request payload validation failed',
          statusCode: 400,
          correlationId,
          details: errObj.issues,
        },
      });
    }

    if (errObj && errObj.validation) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: errObj.message || 'Validation error',
          statusCode: 400,
          correlationId,
          details: errObj.validation,
        },
      });
    }

    // Unhandled internal server error
    logger.error('Unhandled internal server error', error, {
      path: request.url,
      method: request.method,
      correlationId,
    });

    return reply.status(500).send({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected internal error occurred.',
        statusCode: 500,
        correlationId,
      },
    });
  });

  // 5. Register Routes
  await fastify.register(healthRoutes);
  await fastify.register(authRoutes);
  await fastify.register(tenantRoutes);
  await fastify.register(orgRoutes);
  await fastify.register(userRoutes);
  await fastify.register(customerRoutes);
  await fastify.register(channelRoutes);
  await fastify.register(agentRoutes);
  await fastify.register(orchestrationRoutes);
  await fastify.register(toolRoutes);
  await fastify.register(policyRoutes);
  await fastify.register(workflowRoutes);
  await fastify.register(workforceRoutes);
  await fastify.register(knowledgeRoutes);
  await fastify.register(digitalTwinRoutes);
  await fastify.register(biRoutes);
  await fastify.register(observabilityRoutes);
  await fastify.register(verificationRoutes);
  await fastify.register(attentionRoutes);
  await fastify.register(simulationRoutes);
  await fastify.register(evaluationRoutes);
  await fastify.register(multilingualRoutes);
  await fastify.register(securityHardeningRoutes);
  await fastify.register(reliabilityRoutes);
  await fastify.register(modelResilienceRoutes);
  await fastify.register(costRoutes);
  await fastify.register(governanceRoutes);
  await fastify.register(adminRoutes);
  await fastify.register(billingRoutes);
  await fastify.register(infrastructureRoutes);
  await fastify.register(sreRoutes);
  await fastify.register(deploymentRoutes);
  await fastify.register(hardeningRoutes);
  await fastify.register(dnaRoutes);
  await fastify.register(contextRoutes);
  await fastify.register(modelCertificationRoutes);
  await fastify.register(skillRoutes);
  await fastify.register(escalationRoutes);
  await fastify.register(brainRoutes);
  await fastify.register(externalRetrievalRoutes);
  await fastify.register(realtimeStreamRoutes);
  await fastify.register(adaptationRoutes);
  await fastify.register(trustRoutes);
  await fastify.register(mcpRoutes);
  await fastify.register(outcomeRoutes);
  await fastify.register(autonomyRoutes);
  await fastify.register(dpdpRoutes);

  return fastify;
}
