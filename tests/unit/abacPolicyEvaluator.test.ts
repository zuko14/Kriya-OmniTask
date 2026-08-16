import { describe, it, expect } from 'vitest';
import { AbacPolicyEvaluator } from '../../src/governance/abac/abacPolicyEvaluator.js';

describe('AbacPolicyEvaluator Unit Tests', () => {
  it('should deny access when subject clearance level is lower than resource classification', () => {
    const res = AbacPolicyEvaluator.evaluate({
      subject: {
        userId: 'usr_dev_1',
        roles: ['developer'],
        clearanceLevel: 'internal',
      },
      resource: {
        resourceType: 'financial_ledger',
        resourceId: 'res_ledger_1',
        classification: 'restricted',
      },
      action: 'read',
    });

    expect(res.decision).toBe('deny');
    expect(res.reason).toContain('insufficient for resource classification');
  });

  it('should allow access when clearance matches or exceeds resource classification', () => {
    const res = AbacPolicyEvaluator.evaluate({
      subject: {
        userId: 'usr_auditor_1',
        roles: ['compliance_officer'],
        clearanceLevel: 'restricted',
      },
      resource: {
        resourceType: 'financial_ledger',
        resourceId: 'res_ledger_1',
        classification: 'confidential',
      },
      action: 'read',
    });

    expect(res.decision).toBe('allow');
  });

  it('should enforce organization unit boundaries for non-admin users', () => {
    const resBlocked = AbacPolicyEvaluator.evaluate(
      {
        subject: {
          userId: 'usr_sales_1',
          roles: ['sales_agent'],
          unitId: 'unit_sales',
          clearanceLevel: 'internal',
        },
        resource: {
          resourceType: 'engineering_doc',
          resourceId: 'res_doc_1',
          unitId: 'unit_engineering',
          classification: 'internal',
        },
        action: 'read',
      },
      ['unit_sales'] // Accessible units
    );

    expect(resBlocked.decision).toBe('deny');
    expect(resBlocked.reason).toContain('outside subject unit boundary');
  });

  it('should require privileged role for delete and export actions', () => {
    const resUnpriv = AbacPolicyEvaluator.evaluate({
      subject: {
        userId: 'usr_junior_1',
        roles: ['developer'],
        clearanceLevel: 'restricted',
      },
      resource: {
        resourceType: 'database_record',
        resourceId: 'res_rec_1',
        classification: 'internal',
      },
      action: 'delete',
    });

    expect(resUnpriv.decision).toBe('deny');
    expect(resUnpriv.reason).toContain('requires elevated compliance or operational managerial privilege');
  });
});
