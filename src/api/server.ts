/**
 * Xylarc AI — Production Fastify API Server
 * Configures security headers, correlation IDs, structured error handling, and routing.
 */

import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { AppError } from '../core/errors/errors.js';
import { logger } from '../core/logger/logger.js';
import { CryptoUtils } from '../core/utils/crypto.js';
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
import { adminUiRoutes } from './routes/adminUiRoutes.js';

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

  // 3. Correlation ID & Request Hook
  fastify.addHook('onRequest', async (request, reply) => {
    const correlationId = (request.headers['x-correlation-id'] as string) || CryptoUtils.generateId();
    request.headers['x-correlation-id'] = correlationId;
    reply.header('x-correlation-id', correlationId);
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

    // Fastify / Schema Validation errors
    const errObj = error as any;
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
  await fastify.register(adminUiRoutes);

  return fastify;
}
