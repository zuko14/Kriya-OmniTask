/**
 * Xylarc AI — Customer Support Specialist
 * Diagnoses customer issues, calculates sentiment & churn risk, provides resolution answers, or escalates to human (§25 of CLAUDE.md).
 */

import {
  HandleSupportRequest,
  SupportResolutionResult,
} from '../types/workforceTypes.js';
import { CustomerRepository } from '../../customer360/repositories/customerRepository.js';
import { TimelineRepository } from '../../customer360/repositories/timelineRepository.js';
import { EntityResolutionService } from '../../customer360/services/entityResolutionService.js';
import { CryptoUtils } from '../../core/utils/crypto.js';
import { logger } from '../../core/logger/logger.js';

export class CustomerSupportSpecialist {
  private customerRepo: CustomerRepository;
  private timelineRepo: TimelineRepository;
  private entityResolution: EntityResolutionService;

  constructor(
    customerRepo?: CustomerRepository,
    timelineRepo?: TimelineRepository,
    entityResolution?: EntityResolutionService
  ) {
    this.customerRepo = customerRepo || new CustomerRepository();
    this.timelineRepo = timelineRepo || new TimelineRepository();
    this.entityResolution = entityResolution || new EntityResolutionService();
  }

  public async handleTicket(req: HandleSupportRequest): Promise<SupportResolutionResult> {
    // 1. Resolve Customer
    let customerId = req.customerId;
    if (!customerId && (req.phone || req.email)) {
      const match = await this.entityResolution.resolve({
        phone: req.phone,
        email: req.email,
        source: 'customer_support',
      });
      if (match && match.customer) {
        customerId = match.customer.id;
      } else {
        const created = await this.customerRepo.createCustomer({
          phone: req.phone,
          email: req.email,
          lifecycle_stage: 'customer',
        });
        customerId = created.id;
      }
    }

    if (!customerId) {
      const created = await this.customerRepo.createCustomer({
        lifecycle_stage: 'customer',
      });
      customerId = created.id;
    }

    const ticketId = `TCK-${CryptoUtils.generateSecureToken(4).toUpperCase()}`;
    const textLower = req.issueDescription.toLowerCase();

    // 2. Sentiment & Churn Risk Analysis
    let sentimentScore = 0.75;
    let churnRisk = 0.15;
    let isEscalationTriggered = req.urgency === 'critical';
    let escalationReason: string | undefined;

    const negativeKeywords = ['broken', 'fail', 'error', 'wrong', 'refund', 'cancel', 'terrible', 'scam', 'fraud', 'lawyer'];
    const matchedNegatives = negativeKeywords.filter((kw) => textLower.includes(kw));

    if (matchedNegatives.length > 0) {
      sentimentScore = Math.max(0.1, 0.75 - matchedNegatives.length * 0.2);
      churnRisk = Math.min(0.95, 0.15 + matchedNegatives.length * 0.25);

      if (textLower.includes('cancel') || textLower.includes('lawyer') || textLower.includes('fraud')) {
        isEscalationTriggered = true;
        escalationReason = `High-severity customer escalation keywords detected: [${matchedNegatives.join(', ')}]`;
      }
    }

    // 3. Resolve or Escalate
    let resolutionStatus: SupportResolutionResult['resolutionStatus'] = 'resolved';
    let resolutionMessage = '';

    if (isEscalationTriggered || sentimentScore < 0.35 || churnRisk > 0.70) {
      resolutionStatus = 'escalated_to_human';
      resolutionMessage = `Your support inquiry (${ticketId}) has been escalated to our senior Tier-2 customer success team. A specialist will contact you shortly.`;

      // Update customer churn risk score and stage
      await this.customerRepo.updateCustomer(customerId, {
        sentiment_score: sentimentScore,
        churn_risk_score: churnRisk,
        lifecycle_stage: 'churn_risk',
      });

      await this.timelineRepo.createEvent({
        customerId,
        eventType: 'support_ticket_escalated',
        channel: 'support',
        summary: `Support ticket ${ticketId} escalated to human. Sentiment: ${sentimentScore}, Churn Risk: ${churnRisk}`,
        details: {
          ticketId,
          category: req.ticketCategory,
          urgency: req.urgency,
          issue: req.issueDescription,
          reason: escalationReason || 'Sentiment/churn threshold exceeded',
        },
      });

      logger.warn(`Support ticket ${ticketId} for customer ${customerId} escalated to human.`);
    } else {
      resolutionStatus = 'resolved';
      resolutionMessage = `We have processed your ${req.ticketCategory} request. Standard configuration instructions and FAQ guides have been dispatched.`;

      // Update customer sentiment score
      await this.customerRepo.updateCustomer(customerId, {
        sentiment_score: sentimentScore,
        churn_risk_score: churnRisk,
      });

      await this.timelineRepo.createEvent({
        customerId,
        eventType: 'support_ticket_resolved',
        channel: 'support',
        summary: `Support ticket ${ticketId} resolved autonomously. Category: ${req.ticketCategory}`,
        details: {
          ticketId,
          category: req.ticketCategory,
          issue: req.issueDescription,
        },
      });
    }

    return {
      customerId,
      ticketId,
      resolutionStatus,
      sentimentScore,
      churnRiskScore: churnRisk,
      resolutionMessage,
      escalationReason,
    };
  }
}
