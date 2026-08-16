import { describe, it, expect } from 'vitest';
import { TenantContextManager } from '../../src/core/context/tenantContext.js';
import { TenantIsolationError } from '../../src/core/errors/errors.js';

describe('Tenant Context Manager', () => {
  it('should propagate tenant context across async call chains', async () => {
    const tenantId = 't-acme-corp';
    const orgId = 'org-global';

    await TenantContextManager.withTenant(tenantId, orgId, async () => {
      const current = TenantContextManager.get();
      expect(current?.tenantId).toBe(tenantId);
      expect(current?.organizationId).toBe(orgId);
      expect(current?.correlationId).toBeDefined();

      // Nested async promise
      await new Promise((resolve) => setTimeout(resolve, 10));
      const nested = TenantContextManager.getRequired();
      expect(nested.tenantId).toBe(tenantId);
    });

    // Outside scope
    expect(TenantContextManager.get()).toBeUndefined();
  });

  it('should throw TenantIsolationError when getRequired() is called outside context', () => {
    expect(() => TenantContextManager.getRequired()).toThrow(TenantIsolationError);
  });

  it('should maintain independent contexts in concurrent execution flows', async () => {
    const runFlowA = TenantContextManager.withTenant('tenant-alpha', 'org-alpha', async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return TenantContextManager.getRequired().tenantId;
    });

    const runFlowB = TenantContextManager.withTenant('tenant-beta', 'org-beta', async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return TenantContextManager.getRequired().tenantId;
    });

    const [resA, resB] = await Promise.all([runFlowA, runFlowB]);
    expect(resA).toBe('tenant-alpha');
    expect(resB).toBe('tenant-beta');
  });
});
