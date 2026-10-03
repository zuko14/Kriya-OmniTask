/**
 * Kriya AI — Structured Multi-Channel SRE Alert Dispatcher
 * Formats and routes operational incident alerts to Slack, PagerDuty, Webhooks, and Email.
 */

import { SreAlert, DispatchNotificationPayload, AlertChannel } from '../types/sreTypes.js';

export class StructuredAlertDispatcher {
  /**
   * Formats alert notifications for all configured notification channels.
   */
  public static dispatchAlert(alert: SreAlert): DispatchNotificationPayload[] {
    const payloads: DispatchNotificationPayload[] = [];

    for (const channel of alert.channels) {
      const formattedMessage = this.formatForChannel(alert, channel);
      payloads.push({
        alertId: alert.id,
        severity: alert.severity,
        title: alert.title,
        summary: alert.summary,
        channel,
        dispatchedAt: alert.dispatchedAt,
        formattedMessage,
      });
    }

    return payloads;
  }

  private static formatForChannel(alert: SreAlert, channel: AlertChannel): string {
    const severityEmoji = {
      P1_CRITICAL: '🚨 [P1-CRITICAL]',
      P2_HIGH: '⚠️ [P2-HIGH]',
      P3_MEDIUM: '🟡 [P3-MEDIUM]',
      P4_LOW: 'ℹ️ [P4-LOW]',
    }[alert.severity];

    switch (channel) {
      case 'slack': {
        return JSON.stringify({
          blocks: [
            {
              type: 'header',
              text: { type: 'plain_text', text: `${severityEmoji} ${alert.title}` },
            },
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*Summary:* ${alert.summary}\n*Status:* \`${alert.status}\`\n*Timestamp:* \`${alert.dispatchedAt}\``,
              },
            },
          ],
        });
      }

      case 'pagerduty': {
        return JSON.stringify({
          routing_key: 'pd_sre_routing_key',
          event_action: alert.status === 'resolved' ? 'resolve' : 'trigger',
          dedup_key: alert.id,
          payload: {
            summary: `${severityEmoji} ${alert.title}: ${alert.summary}`,
            severity: alert.severity === 'P1_CRITICAL' ? 'critical' : 'warning',
            source: 'kriya-sre-engine',
            timestamp: alert.dispatchedAt,
          },
        });
      }

      case 'webhook':
      case 'email':
      default: {
        return JSON.stringify({
          alertId: alert.id,
          severity: alert.severity,
          title: alert.title,
          summary: alert.summary,
          status: alert.status,
          dispatchedAt: alert.dispatchedAt,
          metadata: alert.metadata,
        });
      }
    }
  }
}
