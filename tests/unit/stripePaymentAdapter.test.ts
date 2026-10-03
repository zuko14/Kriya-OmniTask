import { describe, it, expect } from 'vitest';
import { StripePaymentAdapter, StripeWebhookEvent } from '../../src/billing/stripe/stripePaymentAdapter.js';
import { Invoice } from '../../src/billing/types/billingTypes.js';

describe('StripePaymentAdapter Unit Tests', () => {
  const invoice: Invoice = {
    id: 'inv_stripe_test',
    tenantId: 'tenant_stripe',
    billingPeriodStart: '2026-03-01T00:00:00Z',
    billingPeriodEnd: '2026-03-31T23:59:59Z',
    subtotalAmountCents: 19900,
    taxRatePct: 0,
    taxAmountCents: 0,
    discountAmountCents: 0,
    totalAmountCents: 19900,
    currency: 'USD',
    status: 'open',
    createdAt: '2026-03-01T00:00:00Z',
    updatedAt: '2026-03-01T00:00:00Z',
  };

  it('should generate a valid payment intent structure from an invoice', () => {
    const intent = StripePaymentAdapter.createPaymentIntent(invoice);
    // Sandbox-only simulated intent: the ID must be visibly labelled as sandbox.
    expect(intent.paymentIntentId).toContain('pi_sandbox_stripe_test');
    expect(intent.amountCents).toBe(19900);
    expect(intent.currency).toBe('usd');
    expect(intent.status).toBe('requires_confirmation');
  });

  it('should handle payment_intent.succeeded webhook and trigger invoice paid status', () => {
    const webhookEvent: StripeWebhookEvent = {
      id: 'evt_12345',
      type: 'payment_intent.succeeded',
      created: 1772366400,
      data: {
        object: {
          id: 'pi_test_123',
          metadata: {
            invoiceId: 'inv_stripe_test',
          },
        },
      },
    };

    const res = StripePaymentAdapter.processWebhookEvent(webhookEvent);
    expect(res.handled).toBe(true);
    expect(res.invoiceStatusUpdate?.invoiceId).toBe('inv_stripe_test');
    expect(res.invoiceStatusUpdate?.status).toBe('paid');
    expect(res.invoiceStatusUpdate?.paidAt).toBeDefined();
  });

  it('should handle customer.subscription.deleted webhook and update subscription to canceled', () => {
    const webhookEvent: StripeWebhookEvent = {
      id: 'evt_sub_del',
      type: 'customer.subscription.deleted',
      created: 1772366400,
      data: {
        object: {
          id: 'sub_active_123',
        },
      },
    };

    const res = StripePaymentAdapter.processWebhookEvent(webhookEvent);
    expect(res.handled).toBe(true);
    expect(res.subscriptionStatusUpdate?.subscriptionId).toBe('sub_active_123');
    expect(res.subscriptionStatusUpdate?.status).toBe('canceled');
  });
});
