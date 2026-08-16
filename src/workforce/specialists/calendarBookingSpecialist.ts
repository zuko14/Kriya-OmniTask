/**
 * Xylarc AI — Calendar Booking Specialist
 * Negotiates open slots, checks calendar availability, books appointments, and logs timeline confirmations (§24 of CLAUDE.md).
 */

import {
  BookSlotRequest,
  BookingProposalResult,
} from '../types/workforceTypes.js';
import { CustomerRepository } from '../../customer360/repositories/customerRepository.js';
import { TimelineRepository } from '../../customer360/repositories/timelineRepository.js';
import { EntityResolutionService } from '../../customer360/services/entityResolutionService.js';
import { ToolGateway } from '../../tools/gateway/toolGateway.js';
import { logger } from '../../core/logger/logger.js';

export class CalendarBookingSpecialist {
  private customerRepo: CustomerRepository;
  private timelineRepo: TimelineRepository;
  private entityResolution: EntityResolutionService;
  private toolGateway: ToolGateway;

  constructor(
    customerRepo?: CustomerRepository,
    timelineRepo?: TimelineRepository,
    entityResolution?: EntityResolutionService,
    toolGateway?: ToolGateway
  ) {
    this.customerRepo = customerRepo || new CustomerRepository();
    this.timelineRepo = timelineRepo || new TimelineRepository();
    this.entityResolution = entityResolution || new EntityResolutionService();
    this.toolGateway = toolGateway || new ToolGateway();
  }

  public async bookOrPropose(req: BookSlotRequest): Promise<BookingProposalResult> {
    // 1. Resolve Customer
    let customerId = req.customerId;
    if (!customerId && (req.phone || req.email)) {
      const match = await this.entityResolution.resolve({
        phone: req.phone,
        email: req.email,
        source: 'calendar_booking',
      });
      if (match && match.customer) {
        customerId = match.customer.id;
      } else {
        const created = await this.customerRepo.createCustomer({
          phone: req.phone,
          email: req.email,
          lifecycle_stage: 'prospect',
        });
        customerId = created.id;
      }
    }

    if (!customerId) {
      const created = await this.customerRepo.createCustomer({
        lifecycle_stage: 'prospect',
      });
      customerId = created.id;
    }

    // 2. Query Availability via Tool Gateway
    const availRes = await this.toolGateway.executeTool({
      toolSlug: 'calendar_check_availability',
      input: { date: req.preferredDate },
      bypassApproval: true,
    });

    const availableSlots: Array<{ startTime: string; durationMinutes: number; available: boolean }> =
      (availRes.result?.availableSlots as any) || [];

    const serviceName = req.serviceName || 'executive_consultation';

    // 3. Check if specific slot requested or book first available slot
    if (req.preferredTimeSlot) {
      const matchedSlot = availableSlots.find((s) => s.startTime.includes(req.preferredTimeSlot!));

      if (matchedSlot) {
        // Book the specific slot
        return this.confirmBooking(customerId, serviceName, matchedSlot.startTime, 30);
      }
    }

    // If preferred time wasn't specified, propose open slots
    if (availableSlots.length > 0) {
      // Auto-book if preferredTimeSlot was explicitly "first_available"
      if (req.preferredTimeSlot === 'first_available') {
        return this.confirmBooking(customerId, serviceName, availableSlots[0].startTime, 30);
      }

      await this.timelineRepo.createEvent({
        customerId,
        eventType: 'slots_proposed',
        channel: 'calendar',
        summary: `Proposed ${availableSlots.length} available appointment slots for ${req.preferredDate}`,
        details: { preferredDate: req.preferredDate, slots: availableSlots },
      });

      return {
        customerId,
        bookingStatus: 'slots_proposed',
        availableAlternativeSlots: availableSlots,
        confirmationMessage: `We have ${availableSlots.length} available slots on ${req.preferredDate}. Please select your preferred time.`,
      };
    }

    return {
      customerId,
      bookingStatus: 'failed',
      confirmationMessage: `No available slots on ${req.preferredDate}. Please select another date.`,
    };
  }

  private async confirmBooking(
    customerId: string,
    serviceName: string,
    startTime: string,
    durationMinutes: number
  ): Promise<BookingProposalResult> {
    const bookRes = await this.toolGateway.executeTool({
      toolSlug: 'calendar_book_slot',
      input: {
        customerId,
        slotTime: startTime,
        title: serviceName,
      },
      bypassApproval: true,
    });

    const bookingRef = (bookRes.result?.bookingId as string) || (bookRes.result?.bookingReference as string) || `REF-${Date.now()}`;
    const endTime = new Date(Date.parse(startTime) + durationMinutes * 60000).toISOString();

    // Update Customer Stage to opportunity
    await this.customerRepo.updateCustomer(customerId, {
      lifecycle_stage: 'opportunity',
    });

    // Record Timeline Event
    await this.timelineRepo.createEvent({
      customerId,
      eventType: 'appointment_scheduled',
      channel: 'calendar',
      summary: `Appointment confirmed for ${serviceName} on ${startTime} (Ref: ${bookingRef})`,
      details: {
        bookingReference: bookingRef,
        startTime,
        endTime,
        serviceName,
      },
    });

    logger.info(`Appointment booked for customer ${customerId}: ${startTime} (Ref: ${bookingRef})`);

    return {
      customerId,
      bookingStatus: 'confirmed',
      confirmedSlot: {
        startTime,
        endTime,
        bookingReference: bookingRef,
      },
      confirmationMessage: `Your appointment for ${serviceName} is confirmed for ${startTime}. Reference: ${bookingRef}`,
    };
  }
}
