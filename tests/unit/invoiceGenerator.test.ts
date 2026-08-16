import { describe, it, expect } from 'vitest';
import { InvoiceGenerator } from '../../src/billing/invoicing/invoiceGenerator.js';
import { BillingPlan, OverageEvaluationResult } from '../../src/billing/types/billingTypes.js';

describe('InvoiceGenerator Unit Tests', () => {
  const plan: BillingPlan = {
    id: 'plan_starter_test',
    name: 'Starter Plan',
    planTier: 'starter',
    channelPlan: 'digital_only',
    basePriceCents: 19900, // $199.00
    currency: 'USD',
    billingInterval: 'month',
    includedTokens: 5_000_000,
    includedVoiceMinutes: 0,
    includedWorkflowExecutions: 500,
    includedAgents: 2,
    tokenOverageRateCentsPerK: 0.5,
    voiceMinuteOverageRateCents: 15.0,
    workflowOverageRateCents: 10.0,
    isActive: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };

  const overageResult: OverageEvaluationResult = {
    hasOverage: true,
    totalOverageAmountCents: 2500, // $25.00
    items: [
      {
        metricType: 'tokens',
        usedQuantity: 10_000_000,
        includedQuantity: 5_000_000,
        overageQuantity: 5_000_000,
        rateCentsPerUnit: 0.5,
        overageAmountCents: 2500,
      },
    ],
  };

  it('should generate an itemized invoice with base fee, overages, promotional discount, and taxes', () => {
    const invoice = InvoiceGenerator.generateInvoice({
      invoiceId: 'inv_test_100',
      tenantId: 'tenant_invoice_test',
      plan,
      overageResult,
      periodStart: '2026-03-01T00:00:00.000Z',
      periodEnd: '2026-03-31T23:59:59.000Z',
      discount: {
        discountCode: 'EARLYBIRD10',
        percentageDiscount: 10, // 10% off ($199 + $25 = $224 -> $22.40 -> 2240 cents)
        reason: 'Early adopter discount',
      },
      taxJurisdiction: {
        countryCode: 'US',
        regionCode: 'CA',
        taxRatePct: 8.5, // 8.5% tax on ($224 - $22.40 = $201.60 -> 20160 cents * 8.5% = 1714 cents)
        name: 'California State Sales Tax',
      },
    });

    expect(invoice.id).toBe('inv_test_100');
    expect(invoice.subtotalAmountCents).toBe(22400); // 19900 + 2500 = $224.00
    expect(invoice.discountAmountCents).toBe(2240); // 10% of 22400 = $22.40
    expect(invoice.taxAmountCents).toBe(1714); // 8.5% of (22400 - 2240 = 20160) = 1713.6 -> 1714 cents ($17.14)
    expect(invoice.totalAmountCents).toBe(21874); // 20160 + 1714 = $218.74
    expect(invoice.lineItems?.length).toBe(4); // Base, Token Overage, Discount, Tax
    expect(invoice.status).toBe('open');
  });
});
