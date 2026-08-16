/**
 * Xylarc AI — Lead Qualification Specialist
 * Analyzes inbound commercial inquiries, calculates deterministic BANT lead scores, and promotes lifecycle stages (§23 of CLAUDE.md).
 */

import {
  QualifyLeadRequest,
  LeadQualificationResult,
  CustomerLifecycleStage,
} from '../types/workforceTypes.js';
import { CustomerRepository } from '../../customer360/repositories/customerRepository.js';
import { TimelineRepository } from '../../customer360/repositories/timelineRepository.js';
import { EntityResolutionService } from '../../customer360/services/entityResolutionService.js';
import { logger } from '../../core/logger/logger.js';

export class LeadQualificationSpecialist {
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

  public async qualify(req: QualifyLeadRequest): Promise<LeadQualificationResult> {
    // 1. Resolve or create customer entity
    let customerId = req.customerId;
    if (!customerId && (req.phone || req.email)) {
      const match = await this.entityResolution.resolve({
        phone: req.phone,
        email: req.email,
        source: 'lead_qualification',
      });

      if (match && match.customer) {
        customerId = match.customer.id;
      } else {
        const created = await this.customerRepo.createCustomer({
          phone: req.phone,
          email: req.email,
          lifecycle_stage: 'lead',
        });
        customerId = created.id;
      }
    }

    if (!customerId) {
      const anonymous = await this.customerRepo.createCustomer({
        lifecycle_stage: 'lead',
      });
      customerId = anonymous.id;
    }

    // 2. Deterministic BANT Lead Scoring Algorithm (§23)
    let score = 0;
    const bant = req.bant || {};

    // Budget points (max 30)
    if (bant.budgetUsd !== undefined) {
      if (bant.budgetUsd >= 10000) score += 30;
      else if (bant.budgetUsd >= 2500) score += 20;
      else if (bant.budgetUsd > 0) score += 10;
    } else {
      score += 10; // Default baseline assumption
    }

    // Authority points (max 25)
    if (bant.hasAuthority === true) {
      score += 25;
    } else if (bant.hasAuthority === undefined) {
      score += 10;
    }

    // Need points (max 25)
    const needText = (bant.identifiedNeed || req.inboundMessage).toLowerCase();
    if (
      needText.includes('enterprise') ||
      needText.includes('pricing') ||
      needText.includes('demo') ||
      needText.includes('urgent') ||
      needText.includes('buy') ||
      needText.includes('contract')
    ) {
      score += 25;
    } else if (needText.length > 20) {
      score += 15;
    } else {
      score += 5;
    }

    // Timeline points (max 20)
    if (bant.timeframeMonths !== undefined) {
      if (bant.timeframeMonths <= 1) score += 20;
      else if (bant.timeframeMonths <= 3) score += 10;
      else score += 5;
    } else {
      score += 10;
    }

    score = Math.min(100, Math.max(0, score));

    // 3. Determine Tier & New Lifecycle Stage
    let tier: LeadQualificationResult['qualificationTier'] = 'unqualified';
    let newStage: CustomerLifecycleStage = 'lead';
    let nextStep = 'Send introductory knowledge base links';

    if (score >= 75) {
      tier = 'sales_qualified';
      newStage = 'qualified';
      nextStep = 'Coordinate executive demo via Calendar Booking Specialist';
    } else if (score >= 50) {
      tier = 'marketing_qualified';
      newStage = 'prospect';
      nextStep = 'Send case studies and product demo video';
    } else if (score >= 25) {
      tier = 'nurture';
      newStage = 'lead';
      nextStep = 'Enroll in educational email nurture sequence';
    }

    // 4. Update Customer 360 Record
    await this.customerRepo.updateCustomer(customerId, {
      lifecycle_stage: newStage,
    });

    // 5. Append Timeline Event
    await this.timelineRepo.createEvent({
      customerId,
      eventType: 'lead_qualified',
      channel: 'system',
      summary: `Lead qualified as ${tier} (Score: ${score}/100)`,
      details: {
        score,
        tier,
        bant,
        inboundMessage: req.inboundMessage,
        recommendedNextStep: nextStep,
      },
    });

    logger.info(`Customer ${customerId} qualified as ${tier} (Score: ${score}/100) -> Stage: ${newStage}`);

    return {
      customerId,
      leadScore: score,
      isQualified: score >= 50,
      qualificationTier: tier,
      summary: `Lead received a score of ${score}/100 based on BANT analysis.`,
      recommendedNextStep: nextStep,
      lifecycleStageUpdatedTo: newStage,
    };
  }
}
