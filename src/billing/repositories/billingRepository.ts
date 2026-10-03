/**
 * Kriya AI — Billing & Usage Repository
 * Database access layer for plans, subscriptions, meter records, invoices, and line items.
 */

import { DatabaseClient } from '../../storage/db.js';
import {
  BillingPlan,
  TenantSubscription,
  UsageMeterRecord,
  Invoice,
  InvoiceLineItem,
} from '../types/billingTypes.js';

export class BillingRepository {
  constructor(private client: DatabaseClient) {}

  public async savePlan(plan: BillingPlan): Promise<void> {
    await this.client.execute(
      `INSERT INTO billing_plans (
        id, name, plan_tier, channel_plan, base_price_cents, currency, billing_interval,
        included_tokens, included_voice_minutes, included_workflow_executions, included_agents,
        token_overage_rate_cents_per_k, voice_minute_overage_rate_cents, workflow_overage_rate_cents,
        is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        plan_tier = excluded.plan_tier,
        channel_plan = excluded.channel_plan,
        base_price_cents = excluded.base_price_cents,
        included_tokens = excluded.included_tokens,
        included_voice_minutes = excluded.included_voice_minutes,
        included_workflow_executions = excluded.included_workflow_executions,
        included_agents = excluded.included_agents,
        token_overage_rate_cents_per_k = excluded.token_overage_rate_cents_per_k,
        voice_minute_overage_rate_cents = excluded.voice_minute_overage_rate_cents,
        workflow_overage_rate_cents = excluded.workflow_overage_rate_cents,
        is_active = excluded.is_active,
        updated_at = excluded.updated_at;`,
      [
        plan.id,
        plan.name,
        plan.planTier,
        plan.channelPlan,
        plan.basePriceCents,
        plan.currency,
        plan.billingInterval,
        plan.includedTokens,
        plan.includedVoiceMinutes,
        plan.includedWorkflowExecutions,
        plan.includedAgents,
        plan.tokenOverageRateCentsPerK,
        plan.voiceMinuteOverageRateCents,
        plan.workflowOverageRateCents,
        plan.isActive ? 1 : 0,
        plan.createdAt,
        plan.updatedAt,
      ]
    );
  }

  public async getPlanById(id: string): Promise<BillingPlan | null> {
    const rows = await this.client.query<any>('SELECT * FROM billing_plans WHERE id = ?;', [id]);
    if (!rows.length) return null;
    return this.mapRowToPlan(rows[0]);
  }

  public async listPlans(): Promise<BillingPlan[]> {
    const rows = await this.client.query<any>('SELECT * FROM billing_plans WHERE is_active = 1;');
    return rows.map((r: any) => this.mapRowToPlan(r));
  }

  public async saveSubscription(sub: TenantSubscription): Promise<void> {
    await this.client.execute(
      `INSERT INTO tenant_subscriptions (
        id, tenant_id, plan_id, status, current_period_start, current_period_end,
        cancel_at_period_end, stripe_customer_id, stripe_subscription_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        plan_id = excluded.plan_id,
        status = excluded.status,
        current_period_start = excluded.current_period_start,
        current_period_end = excluded.current_period_end,
        cancel_at_period_end = excluded.cancel_at_period_end,
        updated_at = excluded.updated_at;`,
      [
        sub.id,
        sub.tenantId,
        sub.planId,
        sub.status,
        sub.currentPeriodStart,
        sub.currentPeriodEnd,
        sub.cancelAtPeriodEnd ? 1 : 0,
        sub.stripeCustomerId ?? null,
        sub.stripeSubscriptionId ?? null,
        sub.createdAt,
        sub.updatedAt,
      ]
    );
  }

