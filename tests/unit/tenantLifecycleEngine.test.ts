import { describe, it, expect } from 'vitest';
import { TenantLifecycleEngine } from '../../src/admin/lifecycle/tenantLifecycleEngine.js';

describe('TenantLifecycleEngine Unit Tests', () => {
  it('should validate allowed and prohibited tenant lifecycle status transitions', () => {
    expect(TenantLifecycleEngine.validateTransition('trial', 'active')).toBe(true);
    expect(TenantLifecycleEngine.validateTransition('active', 'suspended')).toBe(true);
    expect(TenantLifecycleEngine.validateTransition('suspended', 'active')).toBe(true);
    expect(TenantLifecycleEngine.validateTransition('suspended', 'pending_deletion')).toBe(true);

    // Cannot jump from active directly to trial
    expect(TenantLifecycleEngine.validateTransition('active', 'trial')).toBe(false);
  });

  it('should permit execution only for active and trial tenants', () => {
    expect(TenantLifecycleEngine.isExecutionPermitted('active').permitted).toBe(true);
    expect(TenantLifecycleEngine.isExecutionPermitted('trial').permitted).toBe(true);

    const suspended = TenantLifecycleEngine.isExecutionPermitted('suspended');
    expect(suspended.permitted).toBe(false);
    expect(suspended.reason).toContain('suspended');

    const pendingDel = TenantLifecycleEngine.isExecutionPermitted('pending_deletion');
    expect(pendingDel.permitted).toBe(false);
    expect(pendingDel.reason).toContain('pending deletion');
  });
});
