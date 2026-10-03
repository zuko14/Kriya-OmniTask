import { describe, it, expect, beforeEach } from 'vitest';
import { ExternalFactGovernance } from '../../src/retrieval/external/governance/externalFactGovernance.js';
import { ExternalEvidenceItem } from '../../src/retrieval/external/types/externalRetrievalTypes.js';
import { AttentionRepository } from '../../src/attention/repositories/attentionRepository.js';
import { db } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { TenantContextManager } from '../../src/core/context/tenantContext.js';

describe('External Fact Governance & Action Justification Unit Tests (§10.2, Criteria 4 & 5)', () => {
  let attentionRepo: AttentionRepository;
  let governance: ExternalFactGovernance;

  beforeEach(async () => {
    const client = db.getClient();
    const migrator = new SchemaMigrator(client);
    await migrator.applyMigrations();
    attentionRepo = new AttentionRepository(client);
    governance = new ExternalFactGovernance(attentionRepo);

    const now = new Date().toISOString();
    await client.execute(
      `INSERT OR REPLACE INTO tenants (id, name, slug, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?);`,
      ['tenant_conflict_test', 'Conflict Test Tenant', 'conflict-test', now, now]
    );
  });

  it('should allow LOW and MEDIUM risk actions on Tier C/D external evidence', () => {
    const externalEvidence: ExternalEvidenceItem[] = [
      {
        factText: 'Vendor office located at 123 Tech Park',
        trustTier: 'TIER_C',
        source: 'https://vendor.com/about',
      },
    ];

    const lowResult = ExternalFactGovernance.validateActionJustification('LOW', externalEvidence);
    expect(lowResult.permitted).toBe(true);
    expect(lowResult.requiresHumanApproval).toBe(false);

    const medResult = ExternalFactGovernance.validateActionJustification('MEDIUM', externalEvidence);
    expect(medResult.permitted).toBe(true);
    expect(medResult.requiresHumanApproval).toBe(false);
  });

  it('should REJECT HIGH or CRITICAL actions when justified solely by external facts (Tier C/D/E)', () => {
    const openWebEvidence: ExternalEvidenceItem[] = [
      {
        factText: 'Client reportedly acquired new subsidiary',
        trustTier: 'TIER_D',
        source: 'https://news-blog.io/report',
      },
      {
        factText: 'Vendor contact updated on public forum',
        trustTier: 'TIER_C',
        source: 'https://forum.vendor.com/thread',
      },
    ];

    // Attempting a HIGH risk action (e.g. initiating payment or contract change)
    const highResult = ExternalFactGovernance.validateActionJustification('HIGH', openWebEvidence);
    expect(highResult.permitted).toBe(false);
    expect(highResult.requiresHumanApproval).toBe(true);
    expect(highResult.reason).toContain('External facts cannot solely justify a HIGH or CRITICAL action');

    // Attempting a CRITICAL risk action
    const critResult = ExternalFactGovernance.validateActionJustification('CRITICAL', openWebEvidence);
    expect(critResult.permitted).toBe(false);
    expect(critResult.requiresHumanApproval).toBe(true);
  });

  it('should ALLOW HIGH and CRITICAL actions when authoritative Tier A or Tier B corroboration is present', () => {
    const corroboratedEvidence: ExternalEvidenceItem[] = [
      {
        factText: 'Supplier pricing table from ERP database',
        trustTier: 'TIER_A',
        source: 'internal_erp_db',
      },
      {
        factText: 'Public pricing comparison',
        trustTier: 'TIER_D',
        source: 'https://marketprices.com',
      },
    ];

    const highResult = ExternalFactGovernance.validateActionJustification('HIGH', corroboratedEvidence);
    expect(highResult.permitted).toBe(true);
    expect(highResult.requiresHumanApproval).toBe(false);
  });

  it('should enforce System of Record supremacy on data conflict and raise an Attention item', async () => {
    const tenantId = 'tenant_conflict_test';

    const conflictResult = await governance.evaluateConflictWithSystemOfRecord(tenantId, {
      fieldName: 'contract_discount_pct',
      externalFact: {
        value: 25,
        sourceUrl: 'https://partner-portal.com/pricing',
        trustTier: 'TIER_C',
        citation: '[External: partner-portal.com]',
      },
      systemOfRecordFact: {
        value: 10,
        sourceName: 'SAP ERP Master Data',
        trustTier: 'TIER_A',
      },
      agentSlug: 'sales_agent',
      correlationId: 'corr_sor_test_1',
    });

    expect(conflictResult.hasConflict).toBe(true);
    expect(conflictResult.winningValue).toBe(10); // System of Record wins!
    expect(conflictResult.rejectedValue).toBe(25);
    expect(conflictResult.sourceOfTruth).toBe('system_of_record');
    expect(conflictResult.attentionItemCreated).toBe(true);
    expect(conflictResult.attentionItemId).toBeDefined();

    // Verify Attention Item exists in database
    const attentionItem = await TenantContextManager.withTenant(tenantId, 'default', async () => {
      return attentionRepo.findById(conflictResult.attentionItemId!);
    });
    expect(attentionItem).not.toBeNull();
    expect(attentionItem?.title).toContain('External Data Conflict: contract_discount_pct');
  });
});
