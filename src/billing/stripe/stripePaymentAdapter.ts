/**
 * Xylarc AI — Stripe Payment & Webhook Adapter
 * Integrates Stripe checkout, payment intents, and asynchronous webhook lifecycle events.
 */

import { Invoice, TenantSubscription } from '../types/billingTypes.js';

export interface StripePaymentIntentResult {
  paymentIntentId: string;
  clientSecret: string;
  amountCents: number;
  currency: string;
  status: 'requires_payment_method' | 'requires_confirmation' | 'succeeded' | 'processing';
}

export interface StripeWebhookEvent {
  id: string;
  type:
    | 'payment_intent.succeeded'
    | 'payment_intent.payment_failed'
    | 'customer.subscription.updated'
    | 'customer.subscription.deleted';
  data: {
    object: Record<string, any>;
  };
  created: number;
}

export class StripePaymentAdapter {
  /**
   * Creates a PaymentIntent for an open invoice.
   */
  public static createPaymentIntent(invoice: Invoice): StripePaymentIntentResult {
    const paymentIntentId = `pi_${invoice.id.replace('inv_', '')}_${Date.now()}`;
    return {
      paymentIntentId,
      clientSecret: `${paymentIntentId}_secret_mock`,
      amountCents: invoice.totalAmountCents,
      currency: invoice.currency.toLowerCase(),
      status: 'requires_confirmation',
    };
  }

  /**
   * Handles incoming Stripe webhooks and calculates appropriate entity state updates.
   */
  public static processWebhookEvent(event: StripeWebhookEvent): {
    handled: boolean;
    invoiceStatusUpdate?: { invoiceId: string; status: Invoice['status']; paidAt?: string };
    subscriptionStatusUpdate?: { subscriptionId: string; status: TenantSubscription['status'] };
  } {
    switch (event.type) {
      case 'payment_intent.succeeded': {
        const invoiceId = event.data.object.metadata?.invoiceId || event.data.object.invoice_id;
        if (!invoiceId) return { handled: false };
        return {
          handled: true,
          invoiceStatusUpdate: {
            invoiceId,
            status: 'paid',
            paidAt: new Date(event.created * 1000).toISOString(),
          },
        };
      }

      case 'payment_intent.payment_failed': {
        const invoiceId = event.data.object.metadata?.invoiceId || event.data.object.invoice_id;
        if (!invoiceId) return { handled: false };
        return {
          handled: true,
          invoiceStatusUpdate: {
            invoiceId,
            status: 'open',
          },
        };
      }

      case 'customer.subscription.deleted': {
        const subscriptionId = event.data.object.id;
        if (!subscriptionId) return { handled: false };
        return {
          handled: true,
          subscriptionStatusUpdate: {
            subscriptionId,
            status: 'canceled',
          },
        };
      }

      default:
        return { handled: false };
    }
  }
}
