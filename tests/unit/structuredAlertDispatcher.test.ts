import { describe, it, expect } from 'vitest';
import { StructuredAlertDispatcher } from '../../src/sre/alerts/structuredAlertDispatcher.js';
import { SreAlert } from '../../src/sre/types/sreTypes.js';

describe('StructuredAlertDispatcher Unit Tests', () => {
  const alert: SreAlert = {
    id: 'alert_unit_test',
    sloId: 'slo_avail_test',
    severity: 'P1_CRITICAL',
    title: 'High Error Rate on Agent Inference',
    summary: 'Inference error rate reached 8.5% over 15 minutes',
    channels: ['slack', 'pagerduty', 'webhook'],
    status: 'firing',
    dispatchedAt: '2026-03-01T12:00:00.000Z',
  };

  it('should format multi-channel notification payloads for Slack, PagerDuty, and Webhooks', () => {
    const payloads = StructuredAlertDispatcher.dispatchAlert(alert);

    expect(payloads.length).toBe(3);

    const slackPayload = payloads.find((p) => p.channel === 'slack')!;
    expect(slackPayload).toBeDefined();
    expect(slackPayload.formattedMessage).toContain('P1-CRITICAL');
    expect(slackPayload.formattedMessage).toContain('High Error Rate');

    const pdPayload = payloads.find((p) => p.channel === 'pagerduty')!;
    expect(pdPayload).toBeDefined();
    const pdJson = JSON.parse(pdPayload.formattedMessage);
    expect(pdJson.event_action).toBe('trigger');
    expect(pdJson.payload.severity).toBe('critical');

    const whPayload = payloads.find((p) => p.channel === 'webhook')!;
    expect(whPayload).toBeDefined();
    const whJson = JSON.parse(whPayload.formattedMessage);
    expect(whJson.alertId).toBe('alert_unit_test');
    expect(whJson.severity).toBe('P1_CRITICAL');
  });
});
