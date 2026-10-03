/**
 * Kriya Omnitask — Payment Webhook & Settlement Service (docs/kriya WP-4.4, WP-5.3)
 * Cryptographic verification for payment gateway webhooks with idempotent settlement,
 * automatic slot hold conversion, Customer 360 timeline trace, and Ed25519 proof receipts.
 */

import { DatabaseClient, db } from '../../storage/db.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';
import { PaymentLinkRepository } from '../repositories/paymentLinkRepository.js';
import { PaymentHoldRepository } from '../repositories/paymentHoldRepository.js';
import { AppointmentBook } from '../../scheduling/appointmentBook.js';
import { TimelineRepository } from '../../customer360/repositories/timelineRepository.js';
import { ProofService } from '../../trust/proof/proofService.js';
import { WebhookVerifier } from '../../channels/security/webhookVerifier.js';
import { UnauthorizedError, ValidationError, NotFoundError } from '../../core/errors/errors.js';
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface ProcessPaymentWebhookInput {
  provider: 'razorpay' | 'stripe' | 'kriya_pay';
  rawBody: string;
  signatureHeader?: string;
  webhookSecret: string;
}

export interface PaymentWebhookResult {
  handled: boolean;
  event: string;
  linkId?: string;
  holdId?: string;
  appointmentId?: string;
  amount?: number;
  currency?: string;
  status: 'paid' | 'failed' | 'ignored';
  receiptId?: string;
}

export class PaymentWebhookService {
  private client: DatabaseClient;
  private linkRepo: PaymentLinkRepository;
  private holdRepo: PaymentHoldRepository;
  private appointmentBook: AppointmentBook;
  private timelineRepo: TimelineRepository;
  private proofService: ProofService;

  constructor(deps: {
    client?: DatabaseClient;
    linkRepo?: PaymentLinkRepository;
    holdRepo?: PaymentHoldRepository;
    appointmentBook?: AppointmentBook;
    timelineRepo?: TimelineRepository;
    proofService?: ProofService;
  } = {}) {
    this.client = deps.client ?? db.getClient();
    this.linkRepo = deps.linkRepo ?? new PaymentLinkRepository(this.client);
    this.holdRepo = deps.holdRepo ?? new PaymentHoldRepository(this.client);
    this.appointmentBook = deps.appointmentBook ?? new AppointmentBook(this.client);
    this.timelineRepo = deps.timelineRepo ?? new TimelineRepository(this.client);
    this.proofService = deps.proofService ?? new ProofService(this.client);
  }

  /**
   * Verifies the cryptographic signature of an incoming payment gateway webhook.
   */
  public verifySignature(
    provider: 'razorpay' | 'stripe' | 'kriya_pay',
    rawBody: string,
    signatureHeader?: string,
    webhookSecret?: string
  ): boolean {
    if (!signatureHeader || !webhookSecret) return false;

    if (provider === 'razorpay' || provider === 'kriya_pay') {
      const expectedHash = createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
      const incomingBuffer = Buffer.from(signatureHeader, 'hex');
      const expectedBuffer = Buffer.from(expectedHash, 'hex');
      if (incomingBuffer.length !== expectedBuffer.length) return false;
      return timingSafeEqual(incomingBuffer, expectedBuffer);
    }

    if (provider === 'stripe') {
      // Stripe header format: t=timestamp,v1=signature
      const pairs = Object.fromEntries(
        signatureHeader.split(',').map((p) => {
          const [k, v] = p.trim().split('=');
          return [k, v];
        })
      );
      if (!pairs.t || !pairs.v1) return false;
      const signedPayload = `${pairs.t}.${rawBody}`;
      const expectedHash = createHmac('sha256', webhookSecret).update(signedPayload).digest('hex');
      const incomingBuffer = Buffer.from(pairs.v1, 'hex');
      const expectedBuffer = Buffer.from(expectedHash, 'hex');
      if (incomingBuffer.length !== expectedBuffer.length) return false;
      return timingSafeEqual(incomingBuffer, expectedBuffer);
    }

    return false;
  }