  public async getSubscriptionByTenantId(tenantId: string): Promise<TenantSubscription | null> {
    const rows = await this.client.query<any>(
      'SELECT * FROM tenant_subscriptions WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 1;',
      [tenantId]
    );
    if (!rows.length) return null;
    const r = rows[0];
    return {
      id: r.id,
      tenantId: r.tenant_id,
      planId: r.plan_id,
      status: r.status,
      currentPeriodStart: r.current_period_start,
      currentPeriodEnd: r.current_period_end,
      cancelAtPeriodEnd: Boolean(r.cancel_at_period_end),
      stripeCustomerId: r.stripe_customer_id ?? undefined,
      stripeSubscriptionId: r.stripe_subscription_id ?? undefined,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  public async updateSubscriptionStatus(id: string, status: TenantSubscription['status']): Promise<void> {
    const now = new Date().toISOString();
    await this.client.execute(
      'UPDATE tenant_subscriptions SET status = ?, updated_at = ? WHERE id = ?;',
      [status, now, id]
    );
  }

  public async saveMeterRecord(record: UsageMeterRecord): Promise<void> {
    await this.client.execute(
      `INSERT INTO usage_meter_records (
        id, tenant_id, metric_type, quantity, idempotency_key, recorded_at, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(idempotency_key) DO NOTHING;`,
      [
        record.id,
        record.tenantId,
        record.metricType,
        record.quantity,
        record.idempotencyKey ?? null,
        record.recordedAt,
        record.metadata ? JSON.stringify(record.metadata) : null,
      ]
    );
  }

  public async getMeterRecordsForTenant(
    tenantId: string,
    periodStart: string,
    periodEnd: string
  ): Promise<UsageMeterRecord[]> {
    const rows = await this.client.query<any>(
      'SELECT * FROM usage_meter_records WHERE tenant_id = ? AND recorded_at >= ? AND recorded_at <= ?;',
      [tenantId, periodStart, periodEnd]
    );
    return rows.map((r: any) => ({
      id: r.id,
      tenantId: r.tenant_id,
      metricType: r.metric_type,
      quantity: Number(r.quantity),
      idempotencyKey: r.idempotency_key ?? undefined,
      recordedAt: r.recorded_at,
      metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
    }));
  }

  public async saveInvoice(invoice: Invoice): Promise<void> {
    await this.client.execute(
      `INSERT INTO invoices (
        id, tenant_id, subscription_id, billing_period_start, billing_period_end,
        subtotal_amount_cents, tax_rate_pct, tax_amount_cents, discount_amount_cents,
        total_amount_cents, currency, status, stripe_payment_intent_id, paid_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        paid_at = excluded.paid_at,
        updated_at = excluded.updated_at;`,
      [
        invoice.id,
        invoice.tenantId,
        invoice.subscriptionId ?? null,
        invoice.billingPeriodStart,
        invoice.billingPeriodEnd,
        invoice.subtotalAmountCents,
        invoice.taxRatePct,
        invoice.taxAmountCents,
        invoice.discountAmountCents,
        invoice.totalAmountCents,
        invoice.currency,
        invoice.status,
        invoice.stripePaymentIntentId ?? null,
        invoice.paidAt ?? null,
        invoice.createdAt,
        invoice.updatedAt,
      ]
    );

    if (invoice.lineItems && invoice.lineItems.length > 0) {
      for (const li of invoice.lineItems) {
        await this.client.execute(
          `INSERT INTO invoice_line_items (
            id, invoice_id, item_type, description, quantity, unit_price_cents, amount_cents
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO NOTHING;`,
          [
            li.id,
            li.invoiceId,
            li.itemType,
            li.description,
            li.quantity,
            li.unitPriceCents,
            li.amountCents,
          ]
        );
      }
    }
  }

  public async getInvoiceById(id: string, tenantId?: string): Promise<Invoice | null> {
    const query = tenantId
      ? 'SELECT * FROM invoices WHERE id = ? AND tenant_id = ?;'
      : 'SELECT * FROM invoices WHERE id = ?;';
    const params = tenantId ? [id, tenantId] : [id];

    const rows = await this.client.query<any>(query, params);
    if (!rows.length) return null;

    const r = rows[0];
    const liRows = await this.client.query<any>(
      'SELECT * FROM invoice_line_items WHERE invoice_id = ?;',
      [id]
    );

    const lineItems: InvoiceLineItem[] = liRows.map((li: any) => ({
      id: li.id,
      invoiceId: li.invoice_id,
      itemType: li.item_type,
      description: li.description,
      quantity: Number(li.quantity),
      unitPriceCents: Number(li.unit_price_cents),
      amountCents: Number(li.amount_cents),
    }));

    return {
      id: r.id,
      tenantId: r.tenant_id,
      subscriptionId: r.subscription_id ?? undefined,
      billingPeriodStart: r.billing_period_start,
      billingPeriodEnd: r.billing_period_end,
      subtotalAmountCents: Number(r.subtotal_amount_cents),
      taxRatePct: Number(r.tax_rate_pct),
      taxAmountCents: Number(r.tax_amount_cents),
      discountAmountCents: Number(r.discount_amount_cents),
      totalAmountCents: Number(r.total_amount_cents),
      currency: r.currency,
      status: r.status,
      stripePaymentIntentId: r.stripe_payment_intent_id ?? undefined,
      paidAt: r.paid_at ?? undefined,
      lineItems,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  public async listInvoicesByTenant(tenantId: string): Promise<Invoice[]> {
    const rows = await this.client.query<any>(
      'SELECT * FROM invoices WHERE tenant_id = ? ORDER BY billing_period_end DESC;',
      [tenantId]
    );
    return rows.map((r: any) => ({
      id: r.id,
      tenantId: r.tenant_id,
      subscriptionId: r.subscription_id ?? undefined,
      billingPeriodStart: r.billing_period_start,
      billingPeriodEnd: r.billing_period_end,
      subtotalAmountCents: Number(r.subtotal_amount_cents),
      taxRatePct: Number(r.tax_rate_pct),
      taxAmountCents: Number(r.tax_amount_cents),
      discountAmountCents: Number(r.discount_amount_cents),
      totalAmountCents: Number(r.total_amount_cents),
      currency: r.currency,
      status: r.status,
      stripePaymentIntentId: r.stripe_payment_intent_id ?? undefined,
      paidAt: r.paid_at ?? undefined,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  public async updateInvoiceStatus(id: string, status: Invoice['status'], paidAt?: string): Promise<void> {
    const now = new Date().toISOString();
    await this.client.execute(
      'UPDATE invoices SET status = ?, paid_at = ?, updated_at = ? WHERE id = ?;',
      [status, paidAt ?? null, now, id]
    );
  }

  private mapRowToPlan(r: any): BillingPlan {
    return {
      id: r.id,
      name: r.name,
      planTier: r.plan_tier,
      channelPlan: r.channel_plan,
      basePriceCents: Number(r.base_price_cents),
      currency: r.currency,
      billingInterval: r.billing_interval,
      includedTokens: Number(r.included_tokens),
      includedVoiceMinutes: Number(r.included_voice_minutes),
      includedWorkflowExecutions: Number(r.included_workflow_executions),
      includedAgents: Number(r.included_agents),
      tokenOverageRateCentsPerK: Number(r.token_overage_rate_cents_per_k),
      voiceMinuteOverageRateCents: Number(r.voice_minute_overage_rate_cents),
      workflowOverageRateCents: Number(r.workflow_overage_rate_cents),
      isActive: Boolean(r.is_active),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }
}
