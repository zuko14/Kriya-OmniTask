import { describe, it, expect } from 'vitest';
import { SchemaTransitionManager } from '../../src/deployment/schema/schemaTransitionManager.js';

describe('SchemaTransitionManager Unit Tests', () => {
  it('should validate legal Expand-Migrate-Contract progression sequence', () => {
    // Start from none -> Expand is legal
    expect(SchemaTransitionManager.validateProgression(null, 'expand')).toBe(true);

    // Expand -> Migrate is legal
    expect(SchemaTransitionManager.validateProgression('expand', 'migrate')).toBe(true);

    // Migrate -> Contract is legal
    expect(SchemaTransitionManager.validateProgression('migrate', 'contract')).toBe(true);

    // Skipping from Expand directly to Contract is ILLEGAL
    expect(SchemaTransitionManager.validateProgression('expand', 'contract')).toBe(false);

    // Regressing from Migrate back to Expand is ILLEGAL
    expect(SchemaTransitionManager.validateProgression('migrate', 'expand')).toBe(false);
  });

  it('should generate structured execution steps and safety guarantees for each phase', () => {
    const expandPlan = SchemaTransitionManager.getStepPlan('customers', 'v2.1', 'expand');
    expect(expandPlan.phase).toBe('expand');
    expect(expandPlan.instructions.length).toBeGreaterThan(0);
    expect(expandPlan.safetyGuarantees.length).toBeGreaterThan(0);

    const contractPlan = SchemaTransitionManager.getStepPlan('customers', 'v2.1', 'contract');
    expect(contractPlan.phase).toBe('contract');
  });
});
