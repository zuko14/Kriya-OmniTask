/**
 * Kriya AI — Multi-Tenant Sliding-Window Rate Limiter & Abuse Governor (WP-8.1, Blueprint §10, §14, ADR-028)
 *
 * Implements sliding-window request throttling with per-tenant isolation, tiered quotas,
 * RFC rate-limit headers (X-RateLimit-*), 429 retry-after responses, and automatic
 * Attention Center escalation upon sustained abuse.
 */

import { logger } from '../../core/logger/logger.js';
import { AttentionService } from '../../attention/service/attentionService.js';

export type RateLimitCategory = 'auth' | 'agent_execution' | 'tools' | 'standard_api' | 'webhooks';

export interface RateLimitTierConfig {
  limit: number;
  windowMs: number;
}

export interface RateLimitCheckResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetSeconds: number;
  retryAfterSeconds: number;
  currentCount: number;
  tier: RateLimitCategory;
  isAbuse: boolean;
  strikeCount: number;
}

export interface TenantRateLimitStatus {
  tenantId: string;
  categories: Record<
    RateLimitCategory,
    {
      limit: number;
      currentCount: number;
      remaining: number;
      resetSeconds: number;
      strikes: number;
      isThrottled: boolean;
    }
  >;
}

export class TenantRateLimiter {
  private static instance: TenantRateLimiter | null = null;

  // Default Tier Configuration (requests per 60 seconds)
  public static readonly DEFAULT_TIERS: Record<RateLimitCategory, RateLimitTierConfig> = {
    auth: { limit: 10, windowMs: 60_000 },
    agent_execution: { limit: 60, windowMs: 60_000 },
    tools: { limit: 120, windowMs: 60_000 },
    standard_api: { limit: 300, windowMs: 60_000 },
    webhooks: { limit: 600, windowMs: 60_000 },
  };

  // In-memory sliding window timestamps: Map<Key, number[]>
  private requestBuckets: Map<string, number[]> = new Map();

  // Strike count for sustained abuse tracking: Map<Key, { strikes: number; lastViolation: number }>
  private abuseTracker: Map<string, { strikes: number; lastViolation: number }> = new Map();

  // Custom tenant overrides: Map<tenantId, Partial<Record<RateLimitCategory, number>>>
  private tenantOverrides: Map<string, Partial<Record<RateLimitCategory, number>>> = new Map();

  private attentionService?: AttentionService;

  constructor(attentionService?: AttentionService) {
    this.attentionService = attentionService;
  }

  public static getInstance(attentionService?: AttentionService): TenantRateLimiter {
    if (!TenantRateLimiter.instance) {
      TenantRateLimiter.instance = new TenantRateLimiter(attentionService);
    }
    return TenantRateLimiter.instance;
  }

  /**
   * Sets custom quota overrides for a specific tenant.
   */
  public setTenantOverride(tenantId: string, category: RateLimitCategory, customLimit: number): void {
    const existing = this.tenantOverrides.get(tenantId) || {};
    existing[category] = customLimit;
    this.tenantOverrides.set(tenantId, existing);
  }

  /**
   * Retrieves effective limit for tenant and category.
   */
  public getEffectiveLimit(tenantId: string, category: RateLimitCategory): number {
    const overrides = this.tenantOverrides.get(tenantId);
    if (overrides && typeof overrides[category] === 'number') {
      return overrides[category]!;
    }
    return TenantRateLimiter.DEFAULT_TIERS[category].limit;
  }

