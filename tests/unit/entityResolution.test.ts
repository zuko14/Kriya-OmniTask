/**
 * Kriya AI — Entity Resolution Unit Tests
 */

import { describe, it, expect } from 'vitest';
import { EntityResolutionService } from '../../src/customer360/services/entityResolutionService.js';

describe('Entity Resolution Normalization Unit Tests', () => {
  it('should normalize valid emails correctly', () => {
    expect(EntityResolutionService.normalizeEmail('  John.Doe@Example.COM ')).toBe('john.doe@example.com');
    expect(EntityResolutionService.normalizeEmail('user@domain.co.in')).toBe('user@domain.co.in');
    expect(EntityResolutionService.normalizeEmail('invalid-email')).toBeUndefined();
    expect(EntityResolutionService.normalizeEmail(undefined)).toBeUndefined();
  });

  it('should normalize international and local phone numbers', () => {
    expect(EntityResolutionService.normalizePhone('+1 (555) 234-5678')).toBe('+15552345678');
    expect(EntityResolutionService.normalizePhone('919876543210')).toBe('+919876543210');
    expect(EntityResolutionService.normalizePhone('+91 98765 43210')).toBe('+919876543210');
    expect(EntityResolutionService.normalizePhone('123')).toBeUndefined(); // Too short
    expect(EntityResolutionService.normalizePhone(undefined)).toBeUndefined();
  });
});
