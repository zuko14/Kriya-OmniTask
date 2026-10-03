/**
 * Kriya AI — Channel Pricing & Plan Catalog
 * Standard plan tiers and multi-channel workforce pricing structures.
 */

import { BillingPlan, PlanTier, ChannelPlan } from '../types/billingTypes.js';

export class ChannelPricingCatalog {
  private static readonly DEFAULT_PLANS: Record<string, Omit<BillingPlan, 'id' | 'createdAt' | 'updatedAt'>> = {
    'starter_digital': {
      name: 'Starter Workforce (Digital Only)',
      planTier: 'starter',
      channelPlan: 'digital_only',
      basePriceCents: 19900, // $199.00 / month
      currency: 'USD',
      billingInterval: 'month',
      includedTokens: 5_000_000, // 5M tokens
      includedVoiceMinutes: 0,
      includedWorkflowExecutions: 500,
      includedAgents: 2,
      tokenOverageRateCentsPerK: 0.5, // $0.005 per 1k ($5 / 1M)
      voiceMinuteOverageRateCents: 15.0, // $0.15 / min
      workflowOverageRateCents: 10.0, // $0.10 / run
      isActive: true,
    },
    'growth_combined': {
      name: 'Growth Workforce (Omnichannel Digital + Voice)',
      planTier: 'growth',
      channelPlan: 'combined',
      basePriceCents: 79900, // $799.00 / month
      currency: 'USD',
      billingInterval: 'month',
      includedTokens: 25_000_000, // 25M tokens
      includedVoiceMinutes: 500, // 500 voice minutes
      includedWorkflowExecutions: 2_500,
      includedAgents: 10,
      tokenOverageRateCentsPerK: 0.3, // $0.003 per 1k ($3 / 1M)
      voiceMinuteOverageRateCents: 10.0, // $0.10 / min
      workflowOverageRateCents: 5.0, // $0.05 / run
      isActive: true,
    },
    'enterprise_combined': {
      name: 'Enterprise Autonomous Workforce (Full Suite)',
      planTier: 'enterprise',
      channelPlan: 'combined',
      basePriceCents: 249900, // $2,499.00 / month
      currency: 'USD',
      billingInterval: 'month',
      includedTokens: 100_000_000, // 100M tokens
      includedVoiceMinutes: 2_500, // 2,500 voice minutes
      includedWorkflowExecutions: 15_000,
      includedAgents: 50,
      tokenOverageRateCentsPerK: 0.2, // $0.002 per 1k ($2 / 1M)
      voiceMinuteOverageRateCents: 8.0, // $0.08 / min
      workflowOverageRateCents: 2.0, // $0.02 / run
      isActive: true,
    },
  };

  /**
   * Retrieves the catalog default template for a given tier and channel.
   */
  public static getDefaultPlanTemplate(
    tier: PlanTier,
    channel: ChannelPlan = 'combined'
  ): Omit<BillingPlan, 'id' | 'createdAt' | 'updatedAt'> {
    const key = `${tier}_${channel}`;
    if (this.DEFAULT_PLANS[key]) {
      return this.DEFAULT_PLANS[key];
    }
    // Fallback to closest match
    if (tier === 'starter') return this.DEFAULT_PLANS['starter_digital'];
    if (tier === 'growth') return this.DEFAULT_PLANS['growth_combined'];
    return this.DEFAULT_PLANS['enterprise_combined'];
  }

  /**
   * Returns all pre-configured catalog plans.
   */
  public static getAllDefaultPlans(): Array<Omit<BillingPlan, 'createdAt' | 'updatedAt'>> {
    return Object.entries(this.DEFAULT_PLANS).map(([key, plan]) => ({
      id: `plan_${key}`,
      ...plan,
    }));
  }
}
