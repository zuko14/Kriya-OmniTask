/**
 * Kriya AI — Document (Lens) Agent Unit Tests (docs/kriya WP-4.5)
 * Verifies L0 deterministic parsers (lab reports, prescriptions, invoices, ID cards),
 * zero-retention compliance, low-confidence Attention escalation, tenant isolation, and tools.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db, SQLiteDatabaseClient } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { TenantRepository } from '../../src/storage/repositories/tenantRepository.js';
import { TenantContextManager } from '../../src/core/context/tenantContext.js';
import {
  parseDeterministicLabReport,
  parseDeterministicPrescription,
  parseDeterministicInvoice,
  parseDeterministicIdCard,
  tryDeterministicParse,
} from '../../src/document/parsers/deterministicParsers.js';
import { DocumentRepository } from '../../src/document/repositories/documentRepository.js';
import { DocumentService } from '../../src/document/service/documentService.js';
import { documentTools } from '../../src/document/service/documentTools.js';
import { AttentionService } from '../../src/attention/service/attentionService.js';
import { DEFAULT_DOCUMENT_CHARTER } from '../../src/agents/phase0/documentAgent.js';
import { buildAgentFromCharter } from '../../src/agents/charter/agentCharter.js';
import { ToolRegistryService } from '../../src/tools/registry/toolRegistry.js';

describe('Document (Lens) Agent & Parsers (WP-4.5)', () => {
  let client: SQLiteDatabaseClient;
  let tenantA: string;
  let tenantB: string;

  const inA = <T>(fn: () => Promise<T>) =>
    TenantContextManager.withTenant(tenantA, 'default', fn, { userId: 'doc_op_a', roles: ['operations_lead'] });
  const inB = <T>(fn: () => Promise<T>) =>
    TenantContextManager.withTenant(tenantB, 'default', fn, { userId: 'doc_op_b', roles: ['operations_lead'] });

  beforeEach(async () => {
    client = new SQLiteDatabaseClient(':memory:');
    db.setClientForTesting(client);
    await new SchemaMigrator(client).applyMigrations();

    const tenants = new TenantRepository(client);
    tenantA = (await tenants.create({ name: 'Tenant A', slug: 'lens-a', plan_tier: 'enterprise', channel_plan: 'combined' })).id;
    tenantB = (await tenants.create({ name: 'Tenant B', slug: 'lens-b', plan_tier: 'enterprise', channel_plan: 'combined' })).id;
  });

  afterEach(async () => {
    await client.close();
  });

  describe('L0 Deterministic Parsers', () => {
    it('parses medical lab reports deterministically with reference ranges and abnormal flags', () => {
      const sampleReport = `
        METROPOLIS DIAGNOSTIC PATHOLOGY LABORATORY
        Patient Name: Rajesh Sharma
        Date: 2026-09-28
        Ref by: Dr. Rao

        TEST RESULTS:
        Haemoglobin : 11.2 g/dL (13.0 - 17.0)
        Glucose Fasting : 145 mg/dL (70 - 100)
        Total Cholesterol : 180 mg/dL (120 - 200)
      `;

      const res = parseDeterministicLabReport(sampleReport);
      expect(res.matched).toBe(true);
      expect(res.confidence).toBeGreaterThanOrEqual(0.85);
      expect(res.data?.patientName).toBe('Rajesh Sharma');
      expect(res.data?.testDate).toBe('2026-09-28');
      expect(res.data?.referringDoctor).toBe('Dr. Rao');

      const params = res.data?.parameters ?? [];
      expect(params.length).toBe(3);

      // Haemoglobin: 11.2 is below 13.0 -> low
      const hb = params.find((p) => /haemoglobin/i.test(p.parameter));
      expect(hb).toBeDefined();
      expect(hb?.value).toBe(11.2);
      expect(hb?.flag).toBe('low');

      // Glucose: 145 is above 100 -> high
      const glu = params.find((p) => /glucose/i.test(p.parameter));
      expect(glu?.value).toBe(145);
      expect(glu?.flag).toBe('high');

      // Cholesterol: 180 is within 120-200 -> normal
      const chol = params.find((p) => /cholesterol/i.test(p.parameter));
      expect(chol?.value).toBe(180);
      expect(chol?.flag).toBe('normal');
    });

    it('parses medical prescriptions deterministically with medications and instructions', () => {
      const sampleRx = `
        Dr. Sneha Kulkarni, MBBS, MD
        Reg No: NMC-789012
        City Health Clinic
        Patient: Ananya Roy
        Date: 2026-10-01
        Diagnosis: Acute Bronchitis

        Rx:
        1. Amoxicillin 500mg - Three times daily - 7 days
        2. Paracetamol 650mg - Twice daily - 5 days
        3. Levocetirizine 5mg - Once daily at night - 5 days
      `;

      const res = parseDeterministicPrescription(sampleRx);
      expect(res.matched).toBe(true);
      expect(res.confidence).toBeGreaterThanOrEqual(0.85);
      expect(res.data?.doctorName).toContain('Sneha Kulkarni');
      expect(res.data?.doctorRegistration).toBe('NMC-789012');
      expect(res.data?.patientName).toBe('Ananya Roy');
      expect(res.data?.diagnosis).toBe('Acute Bronchitis');

      const meds = res.data?.medications ?? [];
      expect(meds.length).toBe(3);
      expect(meds[0].name).toContain('Amoxicillin');
      expect(meds[0].dosage).toBe('500mg');
      expect(meds[0].frequency).toBe('Three times daily');
      expect(meds[0].duration).toBe('7 days');
    });

    it('parses commercial invoices deterministically with line items and totals', () => {
      const sampleInvoice = `
        TAX INVOICE
        Invoice No: INV-2026-8810
        Date: 2026-09-30
        Vendor: Apex Medical Supplies Pvt Ltd
        Bill To: Apollo Specialty Care

        Items:
        Surgical Gloves Latex | 10 | 15.00 | 150.00
        Digital Thermometer Probe | 2 | 45.00 | 90.00

        Subtotal: 240.00
        GST: 43.20
        Grand Total: 283.20
      `;

      const res = parseDeterministicInvoice(sampleInvoice);
      expect(res.matched).toBe(true);
      expect(res.confidence).toBeGreaterThanOrEqual(0.9);
      expect(res.data?.invoiceNumber).toBe('INV-2026-8810');
      expect(res.data?.vendorName).toContain('Apex Medical Supplies');
      expect(res.data?.customerName).toContain('Apollo Specialty Care');
      expect(res.data?.subtotal).toBe(240);
      expect(res.data?.taxAmount).toBe(43.2);
      expect(res.data?.grandTotal).toBe(283.2);

      const items = res.data?.lineItems ?? [];
      expect(items.length).toBe(2);
      expect(items[0].description).toBe('Surgical Gloves Latex');
      expect(items[0].quantity).toBe(10);
      expect(items[0].unitPrice).toBe(15);
    });

    it('parses identity cards deterministically with masking', () => {
      const sampleAadhaar = `
        Government of India
        Aadhaar Card
        Name: Vikramaditya Verma
        DOB: 15/08/1988
        Gender: Male
        4123 8899 7766
      `;

      const resAadhaar = parseDeterministicIdCard(sampleAadhaar);
      expect(resAadhaar.matched).toBe(true);
      expect(resAadhaar.data?.idType).toBe('aadhaar');
      expect(resAadhaar.data?.maskedIdNumber).toBe('XXXX-XXXX-7766');
      expect(resAadhaar.data?.holderName).toBe('Vikramaditya Verma');
      expect(resAadhaar.data?.dateOfBirth).toBe('15/08/1988');

      const samplePan = `
        INCOME TAX DEPARTMENT
        GOVT OF INDIA
        Permanent Account Number Card
        Name: Priya Venkat
        DOB: 22/04/1992
        ABCDE1234F
      `;

      const resPan = parseDeterministicIdCard(samplePan);
      expect(resPan.matched).toBe(true);
      expect(resPan.data?.idType).toBe('pan');
      expect(resPan.data?.idNumber).toBe('ABCDE1234F');
      expect(resPan.data?.maskedIdNumber).toBe('XXXXX1234F');
    });

    it('auto-dispatches to correct parser when no hint is provided', () => {
      const rxText = 'Dr. Rao\nDate: 2026-10-01\nRx: Metformin 500mg - once daily';
      const dispatched = tryDeterministicParse(rxText);
      expect(dispatched.matched).toBe(true);
      expect(dispatched.documentType).toBe('prescription');
    });
  });

  describe('Document Service & Zero-Retention Compliance', () => {
    it('extracts and persists document while strictly enforcing zero-retention of raw bytes', async () => {
      await inA(async () => {
        const attention = new AttentionService(client);
        const service = new DocumentService(client, undefined, attention);

        const rawDocument = `
          TAX INVOICE
          Invoice #: INV-9901
          Date: 2026-10-01
          Vendor: Diagnostic Labs Inc
          Items:
          Blood Chemistry Panel | 1 | 120.00 | 120.00
          Subtotal: 120.00
          Grand Total: 120.00
        `;

        const res = await service.parseDocument({
          rawContent: rawDocument,
          documentType: 'invoice',
          correlationId: 'doc-test-1',
        });

        expect(res.id).toBeDefined();
        expect(res.status).toBe('verified');
        expect(res.extractionMethod).toBe('L0_deterministic');
        expect(res.confidence).toBeGreaterThanOrEqual(0.85);
        expect(res.isValid).toBe(true);
        expect(res.structuredData.invoiceNumber).toBe('INV-9901');

        // Verify Zero-Retention: Query raw database row to ensure rawContent column does not exist!
        const rows = await client.query<Record<string, unknown>>(
          'SELECT * FROM parsed_documents WHERE id = ?;',
          [res.id]
        );
        expect(rows.length).toBe(1);
        expect(rows[0].raw_content).toBeUndefined();
        expect(rows[0].raw_text).toBeUndefined();
        expect(rows[0].raw_bytes).toBeUndefined();
        expect(rows[0].sha256_hash).toBe(res.sha256Hash);
        expect(JSON.parse(rows[0].structured_data_json as string).invoiceNumber).toBe('INV-9901');

        // Test deduplication / idempotent cache: parsing identical text returns existing record
        const res2 = await service.parseDocument({
          rawContent: rawDocument,
          documentType: 'invoice',
        });
        expect(res2.id).toBe(res.id);
        expect(res2.sha256Hash).toBe(res.sha256Hash);
      });
    });

    it('fails closed and escalates low-confidence/corrupted documents into Attention Center', async () => {
      await inA(async () => {
        const attention = new AttentionService(client);
        const service = new DocumentService(client, undefined, attention);

        // Ambiguous, corrupted document that cannot be deterministically extracted
        const corruptedDoc = 'Random garbled noise with no recognized invoice or lab report structure 12345';

        const res = await service.parseDocument({
          rawContent: corruptedDoc,
          correlationId: 'corrupt-1',
          confidenceThreshold: 0.8,
        });

        expect(res.status).toBe('low_confidence');
        expect(res.escalatedToAttention).toBe(true);
        expect(res.attentionItemId).toBeDefined();

        // Check Attention Center queue
        const attentionItem = await attention.getItem(res.attentionItemId!);
        expect(attentionItem.reason_category).toBe('low_confidence');
        expect(attentionItem.priority).toBe('P2_MEDIUM');
        expect(attentionItem.source_agent_id).toBe('specialist.document');
        expect(attentionItem.title).toContain('Low confidence document parse');
      });
    });

    it('strictly isolates parsed documents between tenants', async () => {
      let docAId: string;

      await inA(async () => {
        const service = new DocumentService(client);
        const res = await service.parseDocument({
          rawContent: 'Dr. John\nDate: 2026-10-01\nRx: Aspirin 75mg - once daily',
          correlationId: 'tenant-doc-1',
        });
        docAId = res.id;
      });

      await inB(async () => {
        const service = new DocumentService(client);
        const repo = new DocumentRepository(client);

        // Tenant B cannot find Tenant A's parsed document
        const doc = await repo.findById(docAId);
        expect(doc).toBeNull();
      });
    });
  });

  describe('Document Tools & Charter', () => {
    it('executes doc_parse tool with read-back verification', async () => {
      await inA(async () => {
        const attention = new AttentionService(client);
        const service = new DocumentService(client, undefined, attention);
        const tools = documentTools(() => service);
        const toolMap = new Map(tools.map((t) => [t.definition.slug, t]));

        const parseTool = toolMap.get('doc_parse')!;
        expect(parseTool.verify).toBeDefined();

        const input = {
          rawContent: 'Dr. Sneha\nDate: 2026-10-01\nRx: Paracetamol 500mg - twice daily',
          documentType: 'prescription',
          correlationId: 'tool-doc-1',
        };

        const out = await parseTool.handler(input, {} as any);
        expect((out.result as any).status).toBe('verified');

        const verification = await parseTool.verify!(input, out, {} as any);
        expect(verification.state).toBe('verified');
        expect((verification.observed as any).status).toBe('verified');
      });
    });

    it('executes doc_validate_schema tool correctly', async () => {
      await inA(async () => {
        const service = new DocumentService(client);
        const tools = documentTools(() => service);
        const validateTool = tools.find((t) => t.definition.slug === 'doc_validate_schema')!;

        // Valid invoice data
        const validRes = await validateTool.handler(
          {
            documentType: 'invoice',
            data: {
              invoiceNumber: 'INV-1',
              invoiceDate: '2026-10-01',
              vendorName: 'Apex Labs',
              currency: 'INR',
              lineItems: [{ description: 'Test', quantity: 1, unitPrice: 100, total: 100 }],
              subtotal: 100,
              taxAmount: 18,
              grandTotal: 118,
            },
          },
          {} as any
        );
        expect(validRes.isValid).toBe(true);

        // Invalid invoice data (missing required grandTotal and lineItems)
        const invalidRes = await validateTool.handler(
          {
            documentType: 'invoice',
            data: { invoiceNumber: 'INV-2' },
          },
          {} as any
        );
        expect(invalidRes.isValid).toBe(false);
        expect((invalidRes.errors as string[]).length).toBeGreaterThan(0);
      });
    });

    it('builds Document agent from charter', async () => {
      const registry = new ToolRegistryService();
      const agent = buildAgentFromCharter(DEFAULT_DOCUMENT_CHARTER, { registry });
      expect(agent.agentSlug).toBe('document');
      expect(agent.graph.nodes.some((n) => n.id === 'plan')).toBe(true);
      expect(agent.graph.nodes.some((n) => n.id === 'finish')).toBe(true);
    });
  });
});