  /**
   * Processes a verified payment webhook and settles corresponding links, holds, and appointments.
   */
  public async processWebhook(params: ProcessPaymentWebhookInput): Promise<PaymentWebhookResult> {
    const isValid = this.verifySignature(params.provider, params.rawBody, params.signatureHeader, params.webhookSecret);
    if (!isValid) {
      throw new UnauthorizedError(`Invalid webhook signature for provider '${params.provider}'.`);
    }

    let payload: Record<string, any>;
    try {
      payload = JSON.parse(params.rawBody);
    } catch {
      throw new ValidationError('Malformed JSON payload in payment webhook.');
    }

    const event = String(payload.event || payload.type || 'payment.paid');
    const nowIso = new Date().toISOString();

    // Normalise payment reference (linkId or holdId)
    const entity = payload.payload?.payment_link?.entity || payload.data?.object || payload;
    const linkId = entity.id || entity.linkId || entity.metadata?.linkId || entity.notes?.linkId;
    const holdId = entity.holdId || entity.metadata?.holdId || entity.notes?.holdId;

    if (!linkId && !holdId) {
      return { handled: false, event, status: 'ignored' };
    }

    // Handle payment paid / succeeded
    if (
      event === 'payment_link.paid' ||
      event === 'payment.captured' ||
      event === 'payment_intent.succeeded' ||
      event === 'payment.paid'
    ) {
      let settledLink = linkId ? await this.linkRepo.getLink(linkId) : null;
      if (settledLink && settledLink.status !== 'paid') {
        settledLink = await this.linkRepo.markPaid(settledLink.id, nowIso);
      }

      let confirmedAptId = settledLink?.appointment_id;

      // Check if there is an active slot hold to confirm
      const targetHoldId = holdId || settledLink?.hold_id;
      if (targetHoldId) {
        try {
          const slotHold = await this.appointmentBook.getSlotHold(targetHoldId);
          if (slotHold && slotHold.status === 'active') {
            const apt = await this.appointmentBook.confirmHold({
              holdId: slotHold.id,
              customerRef: slotHold.customer_ref,
              idempotencyKey: `wh_confirm_${slotHold.id}`,
            });
            confirmedAptId = apt.id;
          }
        } catch {
          // If already converted or expired, continue
        }
      }

      // Record Customer 360 timeline event if customer exists
      const customerRef = settledLink?.customer_ref || entity.customerRef;
      if (customerRef) {
        const tenantId = TenantContextManager.getTenantId();
        const customerExists = await this.client.queryOne<{ id: string }>(
          'SELECT id FROM customers WHERE id = ? AND tenant_id = ?',
          [customerRef, tenantId]
        );
        if (customerExists) {
          await this.timelineRepo.appendEvent({
            customerId: customerRef,
            channel: 'web',
            eventType: 'payment.collected',
            summary: `Payment settled for ${settledLink?.amount ?? entity.amount} ${settledLink?.currency ?? 'INR'}`,
            details: {
              linkId,
              holdId: targetHoldId,
              appointmentId: confirmedAptId,
              amount: settledLink?.amount ?? entity.amount,
              currency: settledLink?.currency ?? 'INR',
              provider: params.provider,
            },
            actorType: 'system',
            actorId: `webhook_${params.provider}`,
          });
        }
      }

      // Issue offline Ed25519 proof receipt
      const receipt = await this.proofService.issue({
        runId: `run_pay_wh_${Date.now()}`,
        actionType: 'payment_settlement',
        riskTier: 'T2',
        actor: {
          agentSlug: 'payments',
          agentVersion: '1.0.0',
        },
        input: { provider: params.provider, linkId, holdId: targetHoldId },
        output: { linkId, status: 'paid', settledAt: nowIso },
        target: { system: params.provider, externalRef: linkId ?? targetHoldId },
        verification: { method: 'webhook_signature', state: 'verified', verifiedAt: nowIso },
      });

      return {
        handled: true,
        event,
        linkId: settledLink?.id,
        holdId: targetHoldId ?? undefined,
        appointmentId: confirmedAptId ?? undefined,
        amount: settledLink?.amount,
        currency: settledLink?.currency,
        status: 'paid',
        receiptId: receipt.body.receiptId,
      };
    }

    return {
      handled: true,
      event,
      linkId,
      holdId,
      status: 'failed',
    };
  }
}
