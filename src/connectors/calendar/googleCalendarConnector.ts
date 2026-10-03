/**
 * Kriya Omnitask — Google Calendar Connector (WP-5.4, Blueprint §05, §13, ADR-011)
 * Production Google Calendar integration supporting OAuth2 token rotation via CredentialVault,
 * free/busy slot queries, tentative slot holds, booking confirmation, read-back verification,
 * and saga cancellation.
 */

import { CredentialVault } from '../../tools/vault/credentialVault.js';
import { logger } from '../../core/logger/logger.js';
import { NotFoundError, ValidationError, UnauthorizedError } from '../../core/errors/errors.js';
import {
  CalendarConnector,
  CalendarEventRecord,
  CalendarHoldResult,
  CalendarTimeSlot,
  ConnectorHealthCheck,
} from '../types/connectorTypes.js';

export interface GoogleCalendarOAuthSecret {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  accessToken?: string;
  expiresAt?: number; // epoch ms
  calendarId?: string; // defaults to 'primary'
}

export type FetchFunction = (url: string, init?: RequestInit) => Promise<Response>;

export interface GoogleCalendarConnectorOptions {
  id: string;
  credentialSlug: string;
  vault: CredentialVault;
  calendarId?: string;
  fetchClient?: FetchFunction;
}

export class GoogleCalendarConnector implements CalendarConnector {
  public readonly id: string;
  public readonly provider = 'google_calendar';
  public readonly category = 'calendar' as const;

  private credentialSlug: string;
  private vault: CredentialVault;
  private calendarId: string;
  private fetchClient: FetchFunction;

  constructor(opts: GoogleCalendarConnectorOptions) {
    this.id = opts.id;
    this.credentialSlug = opts.credentialSlug;
    this.vault = opts.vault;
    this.calendarId = opts.calendarId ?? 'primary';
    this.fetchClient = opts.fetchClient ?? fetch;
  }

  /**
   * Retrieves OAuth2 credentials from the vault, auto-refreshing expired access tokens.
   */
  private async getFreshCredentials(): Promise<{ token: string; calendarId: string }> {
    const creds = await this.vault.getSecret<GoogleCalendarOAuthSecret>(this.credentialSlug);
    if (!creds) {
      throw new NotFoundError(
        `OAuth credentials not found in vault under slug '${this.credentialSlug}' for Google Calendar.`
      );
    }

    if (!creds.clientId || !creds.clientSecret || !creds.refreshToken) {
      throw new ValidationError(
        `Incomplete Google Calendar OAuth configuration in vault under '${this.credentialSlug}'.`
      );
    }

    const now = Date.now();
    const isExpired = !creds.accessToken || !creds.expiresAt || now >= creds.expiresAt - 60_000;

    if (!isExpired && creds.accessToken) {
      return {
        token: creds.accessToken,
        calendarId: this.calendarId !== 'primary' ? this.calendarId : (creds.calendarId ?? 'primary'),
      };
    }

    // Refresh token via Google OAuth2 endpoint
    logger.info(`Refreshing Google Calendar OAuth access token for connector '${this.id}'`);
    const params = new URLSearchParams({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      refresh_token: creds.refreshToken,
      grant_type: 'refresh_token',
    });

    const res = await this.fetchClient('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!res.ok) {
      const errText = await res.text();
      logger.error(`Google OAuth token refresh failed: ${errText}`);
      throw new UnauthorizedError(`Google Calendar token refresh failed: ${res.statusText}`);
    }

    const data = (await res.json()) as { access_token: string; expires_in: number };
    const updatedCreds: GoogleCalendarOAuthSecret = {
      ...creds,
      accessToken: data.access_token,
      expiresAt: now + data.expires_in * 1000,
    };

    // Update vault with fresh token
    await this.vault.storeSecret({
      serviceSlug: this.credentialSlug,
      name: `Google Calendar (${this.id})`,
      secretData: updatedCreds as any,
    });

    return {
      token: data.access_token,
      calendarId: this.calendarId !== 'primary' ? this.calendarId : (creds.calendarId ?? 'primary'),
    };
  }

