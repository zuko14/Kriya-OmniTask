/**
 * Kriya AI — Billing & Usage Service
 * Orchestrates subscriptions, usage ingestion, overage calculation, invoicing, and Stripe payments.
 */

import { CryptoUtils } from '../../core/utils/crypto.js';
import { BillingRepository } from '../repositories/billingRepository.js';
import { ChannelPricingCatalog } from '../pricing/channelPricingCatalog.js';
import { UsageMeteringEngine } from '../metering/usageMeteringEngine.js';
import { OverageEvaluator } from '../overage/overageEvaluator.js';
import { InvoiceGenerator } from '../invoicing/invoiceGenerator.js';
import { StripePaymentAdapter, StripeWebhookEvent, StripePaymentIntentResult } from '../stripe/stripePaymentAdapter.js';
import {
  BillingPlan,
  TenantSubscription,
  UsageMeterRecord,
  UsageSummary,
  Invoice,
  DiscountPolicy,
  TaxJurisdiction,
  PlanTier,
  ChannelPlan,
} from '../types/billingTypes.js';
import { NotFoundError, ValidationError } from '../../core/errors/errors.js';
import { logger } from '../../core/logger/logger.js';

export class BillingService {
  constructor(private repo: BillingRepository) {}

  /**
   * Initializes standard catalog plans in the repository if not already present.
   */
  public async initializeDefaultPlans(): Promise<void> {
    const defaultPlans = ChannelPricingCatalog.getAllDefaultPlans();
    const now = new Date().toISOString();

    for (const p of defaultPlans) {
      const existing = await this.repo.getPlanById(p.id);
      if (!existing) {
        await this.repo.savePlan({
          ...p,
          createdAt: now,
          updatedAt: now,
        });
      }
    }
  }

  /**
   * Provisions or upgrades a tenant's subscription to a plan.
   */
  public async subscribeTenant(
    tenantId: string,
    planTier: PlanTier,
    channelPlan: ChannelPlan = 'combined'
  ): Promise<TenantSubscription> {
    await this.initializeDefaultPlans();
    const planId = `plan_${planTier}_${channelPlan}`;
    let plan = await this.repo.getPlanById(planId);

    if (!plan) {
      const template = ChannelPricingCatalog.getDefaultPlanTemplate(planTier, channelPlan);
      const now = new Date().toISOString();
      plan = {
        id: planId,
        ...template,
        createdAt: now,
        updatedAt: now,
      };
      await this.repo.savePlan(plan);
    }

    const now = new Date();
    const periodStart = now.toISOString();
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate()).toISOString();

    const existingSub = await this.repo.getSubscriptionByTenantId(tenantId);
    const subId = existingSub ? existingSub.id : `sub_${CryptoUtils.generateId()}`;

    const subscription: TenantSubscription = {
      id: subId,
      tenantId,
      planId: plan.id,
      status: 'active',
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: false,
      createdAt: existingSub ? existingSub.createdAt : periodStart,
      updatedAt: periodStart,
    };

