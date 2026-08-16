/**
 * Xylarc AI — Customer Lifecycle Workforce Type Definitions & Schemas
 * Typed contracts for Lead Qualification, Calendar Booking, Customer Support, and Reactivation Specialists (§23-§28 of CLAUDE.md).
 */

import { z } from 'zod';

export const CustomerLifecycleStageEnum = z.enum([
  'lead',
  'qualified',
  'opportunity',
  'customer',
  'active',
  'at_risk',
  'churned',
  'win_back',
  'churn_risk',
  'reactivated',
  'prospect',
]);

export type CustomerLifecycleStage = z.infer<typeof CustomerLifecycleStageEnum>;

// ============================================================================
// 1. Lead Qualification Specialist (§23)
// ============================================================================

export const BANTCriteriaSchema = z.object({
  budgetUsd: z.number().nonnegative().optional(),
  hasAuthority: z.boolean().optional(),
  identifiedNeed: z.string().optional(),
  timeframeMonths: z.number().int().positive().optional(),
});

export type BANTCriteria = z.infer<typeof BANTCriteriaSchema>;

export const QualifyLeadRequestSchema = z.object({
  customerId: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  inboundMessage: z.string().min(1),
  bant: BANTCriteriaSchema.default({}),
  companySize: z.string().optional(),
  industry: z.string().optional(),
});

export type QualifyLeadRequest = z.input<typeof QualifyLeadRequestSchema>;

export interface LeadQualificationResult {
  customerId: string;
  leadScore: number; // 0-100
  isQualified: boolean;
  qualificationTier: 'unqualified' | 'nurture' | 'marketing_qualified' | 'sales_qualified';
  summary: string;
  recommendedNextStep: string;
  lifecycleStageUpdatedTo: string;
}

// ============================================================================
// 2. Calendar Booking Specialist (§24)
// ============================================================================

export const BookSlotRequestSchema = z.object({
  customerId: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  serviceName: z.string().min(1).default('executive_consultation'),
  preferredDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  preferredTimeSlot: z.string().optional(),
  timezone: z.string().default('UTC'),
});

export type BookSlotRequest = z.input<typeof BookSlotRequestSchema>;

export interface BookingProposalResult {
  customerId: string;
  bookingStatus: 'confirmed' | 'slots_proposed' | 'failed';
  confirmedSlot?: {
    startTime: string;
    endTime: string;
    bookingReference: string;
  };
  availableAlternativeSlots?: Array<{
    startTime: string;
    durationMinutes: number;
  }>;
  confirmationMessage: string;
}

// ============================================================================
// 3. Customer Support Specialist (§25)
// ============================================================================

export const HandleSupportRequestSchema = z.object({
  customerId: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  ticketCategory: z.enum(['billing', 'technical', 'account', 'general']).default('general'),
  issueDescription: z.string().min(1),
  urgency: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
});

export type HandleSupportRequest = z.input<typeof HandleSupportRequestSchema>;

export interface SupportResolutionResult {
  customerId: string;
  ticketId: string;
  resolutionStatus: 'resolved' | 'escalated_to_human' | 'in_progress';
  sentimentScore: number; // 0.0 (negative) to 1.0 (positive)
  churnRiskScore: number; // 0.0 (low) to 1.0 (high)
  resolutionMessage: string;
  escalationReason?: string;
}

// ============================================================================
// 4. Reactivation & Retention Specialist (§26, §27)
// ============================================================================

export const ReactivationRequestSchema = z.object({
  customerId: z.string().min(1),
  inactivityDaysThreshold: z.number().int().positive().default(30),
  offeredDiscountPercent: z.number().min(0).max(50).default(15),
  channel: z.enum(['whatsapp', 'email', 'sms']).default('whatsapp'),
});

export type ReactivationRequest = z.input<typeof ReactivationRequestSchema>;

export interface ReactivationOfferResult {
  customerId: string;
  eligible: boolean;
  ineligibilityReason?: string;
  campaignSlug: string;
  discountOfferedPercent: number;
  outboundMessageSent: boolean;
  messageContent: string;
  requiresHumanApproval: boolean;
}
