/**
 * Kriya AI — Anti-Spam & Contact Frequency Governor
 * Enforces strict quiet hours, interaction quotas, and response-window rules (§21 of CLAUDE.md).
 */

import { MessageRepository } from '../repositories/messageRepository.js';

export interface QuietHoursConfig {
  enabled: boolean;
  startHour: number; // 0-23 (e.g. 21 for 9 PM)
  endHour: number; // 0-23 (e.g. 9 for 9 AM)
  timezone: string; // e.g. "Asia/Kolkata", "UTC"
}

export interface FrequencyLimitConfig {
  maxProactivePerDay: number; // default: 3
  maxProactivePerWeek: number; // default: 7
}

export interface GovernorCheckResult {
  allowed: boolean;
  reason?: string;
  status: 'allowed' | 'throttled_quiet_hours' | 'throttled_frequency_limit';
}

export class FrequencyGovernor {
  private messageRepo: MessageRepository;

  constructor(messageRepo?: MessageRepository) {
    this.messageRepo = messageRepo || new MessageRepository();
  }

  /**
   * Evaluates whether the current local time falls inside quiet hours.
   */
  public isQuietHours(config?: Partial<QuietHoursConfig>, referenceDate = new Date()): boolean {
    const quietConfig: QuietHoursConfig = {
      enabled: config?.enabled ?? true,
      startHour: config?.startHour ?? 21, // 9 PM
      endHour: config?.endHour ?? 9, // 9 AM
      timezone: config?.timezone ?? 'UTC',
    };

    if (!quietConfig.enabled) return false;

    // Resolve local hour in configured timezone
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: quietConfig.timezone,
      hour: 'numeric',
      hour12: false,
    });

    const hourStr = formatter.format(referenceDate);
    const hour = parseInt(hourStr, 10);

    if (quietConfig.startHour > quietConfig.endHour) {
      // Overnight range, e.g. 21:00 to 09:00
      return hour >= quietConfig.startHour || hour < quietConfig.endHour;
    } else {
      // Intraday range, e.g. 01:00 to 06:00
      return hour >= quietConfig.startHour && hour < quietConfig.endHour;
    }
  }

  /**
   * Asserts outbound sending permission for a customer.
   */
  public async evaluateOutbound(params: {
    customerId?: string;
    isDirectResponse?: boolean; // Customer initiated message within last 24 hours
    quietHours?: Partial<QuietHoursConfig>;
    limits?: Partial<FrequencyLimitConfig>;
    currentTime?: Date;
  }): Promise<GovernorCheckResult> {
    // 1. If direct response to active customer conversation within 24h, always allow
    if (params.isDirectResponse) {
      return { allowed: true, status: 'allowed' };
    }

    const now = params.currentTime || new Date();

    // 2. Quiet hours check for proactive outreach
    if (this.isQuietHours(params.quietHours, now)) {
      return {
        allowed: false,
        reason: 'Outreach prohibited during quiet hours (21:00 - 09:00). Proactive messages are held.',
        status: 'throttled_quiet_hours',
      };
    }

    // 3. Proactive frequency limit checks
    if (params.customerId) {
      const maxDaily = params.limits?.maxProactivePerDay ?? 3;
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
      const count24h = await this.messageRepo.countRecentOutboundForCustomer(params.customerId, oneDayAgo);

      if (count24h >= maxDaily) {
        return {
          allowed: false,
          reason: `Daily proactive contact frequency limit reached (${count24h}/${maxDaily} in 24h).`,
          status: 'throttled_frequency_limit',
        };
      }

      const maxWeekly = params.limits?.maxProactivePerWeek ?? 7;
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const count7d = await this.messageRepo.countRecentOutboundForCustomer(params.customerId, sevenDaysAgo);

      if (count7d >= maxWeekly) {
        return {
          allowed: false,
          reason: `Weekly proactive contact frequency limit reached (${count7d}/${maxWeekly} in 7d).`,
          status: 'throttled_frequency_limit',
        };
      }
    }

    return { allowed: true, status: 'allowed' };
  }
}
