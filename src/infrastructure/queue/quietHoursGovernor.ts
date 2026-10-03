/**
 * Kriya AI — Quiet Hours & Timezone Scheduling Governor
 * Enforces business hours, quiet hours (21:00 - 09:00 default), and timezone-aware execution (§21 of CLAUDE.md, docs/kriya WP-5.9).
 */

export interface QuietHoursPolicyConfig {
  enabled?: boolean;
  startHour?: number; // default: 21 (9 PM)
  endHour?: number; // default: 9 (9 AM)
  timezone?: string; // IANA timezone, default: 'UTC'
}

export interface QuietHoursCheck {
  isQuietHours: boolean;
  localHour: number;
  timezone: string;
  nextAllowedRunAt?: string; // ISO 8601 string of next opening window
}

export class QuietHoursGovernor {
  public static readonly DEFAULT_START_HOUR = 21; // 21:00 (9 PM)
  public static readonly DEFAULT_END_HOUR = 9;   // 09:00 (9 AM)
  public static readonly DEFAULT_TIMEZONE = 'UTC';

  /**
   * Evaluates if a given timestamp falls within quiet hours in the specified timezone.
   */
  public static evaluate(
    date: Date = new Date(),
    config?: QuietHoursPolicyConfig
  ): QuietHoursCheck {
    const enabled = config?.enabled ?? true;
    const startHour = config?.startHour ?? this.DEFAULT_START_HOUR;
    const endHour = config?.endHour ?? this.DEFAULT_END_HOUR;
    const timezone = config?.timezone || this.DEFAULT_TIMEZONE;

    if (!enabled) {
      return {
        isQuietHours: false,
        localHour: date.getUTCHours(),
        timezone,
      };
    }

    const localHour = this.getLocalHour(date, timezone);
    const inQuietRange = this.isHourInQuietRange(localHour, startHour, endHour);

    if (!inQuietRange) {
      return {
        isQuietHours: false,
        localHour,
        timezone,
      };
    }

    const nextAllowedRunAt = this.calculateNextOpeningTime(date, timezone, startHour, endHour);

    return {
      isQuietHours: true,
      localHour,
      timezone,
      nextAllowedRunAt: nextAllowedRunAt.toISOString(),
    };
  }

  /**
   * Calculates the earliest allowed execution time for a job postponed by quiet hours.
   */
  public static calculateNextOpeningTime(
    date: Date,
    timezone: string,
    startHour: number = this.DEFAULT_START_HOUR,
    endHour: number = this.DEFAULT_END_HOUR
  ): Date {
    // Resolve local parts in target timezone
    const parts = this.getTimezoneParts(date, timezone);
    const localHour = parts.hour;

    let daysToAdd = 0;
    if (startHour > endHour) {
      // Overnight range, e.g. 21 to 9. If hour >= 21, opening is tomorrow at endHour.
      // If hour < 9, opening is today at endHour.
      if (localHour >= startHour) {
        daysToAdd = 1;
      } else {
        daysToAdd = 0;
      }
    } else {
      // Intraday range, e.g. 1 to 6. If hour >= startHour, opening is today at endHour.
      daysToAdd = 0;
    }

    // Construct local target date components
    const targetDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + daysToAdd, endHour, 0, 0, 0));

    // Convert local target back to UTC by determining the timezone offset at that target
    const targetOffsetMs = this.getTimezoneOffsetMs(targetDate, timezone);
    return new Date(targetDate.getTime() - targetOffsetMs);
  }

  public static getLocalHour(date: Date, timezone: string): number {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      hour12: false,
    });
    const formatted = formatter.format(date);
    return parseInt(formatted, 10);
  }

  private static isHourInQuietRange(hour: number, startHour: number, endHour: number): boolean {
    if (startHour > endHour) {
      return hour >= startHour || hour < endHour;
    }
    return hour >= startHour && hour < endHour;
  }

  private static getTimezoneParts(date: Date, timezone: string): {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
  } {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hour12: false,
    });
    const parts = formatter.formatToParts(date);
    const map: Record<string, number> = {};
    for (const p of parts) {
      if (p.type !== 'literal') {
        map[p.type] = parseInt(p.value, 10);
      }
    }
    return {
      year: map.year || date.getUTCFullYear(),
      month: map.month || date.getUTCMonth() + 1,
      day: map.day || date.getUTCDate(),
      hour: map.hour || 0,
      minute: map.minute || 0,
      second: map.second || 0,
    };
  }

  private static getTimezoneOffsetMs(utcApproxDate: Date, timezone: string): number {
    const parts = this.getTimezoneParts(utcApproxDate, timezone);
    const localTimestamp = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    return localTimestamp - utcApproxDate.getTime();
  }
}
