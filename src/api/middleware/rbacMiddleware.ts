/**
 * Xylarc AI — RBAC Route Protection Middleware
 * Verifies caller roles against required domain permissions.
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { RBACService, Permission } from '../../security/rbac/rbac.js';
import { UnauthorizedError } from '../../core/errors/errors.js';

export function requirePermission(permission: Permission) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      throw new UnauthorizedError('Authentication required before permission check');
    }

    RBACService.assertPermission(request.user.roles, permission);
  };
}
