/**
 * Kriya AI — Customer Lifecycle Workforce Controller Service
 * Coordinates the 4 specialized customer lifecycle agents and governs state transitions (§23-§28 of CLAUDE.md).
 */

import { LeadQualificationSpecialist } from '../specialists/leadQualificationSpecialist.js';
import { CalendarBookingSpecialist } from '../specialists/calendarBookingSpecialist.js';
import { CustomerSupportSpecialist } from '../specialists/customerSupportSpecialist.js';
import { ReactivationRetentionSpecialist } from '../specialists/reactivationRetentionSpecialist.js';
import {
  QualifyLeadRequest,
  LeadQualificationResult,
  BookSlotRequest,
  BookingProposalResult,
  HandleSupportRequest,
  SupportResolutionResult,
  ReactivationRequest,
  ReactivationOfferResult,
} from '../types/workforceTypes.js';
import { CustomerRepository } from '../../customer360/repositories/customerRepository.js';
import { TimelineRepository } from '../../customer360/repositories/timelineRepository.js';
import { CustomerLifecycleStage } from '../types/workforceTypes.js';
import { NotFoundError, BusinessLogicError } from '../../core/errors/errors.js';
import { logger } from '../../core/logger/logger.js';

export class LifecycleWorkforceService {
  public readonly leadSpecialist: LeadQualificationSpecialist;
  public readonly bookingSpecialist: CalendarBookingSpecialist;
  public readonly supportSpecialist: CustomerSupportSpecialist;
  public readonly retentionSpecialist: ReactivationRetentionSpecialist;
  private customerRepo: CustomerRepository;
  private timelineRepo: TimelineRepository;

  constructor(dependencies?: {
    leadSpecialist?: LeadQualificationSpecialist;
    bookingSpecialist?: CalendarBookingSpecialist;
    supportSpecialist?: CustomerSupportSpecialist;
    retentionSpecialist?: ReactivationRetentionSpecialist;
    customerRepo?: CustomerRepository;
    timelineRepo?: TimelineRepository;
  }) {
    this.leadSpecialist = dependencies?.leadSpecialist || new LeadQualificationSpecialist();
    this.bookingSpecialist = dependencies?.bookingSpecialist || new CalendarBookingSpecialist();
    this.supportSpecialist = dependencies?.supportSpecialist || new CustomerSupportSpecialist();
    this.retentionSpecialist = dependencies?.retentionSpecialist || new ReactivationRetentionSpecialist();
    this.customerRepo = dependencies?.customerRepo || new CustomerRepository();
    this.timelineRepo = dependencies?.timelineRepo || new TimelineRepository();
  }

  public async qualifyLead(req: QualifyLeadRequest): Promise<LeadQualificationResult> {
    return this.leadSpecialist.qualify(req);
  }

  public async bookSlot(req: BookSlotRequest): Promise<BookingProposalResult> {
    return this.bookingSpecialist.bookOrPropose(req);
  }

  public async handleSupportTicket(req: HandleSupportRequest): Promise<SupportResolutionResult> {
    return this.supportSpecialist.handleTicket(req);
  }

  public async triggerReactivation(req: ReactivationRequest): Promise<ReactivationOfferResult> {
    return this.retentionSpecialist.evaluateAndOffer(req);
  }

  /**
   * Manually or programmatically transitions a customer's lifecycle stage (§28).
   */
  public async transitionStage(
    customerId: string,
    newStage: CustomerLifecycleStage,
    reason?: string
  ): Promise<{ customerId: string; previousStage: string; currentStage: string }> {
    const customer = await this.customerRepo.findById(customerId);
    if (!customer) {
      throw new NotFoundError(`Customer '${customerId}' not found.`);
    }

    const previousStage = customer.lifecycle_stage;
    if (previousStage === newStage) {
      return { customerId, previousStage, currentStage: newStage };
    }

    await this.customerRepo.updateCustomer(customerId, {
      lifecycle_stage: newStage,
    });

    await this.timelineRepo.createEvent({
      customerId,
      eventType: 'lifecycle_transition',
      channel: 'system',
      summary: `Customer transitioned from '${previousStage}' to '${newStage}'`,
      details: {
        previousStage,
        currentStage: newStage,
        reason: reason || 'Automated lifecycle transition',
      },
    });

    logger.info(`Customer ${customerId} transitioned: ${previousStage} -> ${newStage}`);

    return {
      customerId,
      previousStage,
      currentStage: newStage,
    };
  }
}
