import { describe, it, expect } from 'vitest';
import { FeatureFlagEngine } from '../../src/deployment/flags/featureFlagEngine.js';
import { FeatureFlag } from '../../src/deployment/types/deploymentTypes.js';

describe('FeatureFlagEngine Unit Tests', () => {
  const baseFlag: FeatureFlag = {
    id: 'ff_test_1',
    flagKey: 'advanced_voice_multimodal',
    name: 'Advanced Multimodal Voice Engine',
    isEnabled: true,
    allowedTenants: ['tenant_alpha', 'tenant_beta'],
    allowedRoles: ['super_admin', 'operations_manager'],
    rolloutPct: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };

  it('should respect global kill switch when disabled', () => {
    const disabledFlag = { ...baseFlag, isEnabled: false };
    expect(FeatureFlagEngine.isEnabled(disabledFlag, { tenantId: 'tenant_alpha' })).toBe(false);
  });

  it('should enable feature for targeted tenants and roles', () => {
    // Matches allowed tenant
    expect(FeatureFlagEngine.isEnabled(baseFlag, { tenantId: 'tenant_alpha' })).toBe(true);

    // Matches allowed role
    expect(FeatureFlagEngine.isEnabled(baseFlag, { tenantId: 'tenant_other', roles: ['operations_manager'] })).toBe(true);

    // Untargeted tenant and role -> disabled
    expect(FeatureFlagEngine.isEnabled(baseFlag, { tenantId: 'tenant_other', roles: ['analyst'] })).toBe(false);
  });

  it('should evaluate consistent hash-based percentage rollouts', () => {
    const rolloutFlag: FeatureFlag = {
      ...baseFlag,
      allowedTenants: [],
      allowedRoles: [],
      rolloutPct: 50, // 50% rollout
    };

    const user1Bucket = FeatureFlagEngine.computeHashBucket(`${rolloutFlag.flagKey}:usr_101`);
    const isUser1Enabled = FeatureFlagEngine.isEnabled(rolloutFlag, { userId: 'usr_101' });

    expect(isUser1Enabled).toBe(user1Bucket < 50);
  });
});
