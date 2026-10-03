/**
 * Kriya AI — Tenant Quota & Channel Plan Enforcement Service
 * Enforces tier-based resource limits and channel subscriptions (§8, §30 of CLAUDE.md).
 */

import { TenantRepository, TenantRecord } from '../../storage/repositories/tenantRepository.js';
import { PolicyViolationError, NotFoundError } from '../../core/errors/errors.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';

export interface PlanLimits {
  maxAgents: number;
  maxConcurrentTasks: number;
  maxMonthlyConversations: number;
  maxStorageMb: number;
  allowedChannels: Array<'web' | 'whatsapp' | 'voice' | 'email'>;
}

export const PLAN_TIER_LIMITS: Record<string, PlanLimits> = {
  standard: {
    maxAgents: 5,
    maxConcurrentTasks: 10,
    maxMonthlyConversations: 2_000,
    maxStorageMb: 1_024,
    allowedChannels: ['web', 'whatsapp', 'email'],
  },
  pro: {
    maxAgents: 20,
    maxConcurrentTasks: 50,
    maxMonthlyConversations: 25_000,
    maxStorageMb: 10_240,
    allowedChannels: ['web', 'whatsapp', 'voice', 'email'],
  },
  enterprise: {
    maxAgents: 100,
    maxConcurrentTasks: 500,
    maxMonthlyConversations: 500_000,
    maxStorageMb: 102_400,
    allowedChannels: ['web', 'whatsapp', 'voice', 'email'],
  },
};

export class QuotaService {
  private tenantRepo: TenantRepository;

  constructor(tenantRepo?: TenantRepository) {
    this.tenantRepo = tenantRepo || new TenantRepository();
  }

  /**
   * Resolves effective limits for a tenant based on plan tier and channel plan.
   */
  public async getEffectiveLimits(tenantId: string): Promise<PlanLimits> {
    const tenant = await this.tenantRepo.findById(tenantId);
    if (!tenant) {
      throw new NotFoundError(`Tenant with ID ${tenantId} not found`);
    }

    const baseLimits = PLAN_TIER_LIMITS[tenant.plan_tier] || PLAN_TIER_LIMITS.standard;
    const allowedChannels: Array<'web' | 'whatsapp' | 'voice' | 'email'> = ['web'];

    if (tenant.channel_plan === 'whatsapp_only') {
      allowedChannels.push('whatsapp', 'email');
    } else if (tenant.channel_plan === 'voice_only') {
      allowedChannels.push('voice', 'email');
    } else {
      // combined
      allowedChannels.push('whatsapp', 'voice', 'email');
    }

    // Tenant-specific custom overrides from configuration
    const customConfig = await this.tenantRepo.getConfiguration<{ customLimits?: Partial<PlanLimits> }>(tenantId);

    return {
      ...baseLimits,
      ...customConfig.customLimits,
      allowedChannels: customConfig.customLimits?.allowedChannels || allowedChannels,
    };
  }

  /**
   * Validates if a tenant is permitted to provision/execute on a given channel.
   */
  public async assertChannelAccess(tenantId: string, channel: 'web' | 'whatsapp' | 'voice' | 'email'): Promise<void> {
    const limits = await this.getEffectiveLimits(tenantId);
    if (!limits.allowedChannels.includes(channel)) {
      throw new PolicyViolationError(
        `Channel '${channel}' is not permitted under the tenant's current channel plan or subscription tier. Allowed channels: [${limits.allowedChannels.join(', ')}]`,
        { tenantId, channel, allowedChannels: limits.allowedChannels }
      );
    }
  }

  /**
   * Asserts channel permission using active tenant context.
   */
  public async assertChannelAllowed(channel: 'web' | 'whatsapp' | 'voice' | 'email'): Promise<void> {
    const tenantId = TenantContextManager.getTenantId();
    await this.assertChannelAccess(tenantId, channel);
  }

  /**
   * Asserts that adding new agents does not exceed plan limits.
   */
  public async assertAgentQuota(tenantId: string, currentAgentCount: number, addingCount = 1): Promise<void> {
    const limits = await this.getEffectiveLimits(tenantId);
    if (currentAgentCount + addingCount > limits.maxAgents) {
      throw new PolicyViolationError(
        `Agent quota exceeded: Plan allows max ${limits.maxAgents} agents, but requested count is ${currentAgentCount + addingCount}.`,
        { tenantId, maxAgents: limits.maxAgents, currentAgentCount, requested: addingCount }
      );
    }
  }
}
