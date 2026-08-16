import { describe, it, expect } from 'vitest';
import { DataRetentionPurgePlanner } from '../../src/governance/retention/dataRetentionPurgePlanner.js';
import { DataRetentionPolicy } from '../../src/governance/types/governanceTypes.js';

describe('DataRetentionPurgePlanner Unit Tests', () => {
  const samplePolicies: DataRetentionPolicy[] = [
    {
      id: 'ret_transcripts',
      tenantId: 'tenant_1',
      dataClassification: 'internal',
      targetResourceType: 'transcripts',
      retentionDays: 30,
      purgeAction: 'hard_delete',
      isActive: true,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 'ret_audit_logs',
      tenantId: 'tenant_1',
      dataClassification: 'restricted',
      targetResourceType: 'audit_logs',
      retentionDays: 365,
      purgeAction: 'archive_cold_storage',
      isActive: true,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
  ];

  it('should formulate exact cutoff timestamps and purge plan items', () => {
    const fixedDate = new Date('2026-03-01T00:00:00.000Z');
    const cutoff30 = DataRetentionPurgePlanner.calculateCutoff(30, fixedDate);
    expect(cutoff30).toBe('2026-01-30T00:00:00.000Z');

    const plan = DataRetentionPurgePlanner.formulatePurgePlan(samplePolicies);
    expect(plan.length).toBe(2);
    expect(plan[0].targetResourceType).toBe('transcripts');
    expect(plan[1].targetResourceType).toBe('audit_logs');
  });

  it('should create valid purge audit entries', () => {
    const audit = DataRetentionPurgePlanner.createPurgeAudit(
      'tenant_1',
      samplePolicies[0],
      100,
      25,
      'completed'
    );

    expect(audit.tenantId).toBe('tenant_1');
    expect(audit.targetResourceType).toBe('transcripts');
    expect(audit.recordsEvaluated).toBe(100);
    expect(audit.recordsPurged).toBe(25);
    expect(audit.status).toBe('completed');
  });
});
