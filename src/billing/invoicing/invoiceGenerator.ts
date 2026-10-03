/**
 * Kriya AI — Enterprise Invoice Generator
 * Synthesizes base subscriptions, overages, promotional discounts, and localized taxes into deterministic invoices.
 */

import {
  BillingPlan,
  Invoice,
  InvoiceLineItem,
  OverageEvaluationResult,
  DiscountPolicy,
  TaxJurisdiction,
} from '../types/billingTypes.js';

export interface InvoiceGenerationOptions {
  invoiceId: string;
  tenantId: string;
  subscriptionId?: string;
  plan: BillingPlan;
  overageResult: OverageEvaluationResult;
  periodStart: string;
  periodEnd: string;
  discount?: DiscountPolicy;
  taxJurisdiction?: TaxJurisdiction;
}

export class InvoiceGenerator {
  /**
   * Generates a fully itemized invoice with subtotal, discounts, taxes, and overages.
   */
  public static generateInvoice(options: InvoiceGenerationOptions): Invoice {
    const {
      invoiceId,
      tenantId,
      subscriptionId,
      plan,
      overageResult,
      periodStart,
      periodEnd,
      discount,
      taxJurisdiction,
    } = options;

    const lineItems: InvoiceLineItem[] = [];

    // 1. Base Subscription Fee
    lineItems.push({
      id: `li_base_${invoiceId}`,
      invoiceId,
      itemType: 'base_subscription',
      description: `${plan.name} (${periodStart.split('T')[0]} to ${periodEnd.split('T')[0]})`,
      quantity: 1.0,
      unitPriceCents: plan.basePriceCents,
      amountCents: plan.basePriceCents,
    });

    let subtotalCents = plan.basePriceCents;

    // 2. Overages
    for (const item of overageResult.items) {
      let itemType: InvoiceLineItem['itemType'] = 'token_overage';
      let desc = '';

      if (item.metricType === 'tokens') {
        itemType = 'token_overage';
        desc = `Token Overage: ${item.overageQuantity.toLocaleString()} tokens ($${item.rateCentsPerUnit / 100} / 1k)`;
      } else if (item.metricType === 'voice_minutes') {
        itemType = 'voice_overage';
        desc = `Voice Minutes Overage: ${item.overageQuantity.toLocaleString()} minutes ($${item.rateCentsPerUnit / 100} / min)`;
      } else if (item.metricType === 'workflow_executions') {
        itemType = 'workflow_overage';
        desc = `Workflow Runs Overage: ${item.overageQuantity.toLocaleString()} executions ($${item.rateCentsPerUnit / 100} / run)`;
      }

      lineItems.push({
        id: `li_${item.metricType}_${invoiceId}`,
        invoiceId,
        itemType,
        description: desc,
        quantity: item.overageQuantity,
        unitPriceCents: Math.round(item.rateCentsPerUnit),
        amountCents: item.overageAmountCents,
      });

      subtotalCents += item.overageAmountCents;
    }

    // 3. Discounts
    let discountCents = 0;
    if (discount) {
      if (discount.fixedDiscountCents && discount.fixedDiscountCents > 0) {
        discountCents += discount.fixedDiscountCents;
      }
      if (discount.percentageDiscount && discount.percentageDiscount > 0) {
        const pctDiscount = Math.round(subtotalCents * (discount.percentageDiscount / 100));
        discountCents += pctDiscount;
      }
      discountCents = Math.min(discountCents, subtotalCents); // Cannot discount more than subtotal

      if (discountCents > 0) {
        lineItems.push({
          id: `li_disc_${invoiceId}`,
          invoiceId,
          itemType: 'discount',
          description: discount.reason || `Promotional Discount (${discount.discountCode || 'Applied'})`,
          quantity: 1.0,
          unitPriceCents: -discountCents,
          amountCents: -discountCents,
        });
      }
    }

    const netTaxableCents = Math.max(0, subtotalCents - discountCents);

    // 4. Tax
    const taxRatePct = taxJurisdiction?.taxRatePct ?? 0;
    let taxAmountCents = 0;
    if (taxRatePct > 0) {
      taxAmountCents = Math.round(netTaxableCents * (taxRatePct / 100));
      if (taxAmountCents > 0) {
        lineItems.push({
          id: `li_tax_${invoiceId}`,
          invoiceId,
          itemType: 'tax',
          description: `${taxJurisdiction?.name || 'Jurisdiction Tax'} (${taxRatePct}%)`,
          quantity: 1.0,
          unitPriceCents: taxAmountCents,
          amountCents: taxAmountCents,
        });
      }
    }

    // 5. Total
    const totalAmountCents = netTaxableCents + taxAmountCents;
    const now = new Date().toISOString();

    return {
      id: invoiceId,
      tenantId,
      subscriptionId,
      billingPeriodStart: periodStart,
      billingPeriodEnd: periodEnd,
      subtotalAmountCents: subtotalCents,
      taxRatePct,
      taxAmountCents,
      discountAmountCents: discountCents,
      totalAmountCents,
      currency: plan.currency,
      status: 'open',
      lineItems,
      createdAt: now,
      updatedAt: now,
    };
  }
}
