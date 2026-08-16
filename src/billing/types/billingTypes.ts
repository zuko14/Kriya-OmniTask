/**
 * Xylarc AI — Billing and Usage Types & Contracts
 * Production definitions for event-driven usage metering, channel plans, overage calculations, and invoicing.
 */

import { z } from 'zod';

export type PlanTier = 'starter' | 'growth' | 'enterprise' | 'custom';
export type ChannelPlan = 'digital_only' | 'voice_only' | 'combined';
export type BillingInterval = 'month' | 'year';
export type SubscriptionStatus = 'active' | 'past_due' | 'canceled' | 'trialing';
export type UsageMetricType =
  | 'tokens'
  | 'voice_minutes'
  | 'workflow_executions'
  | 'agent_seat_hours'
  | 'api_calls'
  | 'vector_storage_mb';

export type InvoiceStatus = 'draft' | 'open' | 'paid' | 'void' | 'uncollectible';
export type InvoiceItemType =
  | 'base_subscription'
  | 'token_overage'
  | 'voice_overage'
  | 'workflow_overage'
  | 'seat_overage'
  | 'discount'
  | 'tax';

export const BillingPlanSchema = z.object({
  id: z.string(),
  name: z.string(),
  planTier: z.enum(['starter', 'growth', 'enterprise', 'custom']),
  channelPlan: z.enum(['digital_only', 'voice_only', 'combined']),
  basePriceCents: z.number().int().nonnegative(),
  currency: z.string().default('USD'),
  billingInterval: z.enum(['month', 'year']).default('month'),
  includedTokens: z.number().int().nonnegative().default(0),
  includedVoiceMinutes: z.number().int().nonnegative().default(0),
  includedWorkflowExecutions: z.number().int().nonnegative().default(0),
  includedAgents: z.number().int().positive().default(1),
  tokenOverageRateCentsPerK: z.number().nonnegative().default(0),
  voiceMinuteOverageRateCents: z.number().nonnegative().default(0),
  workflowOverageRateCents: z.number().nonnegative().default(0),
  isActive: z.boolean().default(true),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type BillingPlan = z.infer<typeof BillingPlanSchema>;

export const TenantSubscriptionSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  planId: z.string(),
  status: z.enum(['active', 'past_due', 'canceled', 'trialing']),
  currentPeriodStart: z.string(),
  currentPeriodEnd: z.string(),
  cancelAtPeriodEnd: z.boolean().default(false),
  stripeCustomerId: z.string().optional(),
  stripeSubscriptionId: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type TenantSubscription = z.infer<typeof TenantSubscriptionSchema>;

export const UsageMeterRecordSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  metricType: z.enum([
    'tokens',
    'voice_minutes',
    'workflow_executions',
    'agent_seat_hours',
    'api_calls',
    'vector_storage_mb',
  ]),
  quantity: z.number().nonnegative(),
  idempotencyKey: z.string().optional(),
  recordedAt: z.string(),
  metadata: z.record(z.string(), z.any()).optional(),
});
export type UsageMeterRecord = z.infer<typeof UsageMeterRecordSchema>;

export interface UsageSummary {
  tenantId: string;
  periodStart: string;
  periodEnd: string;
  totalTokens: number;
  totalVoiceMinutes: number;
  totalWorkflowExecutions: number;
  totalAgentSeatHours: number;
  totalApiCalls: number;
  totalVectorStorageMb: number;
}

export interface OverageItem {
  metricType: UsageMetricType;
  usedQuantity: number;
  includedQuantity: number;
  overageQuantity: number;
  rateCentsPerUnit: number;
  overageAmountCents: number;
}

export interface OverageEvaluationResult {
  hasOverage: boolean;
  totalOverageAmountCents: number;
  items: OverageItem[];
}

export const InvoiceLineItemSchema = z.object({
  id: z.string(),
  invoiceId: z.string(),
  itemType: z.enum([
    'base_subscription',
    'token_overage',
    'voice_overage',
    'workflow_overage',
    'seat_overage',
    'discount',
    'tax',
  ]),
  description: z.string(),
  quantity: z.number().nonnegative().default(1.0),
  unitPriceCents: z.number().int(),
  amountCents: z.number().int(),
});
export type InvoiceLineItem = z.infer<typeof InvoiceLineItemSchema>;

export const InvoiceSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  subscriptionId: z.string().optional(),
  billingPeriodStart: z.string(),
  billingPeriodEnd: z.string(),
  subtotalAmountCents: z.number().int().nonnegative(),
  taxRatePct: z.number().nonnegative().default(0),
  taxAmountCents: z.number().int().nonnegative().default(0),
  discountAmountCents: z.number().int().nonnegative().default(0),
  totalAmountCents: z.number().int().nonnegative(),
  currency: z.string().default('USD'),
  status: z.enum(['draft', 'open', 'paid', 'void', 'uncollectible']),
  stripePaymentIntentId: z.string().optional(),
  paidAt: z.string().optional(),
  lineItems: z.array(InvoiceLineItemSchema).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Invoice = z.infer<typeof InvoiceSchema>;

export interface DiscountPolicy {
  discountCode?: string;
  percentageDiscount?: number; // e.g., 10 for 10%
  fixedDiscountCents?: number; // e.g., 5000 for $50.00
  reason?: string;
}

export interface TaxJurisdiction {
  countryCode: string;
  regionCode?: string;
  taxRatePct: number; // e.g., 18.0 for 18% VAT/GST
  name: string;
}
