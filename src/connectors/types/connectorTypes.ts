/**
 * Kriya Omnitask — Connector Framework Types (WP-5.4, Blueprint §05, §13, ADR-011)
 * Standardized interfaces for external SaaS integrations (calendars, CRMs, etc.)
 * backed by AES-256-GCM credential vault storage and verifiable read-backs.
 */

import { z } from 'zod';

export type ConnectorCategory = 'calendar' | 'crm' | 'communication' | 'payment' | 'storage' | 'custom';
export type ConnectorStatus = 'active' | 'disconnected' | 'expired' | 'error';

export interface TenantConnectorRecord {
  id: string;
  tenant_id: string;
  provider: string;
  category: ConnectorCategory;
  name: string;
  status: ConnectorStatus;
  credential_slug: string;
  settings_json: string;
  last_synced_at: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConnectorHealthCheck {
  healthy: boolean;
  status: ConnectorStatus;
  latencyMs: number;
  message?: string;
  details?: Record<string, unknown>;
}

export interface CalendarTimeSlot {
  start: string; // ISO 8601 or 'YYYY-MM-DD HH:MM'
  end: string;   // ISO 8601 or 'YYYY-MM-DD HH:MM'
  available: boolean;
}

export interface CalendarEventRecord {
  id: string;
  calendarId: string;
  summary: string;
  description?: string;
  startsAt: string; // ISO 8601
  endsAt: string;   // ISO 8601
  status: 'confirmed' | 'tentative' | 'cancelled';
  htmlLink?: string;
  attendeeEmail?: string;
  attendeeName?: string;
  metadata?: Record<string, unknown>;
}

export interface CalendarHoldResult {
  holdRef: string;
  eventId?: string;
  startsAt: string;
  endsAt: string;
  expiresAt: string;
}

export interface BaseConnector {
  readonly id: string;
  readonly provider: string;
  readonly category: ConnectorCategory;
  testConnection(): Promise<ConnectorHealthCheck>;
  disconnect(): Promise<void>;
}

export interface CalendarConnector extends BaseConnector {
  readonly category: 'calendar';
  getAvailability(params: {
    startDate: string; // 'YYYY-MM-DD'
    endDate: string;   // 'YYYY-MM-DD'
    timeZone: string;
    resourceEmail?: string;
  }): Promise<CalendarTimeSlot[]>;

  holdSlot(params: {
    startsAt: string;  // ISO 8601 or 'YYYY-MM-DD HH:MM'
    endsAt: string;
    summary: string;
    holdId: string;
    expiresInMinutes?: number;
    timeZone?: string;
  }): Promise<CalendarHoldResult>;

  confirmBooking(params: {
    startsAt: string;
    endsAt: string;
    summary: string;
    description?: string;
    attendeeEmail?: string;
    attendeeName?: string;
    holdRef?: string;
    timeZone?: string;
  }): Promise<CalendarEventRecord>;

  getEvent(eventId: string): Promise<CalendarEventRecord | null>;

  cancelEvent(eventId: string, reason?: string): Promise<boolean>;
}

export const RegisterConnectorSchema = z.object({
  provider: z.string().min(1).max(50),
  category: z.enum(['calendar', 'crm', 'communication', 'payment', 'storage', 'custom']),
  name: z.string().min(1).max(120),
  credentialSlug: z.string().min(1).max(100),
  settings: z.record(z.unknown()).default({}),
});
export type RegisterConnectorInput = z.infer<typeof RegisterConnectorSchema>;
