import { describe, it, expect } from 'vitest';
import { RBACService } from '../../src/security/rbac/rbac.js';
import { ForbiddenError } from '../../src/core/errors/errors.js';

describe('RBAC & Permission Evaluator', () => {
  it('should grant all administrative permissions to owner role', () => {
    const roles = ['owner'];
    expect(RBACService.hasPermission(roles, 'tenant:admin')).toBe(true);
    expect(RBACService.hasPermission(roles, 'agent:deploy')).toBe(true);
    expect(RBACService.hasPermission(roles, 'tool:execute')).toBe(true);
    expect(RBACService.hasPermission(roles, 'billing:write')).toBe(true);
  });

  it('should restrict read_only role from mutating resources', () => {
    const roles = ['read_only'];
    expect(RBACService.hasPermission(roles, 'customer:read')).toBe(true);
    expect(RBACService.hasPermission(roles, 'customer:write')).toBe(false);
    expect(RBACService.hasPermission(roles, 'agent:deploy')).toBe(false);
    expect(RBACService.hasPermission(roles, 'billing:write')).toBe(false);

    expect(() => RBACService.assertPermission(roles, 'agent:deploy')).toThrow(ForbiddenError);
  });

  it('should allow agent_operator to deploy agents and execute tools but not alter billing', () => {
    const roles = ['agent_operator'];
    expect(RBACService.hasPermission(roles, 'agent:deploy')).toBe(true);
    expect(RBACService.hasPermission(roles, 'tool:execute')).toBe(true);
    expect(RBACService.hasPermission(roles, 'billing:write')).toBe(false);
  });

  it('should union permissions when a user has multiple roles', () => {
    const roles = ['sales_manager', 'support_manager'];
    expect(RBACService.hasPermission(roles, 'customer:write')).toBe(true);
    expect(RBACService.hasPermission(roles, 'attention:escalate')).toBe(true);
    expect(RBACService.hasPermission(roles, 'billing:write')).toBe(false);
  });
});