  /**
   * Core sliding-window check and consumption.
   */
  public async checkRateLimit(params: {
    tenantId: string;
    category: RateLimitCategory;
    ip?: string;
    organizationId?: string;
  }): Promise<RateLimitCheckResult> {
    const now = Date.now();
    const { tenantId, category, ip, organizationId } = params;
    const tierConfig = TenantRateLimiter.DEFAULT_TIERS[category];
    const limit = this.getEffectiveLimit(tenantId, category);
    const windowMs = tierConfig.windowMs;

    const bucketKey = `${tenantId}:${category}`;
    let timestamps = this.requestBuckets.get(bucketKey) || [];

    // Filter out timestamps outside sliding window
    const cutoff = now - windowMs;
    timestamps = timestamps.filter((t) => t > cutoff);

    const currentCount = timestamps.length;
    const remaining = Math.max(0, limit - currentCount);

    // Calculate reset in seconds (time until oldest timestamp drops out of window, or window duration)
    let resetSeconds = Math.ceil(windowMs / 1000);
    if (timestamps.length > 0) {
      const oldest = timestamps[0];
      resetSeconds = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    }

    if (currentCount >= limit) {
      // Rate limit exceeded!
      const retryAfterSeconds = resetSeconds;
      const strikeData = this.abuseTracker.get(bucketKey) || { strikes: 0, lastViolation: 0 };

      // Strike increment if last violation was within 5 minutes
      if (now - strikeData.lastViolation < 300_000) {
        strikeData.strikes += 1;
      } else {
        strikeData.strikes = 1;
      }
      strikeData.lastViolation = now;
      this.abuseTracker.set(bucketKey, strikeData);

      const isSustainedAbuse = strikeData.strikes >= 3 || currentCount >= limit * 2;

      if (isSustainedAbuse) {
        logger.warn(
          `[RATE-LIMIT-ABUSE] Tenant '${tenantId}' has sustained rate limit abuse in category '${category}' (${strikeData.strikes} strikes, ${currentCount}/${limit} reqs)`,
          { tenantId, category, strikes: strikeData.strikes, ip }
        );

        // Escalate to Attention Center if available
        if (this.attentionService) {
          try {
            await this.attentionService.escalateToHuman({
              correlationId: `ratelimit-abuse-${tenantId}-${Date.now()}`,
              channel: 'security_governor',
              sourceAgentId: 'rate_limiter_governor',
              title: `Security Abuse Alert: Rate limit sustained violation on tenant '${tenantId}'`,
              description: `Tenant '${tenantId}' (IP: ${ip || 'unknown'}) triggered sustained rate limiting abuse in category '${category}'. Total strikes: ${strikeData.strikes}. Quota: ${limit}/min, Current requests: ${currentCount}.`,
              reasonCategory: 'security_anomaly',
              priority: 'P1_HIGH',
              contextData: {
                tenantId,
                category,
                strikes: strikeData.strikes,
                currentCount,
                limit,
                ip,
              },
            });
          } catch (err) {
            logger.error(`Failed to escalate rate limit abuse to Attention Center`, {
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }

      return {
        allowed: false,
        limit,
        remaining: 0,
        resetSeconds,
        retryAfterSeconds,
        currentCount,
        tier: category,
        isAbuse: isSustainedAbuse,
        strikeCount: strikeData.strikes,
      };
    }

    // Within limit: record this request timestamp
    timestamps.push(now);
    this.requestBuckets.set(bucketKey, timestamps);

    return {
      allowed: true,
      limit,
      remaining: Math.max(0, limit - timestamps.length),
      resetSeconds,
      retryAfterSeconds: 0,
      currentCount: timestamps.length,
      tier: category,
      isAbuse: false,
      strikeCount: this.abuseTracker.get(bucketKey)?.strikes || 0,
    };
  }

  /**
   * Formats standard RFC rate-limit headers.
   */
  public static getHeaders(result: RateLimitCheckResult): Record<string, string> {
    const headers: Record<string, string> = {
      'X-RateLimit-Limit': String(result.limit),
      'X-RateLimit-Remaining': String(result.remaining),
      'X-RateLimit-Reset': String(result.resetSeconds),
    };

    if (!result.allowed) {
      headers['Retry-After'] = String(result.retryAfterSeconds);
    }

    return headers;
  }

  /**
   * Returns current rate limit status for all categories for a tenant.
   */
  public getTenantStatus(tenantId: string): TenantRateLimitStatus {
    const now = Date.now();
    const categories: RateLimitCategory[] = ['auth', 'agent_execution', 'tools', 'standard_api', 'webhooks'];

    const resultCategories: any = {};

    for (const cat of categories) {
      const bucketKey = `${tenantId}:${cat}`;
      const tierConfig = TenantRateLimiter.DEFAULT_TIERS[cat];
      const limit = this.getEffectiveLimit(tenantId, cat);
      const cutoff = now - tierConfig.windowMs;

      let timestamps = this.requestBuckets.get(bucketKey) || [];
      timestamps = timestamps.filter((t) => t > cutoff);

      const count = timestamps.length;
      const remaining = Math.max(0, limit - count);
      let resetSec = Math.ceil(tierConfig.windowMs / 1000);
      if (timestamps.length > 0) {
        resetSec = Math.max(1, Math.ceil((timestamps[0] + tierConfig.windowMs - now) / 1000));
      }

      const strikeData = this.abuseTracker.get(bucketKey);

      resultCategories[cat] = {
        limit,
        currentCount: count,
        remaining,
        resetSeconds: resetSec,
        strikes: strikeData?.strikes || 0,
        isThrottled: count >= limit,
      };
    }

    return {
      tenantId,
      categories: resultCategories,
    };
  }

  /**
   * Resets rate limit counters and abuse strikes for a tenant.
   */
  public resetTenant(tenantId: string, category?: RateLimitCategory): void {
    if (category) {
      const bucketKey = `${tenantId}:${category}`;
      this.requestBuckets.delete(bucketKey);
      this.abuseTracker.delete(bucketKey);
    } else {
      const prefix = `${tenantId}:`;
      for (const key of this.requestBuckets.keys()) {
        if (key.startsWith(prefix)) {
          this.requestBuckets.delete(key);
        }
      }
      for (const key of this.abuseTracker.keys()) {
        if (key.startsWith(prefix)) {
          this.abuseTracker.delete(key);
        }
      }
    }
  }

  /**
   * Clear all internal buckets and trackers (primarily for test resets).
   */
  public clearAll(): void {
    this.requestBuckets.clear();
    this.abuseTracker.clear();
    this.tenantOverrides.clear();
  }
}
