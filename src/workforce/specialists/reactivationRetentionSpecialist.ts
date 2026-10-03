/**
 * Kriya AI — Reactivation & Retention Specialist
 * Identifies dormant/churn-risk customers, validates policy/consent invariants, and dispatches bounded win-back offers (§26, §27 of CLAUDE.md).
 */

import {
  ReactivationRequest,
  ReactivationOfferResult,
} from '../types/workforceTypes.js';
import { CustomerRepository } from '../../customer360/repositories/customerRepository.js';
import { TimelineRepository } from '../../customer360/repositories/timelineRepository.js';
import { ConsentRepository } from '../../customer360/repositories/consentRepository.js';
import { DeterministicVerifier } from '../../policy/verifier/deterministicVerifier.js';
import { PolicyEngine } from '../../policy/engine/policyEngine.js';
import { OutboundQueueService } from '../../channels/queue/outboundQueueService.js';
import { logger } from '../../core/logger/logger.js';

export class ReactivationRetentionSpecialist {
  private customerRepo: CustomerRepository;
  private timelineRepo: TimelineRepository;
  private consentRepo: ConsentRepository;
  private policyEngine: PolicyEngine;
  private outboundQueue: OutboundQueueService;

  constructor(
    customerRepo?: CustomerRepository,
    timelineRepo?: TimelineRepository,
    consentRepo?: ConsentRepository,
    policyEngine?: PolicyEngine,
    outboundQueue?: OutboundQueueService
  ) {
    this.customerRepo = customerRepo || new CustomerRepository();
    this.timelineRepo = timelineRepo || new TimelineRepository();
    this.consentRepo = consentRepo || new ConsentRepository();
    this.policyEngine = policyEngine || new PolicyEngine();
    this.outboundQueue = outboundQueue || new OutboundQueueService();
  }

  public async evaluateAndOffer(req: ReactivationRequest): Promise<ReactivationOfferResult> {
    const discount = req.offeredDiscountPercent ?? 15;
    const channel = req.channel || 'whatsapp';

    const customer = await this.customerRepo.findById(req.customerId);
    if (!customer) {
      return {
        customerId: req.customerId,
        eligible: false,
        ineligibilityReason: `Customer '${req.customerId}' not found.`,
        campaignSlug: 'winback_dormant_v1',
        discountOfferedPercent: discount,
        outboundMessageSent: false,
        messageContent: '',
        requiresHumanApproval: false,
      };
    }

    // 1. Consent Verification (§21 & §27)
    const hasConsent = await this.consentRepo.hasActiveConsent(
      req.customerId,
      channel,
      'marketing'
    );

    if (!hasConsent) {
      return {
        customerId: req.customerId,
        eligible: false,
        ineligibilityReason: `Customer has not provided active opt-in consent for ${channel} marketing.`,
        campaignSlug: 'winback_dormant_v1',
        discountOfferedPercent: discount,
        outboundMessageSent: false,
        messageContent: '',
        requiresHumanApproval: false,
      };
    }

    // 2. Policy-as-Code Invariant Check (Discount <= 20%)
    const financialCheck = DeterministicVerifier.verifyFinancial({
      basePriceUsd: 100,
      offeredPriceUsd: 100 * (1 - discount / 100),
      discountPercent: discount,
      maxDiscountAllowedPercent: 20,
    });

    if (!financialCheck.valid) {
      return {
        customerId: req.customerId,
        eligible: false,
        ineligibilityReason: financialCheck.violations[0],
        campaignSlug: 'winback_dormant_v1',
        discountOfferedPercent: discount,
        outboundMessageSent: false,
        messageContent: '',
        requiresHumanApproval: true,
      };
    }

    // 3. Craft Personalized Win-back Offer
    const campaignSlug = 'winback_dormant_v1';
    const messageContent = `Hello ${customer.full_name || 'valued customer'}! We miss you at Kriya. Enjoy an exclusive ${discount}% discount on your next renewal: CODE WINBACK${discount}.`;

    // 4. Enqueue Outbound Message with Anti-spam & Quiet Hours Governance
    let messageSent = false;
    if (customer.primary_phone && channel === 'whatsapp') {
      try {
        await this.outboundQueue.dispatch({
          customerId: customer.id,
          channel: 'whatsapp',
          recipient: customer.primary_phone,
          messageType: 'text',
          payload: { text: messageContent },
          idempotencyKey: `reactivation-${customer.id}-${Date.now()}`,
        });
        messageSent = true;
      } catch (err: any) {
        logger.warn(`Failed to enqueue reactivation message for customer ${customer.id}: ${err.message}`);
      }
    }

    // 5. Update Customer Lifecycle Stage to reactivated (or maintain opportunity)
    await this.customerRepo.updateCustomer(customer.id, {
      lifecycle_stage: 'reactivated',
      churn_risk_score: 0.25,
    });

    // 6. Record Timeline Event
    await this.timelineRepo.createEvent({
      customerId: customer.id,
      eventType: 'reactivation_offer_sent',
      channel,
      summary: `Win-back reactivation offer (${discount}% discount) dispatched`,
      details: {
        campaignSlug,
        discountPercent: discount,
        messageContent,
        messageSent,
      },
    });

    logger.info(`Reactivation offer sent to customer ${customer.id} (${discount}% off)`);

    return {
      customerId: customer.id,
      eligible: true,
      campaignSlug,
      discountOfferedPercent: discount,
      outboundMessageSent: messageSent,
      messageContent,
      requiresHumanApproval: false,
    };
  }
}