    await this.repo.saveSubscription(subscription);
    logger.info(`Subscribed tenant ${tenantId} to plan ${plan.name} (${plan.id})`);
    return subscription;
  }

  /**
   * Ingests a raw usage event into the metering ledger.
   */
  public async recordUsage(
    tenantId: string,
    metricType: UsageMeterRecord['metricType'],
    quantity: number,
    idempotencyKey?: string,
    metadata?: Record<string, any>
  ): Promise<UsageMeterRecord> {
    if (quantity < 0) {
      throw new ValidationError('Usage quantity cannot be negative');
    }

    const record: UsageMeterRecord = {
      id: `meter_${CryptoUtils.generateId()}`,
      tenantId,
      metricType,
      quantity,
      idempotencyKey,
      recordedAt: new Date().toISOString(),
      metadata,
    };

    await this.repo.saveMeterRecord(record);
    return record;
  }

  /**
   * Computes the current cycle's aggregated usage summary for a tenant.
   */
  public async getTenantUsageSummary(
    tenantId: string,
    periodStart?: string,
    periodEnd?: string
  ): Promise<UsageSummary> {
    let start = periodStart;
    let end = periodEnd;

    if (!start || !end) {
      const sub = await this.repo.getSubscriptionByTenantId(tenantId);
      if (sub) {
        start = sub.currentPeriodStart;
        end = sub.currentPeriodEnd;
      } else {
        const now = new Date();
        start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
        end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString();
      }
    }

    const records = await this.repo.getMeterRecordsForTenant(tenantId, start, end);
    return UsageMeteringEngine.aggregateUsage(tenantId, records, start, end);
  }

  /**
   * Generates a draft/open invoice for a tenant for the specified billing cycle.
   */
  public async generateInvoice(
    tenantId: string,
    periodStart: string,
    periodEnd: string,
    discount?: DiscountPolicy,
    taxJurisdiction?: TaxJurisdiction
  ): Promise<Invoice> {
    const sub = await this.repo.getSubscriptionByTenantId(tenantId);
    let plan: BillingPlan | null = null;

    if (sub) {
      plan = await this.repo.getPlanById(sub.planId);
    }

    if (!plan) {
      plan = await this.repo.getPlanById('plan_starter_digital');
      if (!plan) {
        const template = ChannelPricingCatalog.getDefaultPlanTemplate('starter', 'digital_only');
        const now = new Date().toISOString();
        plan = {
          id: 'plan_starter_digital',
          ...template,
          createdAt: now,
          updatedAt: now,
        };
        await this.repo.savePlan(plan);
      }
    }

    const records = await this.repo.getMeterRecordsForTenant(tenantId, periodStart, periodEnd);
    const usageSummary = UsageMeteringEngine.aggregateUsage(tenantId, records, periodStart, periodEnd);
    const overageResult = OverageEvaluator.calculateOverages(usageSummary, plan);

    const invoiceId = `inv_${CryptoUtils.generateId()}`;
    const invoice = InvoiceGenerator.generateInvoice({
      invoiceId,
      tenantId,
      subscriptionId: sub?.id,
      plan,
      overageResult,
      periodStart,
      periodEnd,
      discount,
      taxJurisdiction,
    });

    await this.repo.saveInvoice(invoice);
    logger.info(`Generated invoice ${invoiceId} for tenant ${tenantId}: Total $${invoice.totalAmountCents / 100}`);
    return invoice;
  }

  /**
   * Creates a payment intent for an invoice.
   */
  public async createPaymentIntent(invoiceId: string, tenantId: string): Promise<StripePaymentIntentResult> {
    const invoice = await this.repo.getInvoiceById(invoiceId, tenantId);
    if (!invoice) {
      throw new NotFoundError(`Invoice ${invoiceId} not found`);
    }

    const intent = StripePaymentAdapter.createPaymentIntent(invoice);
    await this.repo.updateInvoiceStatus(invoiceId, 'open');
    return intent;
  }

  /**
   * Processes an incoming Stripe asynchronous webhook event.
   */
  public async handleStripeWebhook(event: StripeWebhookEvent): Promise<{ handled: boolean }> {
    const result = StripePaymentAdapter.processWebhookEvent(event);

    if (result.invoiceStatusUpdate) {
      await this.repo.updateInvoiceStatus(
        result.invoiceStatusUpdate.invoiceId,
        result.invoiceStatusUpdate.status,
        result.invoiceStatusUpdate.paidAt
      );
      logger.info(`Updated invoice ${result.invoiceStatusUpdate.invoiceId} to status ${result.invoiceStatusUpdate.status}`);
    }

    if (result.subscriptionStatusUpdate) {
      await this.repo.updateSubscriptionStatus(
        result.subscriptionStatusUpdate.subscriptionId,
        result.subscriptionStatusUpdate.status
      );
      logger.info(`Updated subscription ${result.subscriptionStatusUpdate.subscriptionId} to status ${result.subscriptionStatusUpdate.status}`);
    }

    return { handled: result.handled };
  }

  public async getSubscription(tenantId: string): Promise<TenantSubscription | null> {
    return this.repo.getSubscriptionByTenantId(tenantId);
  }

  public async getInvoice(invoiceId: string, tenantId: string): Promise<Invoice | null> {
    return this.repo.getInvoiceById(invoiceId, tenantId);
  }

  public async listInvoices(tenantId: string): Promise<Invoice[]> {
    return this.repo.listInvoicesByTenant(tenantId);
  }

  public async listPlans(): Promise<BillingPlan[]> {
    await this.initializeDefaultPlans();
    return this.repo.listPlans();
  }
}
