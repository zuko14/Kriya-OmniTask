/**
 * Xylarc AI — Authentication & Context Resolution Middleware
 * Verifies JWT tokens and wraps request execution in TenantContext.
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { JwtService, JwtPayload } from '../../security/auth/jwt.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';
import { UnauthorizedError } from '../../core/errors/errors.js';
import { TenantRepository } from '../../storage/repositories/tenantRepository.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: JwtPayload;
  }
}

const tenantRepo = new TenantRepository();

export async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new UnauthorizedError('Missing or malformed Authorization header. Expected Bearer <token>');
  }

  const token = authHeader.substring(7);
  const payload = JwtService.verify(token);

  // Validate tenant is active
  const tenant = await tenantRepo.findById(payload.tenantId);
  if (!tenant || tenant.status !== 'active') {
    throw new UnauthorizedError('Tenant account is disabled, suspended, or does not exist');
  }

  request.user = payload;
}
