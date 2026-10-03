/**
 * Kriya AI — Role-Based Access Control (RBAC) Engine
 * Standardized enterprise roles, granular permissions, and authorization assertion gates.
 */

import { ForbiddenError } from '../../core/errors/errors.js';

export type StandardRole =
  | 'owner'
  | 'super_admin'
  | 'admin'
  | 'operations_manager'
  | 'sales_manager'
  | 'support_manager'
  | 'analyst'
  | 'finance'
  | 'security_admin'
  | 'compliance_officer'
  | 'agent_operator'
  | 'read_only'
  | 'system';

export type Permission =
  | 'tenant:read'
  | 'tenant:write'
  | 'tenant:admin'
  | 'system:admin'
  | 'org:read'
  | 'org:write'
  | 'user:read'
  | 'user:write'
  | 'user:invite'
  | 'customer:read'
  | 'customer:write'
  | 'customer:delete'
  | 'agent:read'
  | 'agent:write'
  | 'agent:deploy'
  | 'agent:stop'
  | 'tool:execute'
  | 'tool:configure'
  | 'workflow:read'
  | 'workflow:write'
  | 'workflow:execute'
  | 'audit:read'
  | 'audit:export'
  | 'billing:read'
  | 'billing:write'
  | 'attention:read'
  | 'attention:approve'
  | 'attention:escalate';

export const ROLE_PERMISSIONS: Record<StandardRole, Permission[]> = {
  // A tenant's business owner. 'system:admin' (platform/owner-console scope) is reserved for
  // super_admin/system, which login only honours inside the platform tenant (platformOperator.ts).
  owner: [
    'tenant:read', 'tenant:write', 'tenant:admin',
    'org:read', 'org:write',
    'user:read', 'user:write', 'user:invite',
    'customer:read', 'customer:write', 'customer:delete',
    'agent:read', 'agent:write', 'agent:deploy', 'agent:stop',
    'tool:execute', 'tool:configure',
    'workflow:read', 'workflow:write', 'workflow:execute',
    'audit:read', 'audit:export',
    'billing:read', 'billing:write',
    'attention:read', 'attention:approve', 'attention:escalate',
  ],
  super_admin: [
    'tenant:read', 'tenant:write', 'tenant:admin', 'system:admin',
    'org:read', 'org:write',
    'user:read', 'user:write', 'user:invite',
    'customer:read', 'customer:write', 'customer:delete',
    'agent:read', 'agent:write', 'agent:deploy', 'agent:stop',
    'tool:execute', 'tool:configure',
    'workflow:read', 'workflow:write', 'workflow:execute',
    'audit:read', 'audit:export',
    'billing:read', 'billing:write',
    'attention:read', 'attention:approve', 'attention:escalate',
  ],
  admin: [
    'tenant:read', 'tenant:write', 'tenant:admin',
    'org:read', 'org:write',
    'user:read', 'user:write', 'user:invite',
    'customer:read', 'customer:write',
    'agent:read', 'agent:write', 'agent:deploy', 'agent:stop',
    'tool:execute', 'tool:configure',
    'workflow:read', 'workflow:write', 'workflow:execute',
    'audit:read',
    'billing:read',
    'attention:read', 'attention:approve', 'attention:escalate',
  ],
  operations_manager: [
    'org:read',
    'customer:read', 'customer:write',
    'agent:read', 'agent:stop',
    'tool:execute',
    'workflow:read', 'workflow:execute',
    'audit:read',
    'attention:read', 'attention:approve', 'attention:escalate',
  ],
  sales_manager: [
    'customer:read', 'customer:write',
    'agent:read',
    'workflow:read',
    'attention:read', 'attention:approve',
  ],
  support_manager: [
    'customer:read', 'customer:write',
    'agent:read',
    'attention:read', 'attention:approve', 'attention:escalate',
  ],
  agent_operator: [
    'agent:read', 'agent:deploy', 'agent:stop',
    'tool:execute',
    'workflow:read', 'workflow:execute',
    'attention:read',
  ],
  analyst: [
    'tenant:read',
    'org:read',
    'customer:read',
    'agent:read',
    'workflow:read',
    'audit:read',
  ],
  finance: [
    'tenant:read',
    'billing:read', 'billing:write',
    'customer:read',
    'audit:read',
  ],
  security_admin: [
    'tenant:read',
    'user:read',
    'audit:read', 'audit:export',
    'agent:read', 'agent:stop',
  ],
  compliance_officer: [
    'tenant:read',
    'customer:read',
    'audit:read', 'audit:export',
    'attention:read',
  ],
  read_only: [
    'tenant:read',
    'org:read',
    'customer:read',
    'agent:read',
    'workflow:read',
  ],
  system: [
    'tenant:read', 'tenant:write', 'tenant:admin', 'system:admin',
    'org:read', 'org:write',
    'user:read', 'user:write',
    'customer:read', 'customer:write',
    'agent:read', 'agent:write', 'agent:deploy', 'agent:stop',
    'tool:execute', 'tool:configure',
    'workflow:read', 'workflow:write', 'workflow:execute',
    'audit:read', 'audit:export',
    'attention:read', 'attention:approve', 'attention:escalate',
  ],
};

export class RBACService {
  /**
   * Resolves all unique permissions granted by a list of roles.
   */
  public static getPermissionsForRoles(roles: string[]): Set<Permission> {
    const permissions = new Set<Permission>();
    for (const role of roles) {
      const perms = ROLE_PERMISSIONS[role as StandardRole];
      if (perms) {
        for (const p of perms) {
          permissions.add(p);
        }
      }
    }
    return permissions;
  }

  /**
   * Checks if user with given roles has the required permission.
   */
  public static hasPermission(userRoles: string[], requiredPermission: Permission): boolean {
    const permissions = this.getPermissionsForRoles(userRoles);
    return permissions.has(requiredPermission);
  }

  /**
   * Checks if user with given roles has all of the required permissions.
   */
  public static hasAllPermissions(userRoles: string[], requiredPermissions: Permission[]): boolean {
    const permissions = this.getPermissionsForRoles(userRoles);
    return requiredPermissions.every((p) => permissions.has(p));
  }

  /**
   * Checks if user with given roles has at least one of the required permissions.
   */
  public static hasAnyPermission(userRoles: string[], requiredPermissions: Permission[]): boolean {
    const permissions = this.getPermissionsForRoles(userRoles);
    return requiredPermissions.some((p) => permissions.has(p));
  }

  /**
   * Asserts permission or throws ForbiddenError.
   */
  public static assertPermission(userRoles: string[], requiredPermission: Permission): void {
    if (!this.hasPermission(userRoles, requiredPermission)) {
      throw new ForbiddenError(
        `Action denied: Missing required permission '${requiredPermission}'. Active roles: [${userRoles.join(', ')}]`,
        { requiredPermission, userRoles }
      );
    }
  }
}
