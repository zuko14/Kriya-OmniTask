/**
 * Kriya AI — Health Check Routes
 * Provides standard liveness and readiness health endpoints.
 */

import { FastifyInstance } from 'fastify';
import { KriyaPlatform } from '../../index.js';

export async function healthRoutes(fastify: FastifyInstance): Promise<void> {
  const handler = async (_request: any, reply: any) => {
    const health = await KriyaPlatform.getHealth();
    return reply.status(health.status === 'healthy' ? 200 : 503).send(health);
  };

  fastify.get('/api/v1/health', handler);
  fastify.get('/health', handler);
  fastify.get('/ready', handler);
}
