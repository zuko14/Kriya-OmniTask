/**
 * Kriya AI — Frequency Governor Unit Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { FrequencyGovernor } from '../../src/channels/governor/frequencyGovernor.js';

describe('Frequency Governor Unit Tests', () => {
  let governor: FrequencyGovernor;

  beforeEach(() => {
    governor = new FrequencyGovernor();
  });

  it('should detect quiet hours accurately across overnight intervals', () => {
    // 23:30 (11:30 PM UTC) -> inside 21:00 to 09:00
    const lateNight = new Date('2026-08-15T23:30:00Z');
    expect(governor.isQuietHours({ startHour: 21, endHour: 9, timezone: 'UTC' }, lateNight)).toBe(true);

    // 04:15 (4:15 AM UTC) -> inside 21:00 to 09:00
    const earlyMorning = new Date('2026-08-15T04:15:00Z');
    expect(governor.isQuietHours({ startHour: 21, endHour: 9, timezone: 'UTC' }, earlyMorning)).toBe(true);

    // 14:00 (2:00 PM UTC) -> outside quiet hours
    const midDay = new Date('2026-08-15T14:00:00Z');
    expect(governor.isQuietHours({ startHour: 21, endHour: 9, timezone: 'UTC' }, midDay)).toBe(false);
  });

  it('should throttle proactive outreach during quiet hours', async () => {
    const lateNight = new Date('2026-08-15T22:00:00Z');
    const res = await governor.evaluateOutbound({
      customerId: 'cust-123',
      isDirectResponse: false,
      currentTime: lateNight,
      quietHours: { startHour: 21, endHour: 9, timezone: 'UTC' },
    });

    expect(res.allowed).toBe(false);
    expect(res.status).toBe('throttled_quiet_hours');
    expect(res.reason).toContain('prohibited during quiet hours');
  });

  it('should exempt direct conversational replies from quiet hours and proactive throttle', async () => {
    const lateNight = new Date('2026-08-15T22:00:00Z');
    const res = await governor.evaluateOutbound({
      customerId: 'cust-123',
      isDirectResponse: true, // Direct response to customer inquiry
      currentTime: lateNight,
    });

    expect(res.allowed).toBe(true);
    expect(res.status).toBe('allowed');
  });
});