  /**
   * Authenticated Google API request helper with 401 retry once on fresh token.
   */
  private async apiRequest(path: string, init: RequestInit = {}, retryOn401 = true): Promise<Response> {
    const { token, calendarId } = await this.getFreshCredentials();
    const finalPath = path.replace('{calendarId}', encodeURIComponent(calendarId));
    const url = finalPath.startsWith('http') ? finalPath : `https://www.googleapis.com/calendar/v3${finalPath}`;

    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    headers.set('Accept', 'application/json');
    if (init.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    const res = await this.fetchClient(url, { ...init, headers });

    if (res.status === 401 && retryOn401) {
      // Invalidate token in vault and retry
      const creds = await this.vault.getSecret<GoogleCalendarOAuthSecret>(this.credentialSlug);
      if (creds) {
        creds.accessToken = undefined;
        creds.expiresAt = undefined;
        await this.vault.storeSecret({
          serviceSlug: this.credentialSlug,
          name: `Google Calendar (${this.id})`,
          secretData: creds as any,
        });
      }
      return this.apiRequest(path, init, false);
    }

    return res;
  }

  public async testConnection(): Promise<ConnectorHealthCheck> {
    const start = Date.now();
    try {
      const res = await this.apiRequest('/calendars/{calendarId}');
      const latencyMs = Date.now() - start;
      if (!res.ok) {
        return {
          healthy: false,
          status: 'error',
          latencyMs,
          message: `Google Calendar API returned HTTP ${res.status}: ${res.statusText}`,
        };
      }
      const data = (await res.json()) as { summary?: string; id?: string };
      return {
        healthy: true,
        status: 'active',
        latencyMs,
        message: 'Successfully connected to Google Calendar',
        details: { calendarSummary: data.summary, calendarId: data.id },
      };
    } catch (err: any) {
      return {
        healthy: false,
        status: 'error',
        latencyMs: Date.now() - start,
        message: err.message ?? 'Connection failed',
      };
    }
  }

  public async getAvailability(params: {
    startDate: string;
    endDate: string;
    timeZone: string;
    resourceEmail?: string;
  }): Promise<CalendarTimeSlot[]> {
    const { calendarId } = await this.getFreshCredentials();
    const targetCalendar = params.resourceEmail ?? calendarId;

    const timeMin = new Date(`${params.startDate}T00:00:00`).toISOString();
    const timeMax = new Date(`${params.endDate}T23:59:59`).toISOString();

    const res = await this.apiRequest('/freeBusy', {
      method: 'POST',
      body: JSON.stringify({
        timeMin,
        timeMax,
        timeZone: params.timeZone,
        items: [{ id: targetCalendar }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Google Calendar freeBusy query failed: ${errText}`);
    }

    const data = (await res.json()) as {
      calendars?: Record<string, { busy?: Array<{ start: string; end: string }> }>;
    };

    const busyRanges = data.calendars?.[targetCalendar]?.busy ?? [];

    // Map busy ranges into slots
    return busyRanges.map((b) => ({
      start: b.start,
      end: b.end,
      available: false,
    }));
  }

  public async holdSlot(params: {
    startsAt: string;
    endsAt: string;
    summary: string;
    holdId: string;
    expiresInMinutes?: number;
    timeZone?: string;
  }): Promise<CalendarHoldResult> {
    const expiresAt = new Date(Date.now() + (params.expiresInMinutes ?? 15) * 60_000).toISOString();
    const tz = params.timeZone ?? 'Asia/Kolkata';

    const startIso = params.startsAt.includes('T')
      ? params.startsAt
      : new Date(`${params.startsAt.replace(' ', 'T')}:00`).toISOString();
    const endIso = params.endsAt.includes('T')
      ? params.endsAt
      : new Date(`${params.endsAt.replace(' ', 'T')}:00`).toISOString();

    const payload = {
      summary: `[HOLD] ${params.summary} (Ref: ${params.holdId})`,
      description: `Temporary reservation held by Kriya AI. Hold ID: ${params.holdId}. Expires at: ${expiresAt}`,
      start: { dateTime: startIso, timeZone: tz },
      end: { dateTime: endIso, timeZone: tz },
      status: 'tentative',
      transparency: 'opaque', // Blocks out the slot in free/busy queries
      extendedProperties: {
        private: {
          kriya_hold_id: params.holdId,
          kriya_expires_at: expiresAt,
          kriya_connector_id: this.id,
        },
      },
    };

    const res = await this.apiRequest('/calendars/{calendarId}/events', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Failed to create Google Calendar hold event: ${errText}`);
    }

    const event = (await res.json()) as { id: string };

    return {
      holdRef: event.id,
      eventId: event.id,
      startsAt: startIso,
      endsAt: endIso,
      expiresAt,
    };
  }

  public async confirmBooking(params: {
    startsAt: string;
    endsAt: string;
    summary: string;
    description?: string;
    attendeeEmail?: string;
    attendeeName?: string;
    holdRef?: string;
    timeZone?: string;
  }): Promise<CalendarEventRecord> {
    const tz = params.timeZone ?? 'Asia/Kolkata';
    const startIso = params.startsAt.includes('T')
      ? params.startsAt
      : new Date(`${params.startsAt.replace(' ', 'T')}:00`).toISOString();
    const endIso = params.endsAt.includes('T')
      ? params.endsAt
      : new Date(`${params.endsAt.replace(' ', 'T')}:00`).toISOString();

    const attendees = params.attendeeEmail
      ? [{ email: params.attendeeEmail, displayName: params.attendeeName }]
      : undefined;

    const payload = {
      summary: params.summary,
      description: params.description ?? 'Confirmed appointment via Kriya AI',
      start: { dateTime: startIso, timeZone: tz },
      end: { dateTime: endIso, timeZone: tz },
      status: 'confirmed',
      transparency: 'opaque',
      attendees,
      extendedProperties: {
        private: {
          kriya_connector_id: this.id,
          kriya_confirmed_at: new Date().toISOString(),
          ...(params.holdRef ? { kriya_previous_hold_ref: params.holdRef } : {}),
        },
      },
    };

    let res: Response;
    if (params.holdRef) {
      // Convert existing hold into confirmed booking
      res = await this.apiRequest(`/calendars/{calendarId}/events/${params.holdRef}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      // Fallback to POST if patch failed because hold expired or was removed
      if (!res.ok && res.status === 404) {
        res = await this.apiRequest('/calendars/{calendarId}/events', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
    } else {
      res = await this.apiRequest('/calendars/{calendarId}/events', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    }

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Failed to confirm Google Calendar event: ${errText}`);
    }

    const event = (await res.json()) as {
      id: string;
      summary: string;
      description?: string;
      htmlLink?: string;
      status: string;
      start: { dateTime?: string; date?: string };
      end: { dateTime?: string; date?: string };
    };

    const { calendarId } = await this.getFreshCredentials();

    return {
      id: event.id,
      calendarId,
      summary: event.summary,
      description: event.description,
      startsAt: event.start.dateTime ?? event.start.date ?? startIso,
      endsAt: event.end.dateTime ?? event.end.date ?? endIso,
      status: 'confirmed',
      htmlLink: event.htmlLink,
      attendeeEmail: params.attendeeEmail,
      attendeeName: params.attendeeName,
    };
  }

  public async getEvent(eventId: string): Promise<CalendarEventRecord | null> {
    const res = await this.apiRequest(`/calendars/{calendarId}/events/${encodeURIComponent(eventId)}`);
    if (res.status === 404 || res.status === 410) {
      return null;
    }
    if (!res.ok) {
      throw new Error(`Failed to get Google Calendar event '${eventId}': ${res.statusText}`);
    }

    const event = (await res.json()) as {
      id: string;
      summary: string;
      description?: string;
      htmlLink?: string;
      status: string;
      start: { dateTime?: string; date?: string };
      end: { dateTime?: string; date?: string };
      attendees?: Array<{ email?: string; displayName?: string }>;
    };

    const { calendarId } = await this.getFreshCredentials();

    return {
      id: event.id,
      calendarId,
      summary: event.summary,
      description: event.description,
      startsAt: event.start.dateTime ?? event.start.date ?? '',
      endsAt: event.end.dateTime ?? event.end.date ?? '',
      status: event.status === 'cancelled' ? 'cancelled' : 'confirmed',
      htmlLink: event.htmlLink,
      attendeeEmail: event.attendees?.[0]?.email,
      attendeeName: event.attendees?.[0]?.displayName,
    };
  }

  public async cancelEvent(eventId: string, reason?: string): Promise<boolean> {
    const res = await this.apiRequest(`/calendars/{calendarId}/events/${encodeURIComponent(eventId)}`, {
      method: 'DELETE',
    });

    if (res.status === 404 || res.status === 410 || res.ok) {
      logger.info(`Google Calendar event '${eventId}' cancelled. Reason: ${reason ?? 'none'}`);
      return true;
    }

    const errText = await res.text();
    logger.warn(`Could not delete Google Calendar event '${eventId}': ${errText}`);
    return false;
  }

  public async disconnect(): Promise<void> {
    logger.info(`Disconnecting Google Calendar connector '${this.id}'`);
  }
}
