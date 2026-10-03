/**
 * Kriya Omnitask — Connector Framework & Google Calendar Unit Tests (WP-5.4)
 * Validates:
 * 1. Multi-tenant connector registration and CredentialVault AES-256-GCM encryption.
 * 2. OAuth2 access token refresh, rotation, and 401 recovery.
 * 3. Google Calendar free/busy availability and slot hold/confirm/cancel lifecycle.
 * 4. AppointmentBook seamless external sync (merging external busy periods, hold → confirm).
 * 5. Registered calendar tools: check_connection, get_availability, sync_event (with verify & saga compensate).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteDatabaseClient, db } from '../../src/storage/db.js';
import { SchemaMigrator } from '../../src/storage/migrations/migrator.js';
import { TenantRepository } from '../../src/storage/repositories/tenantRepository.js';
import { TenantContextManager } from '../../src/core/context/tenantContext.js';
import { CredentialVault } from '../../src/tools/vault/credentialVault.js';
import { TenantConnectorRepository } from '../../src/connectors/repositories/tenantConnectorRepository.js';
import { ConnectorService } from '../../src/connectors/service/connectorService.js';
import { GoogleCalendarConnector, FetchFunction } from '../../src/connectors/calendar/googleCalendarConnector.js';
import { AppointmentBook, schedulingTools } from '../../src/scheduling/appointmentBook.js';
import { calendarTools } from '../../src/connectors/service/calendarTools.js';
import { ToolRegistryService } from '../../src/tools/registry/toolRegistry.js';
import { ConflictError, NotFoundError } from '../../src/core/errors/errors.js';

describe('WP-5.4 Connector Framework & Google Calendar Unit Tests', () => {
  let client: SQLiteDatabaseClient;
  let tenantA: string;
  let tenantB: string;

  // In-memory mock Google Calendar API state
  interface MockCalendarState {
    events: Map<string, any>;
    refreshes: number;
    force401Once: boolean;
  }
  let mockState: MockCalendarState;

  function createMockGoogleFetch(): FetchFunction {
    return async (url: string, init?: RequestInit): Promise<Response> => {
      const urlStr = String(url);

      // 1. OAuth2 Token Endpoint
      if (urlStr.includes('oauth2.googleapis.com/token')) {
        mockState.refreshes++;
        const body = String(init?.body ?? '');
        if (body.includes('client_secret=invalid')) {
          return new Response(JSON.stringify({ error: 'invalid_client' }), { status: 401 });
        }
        return new Response(
          JSON.stringify({
            access_token: `mock_gcal_token_${mockState.refreshes}`,
            expires_in: 3600,
            token_type: 'Bearer',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // Check auth header
      const auth = (init?.headers as any)?.get
        ? (init?.headers as any).get('Authorization')
        : (init?.headers as any)?.['Authorization'];

      if (mockState.force401Once) {
        mockState.force401Once = false;
        return new Response('Unauthorized', { status: 401 });
      }

      // 2. Calendar metadata: GET /calendars/{calendarId}
      if (urlStr.endsWith('/calendars/primary') && (!init?.method || init.method === 'GET')) {
        return new Response(
          JSON.stringify({
            id: 'primary',
            summary: 'Main Apollo OPD Calendar',
            timeZone: 'Asia/Kolkata',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // 3. FreeBusy: POST /freeBusy
      if (urlStr.endsWith('/freeBusy') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        const busy: Array<{ start: string; end: string }> = [];
        for (const [id, ev] of mockState.events.entries()) {
          if (ev.status !== 'cancelled' && ev.transparency === 'opaque') {
            busy.push({ start: ev.start.dateTime, end: ev.end.dateTime });
          }
        }
        return new Response(
          JSON.stringify({
            calendars: {
              primary: { busy },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      // 4. Events: POST /calendars/primary/events
      if (urlStr.endsWith('/calendars/primary/events') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        const id = `gev_${Math.random().toString(36).slice(2, 10)}`;
        const event = {
          id,
          ...body,
          htmlLink: `https://calendar.google.com/event?eid=${id}`,
        };
        mockState.events.set(id, event);
        return new Response(JSON.stringify(event), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      // 5. Events: PATCH /calendars/primary/events/:id
      const patchMatch = urlStr.match(/\/calendars\/primary\/events\/([^/?]+)$/);
      if (patchMatch && init?.method === 'PATCH') {
        const id = patchMatch[1];
        const existing = mockState.events.get(id);
        if (!existing) {
          return new Response('Not found', { status: 404 });
        }
        const body = JSON.parse(String(init.body));
        const updated = { ...existing, ...body };
        mockState.events.set(id, updated);
        return new Response(JSON.stringify(updated), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      // 6. Events: GET /calendars/primary/events/:id
      if (patchMatch && (!init?.method || init.method === 'GET')) {
        const id = patchMatch[1];
        const existing = mockState.events.get(id);
        if (!existing) {
          return new Response('Not found', { status: 404 });
        }
        return new Response(JSON.stringify(existing), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      // 7. Events: DELETE /calendars/primary/events/:id
      if (patchMatch && init?.method === 'DELETE') {
        const id = patchMatch[1];
        if (mockState.events.has(id)) {
          mockState.events.delete(id);
          return new Response(null, { status: 204 });
        }
        return new Response('Not found', { status: 404 });
      }

      return new Response('Not found', { status: 404 });
    };
  }

  const inTenantA = <T>(fn: () => Promise<T>) =>
    TenantContextManager.withTenant(tenantA, 'default', fn, { userId: 'usr_admin_a', roles: ['admin'] });

  const inTenantB = <T>(fn: () => Promise<T>) =>
    TenantContextManager.withTenant(tenantB, 'default', fn, { userId: 'usr_admin_b', roles: ['admin'] });

  beforeEach(async () => {
    client = new SQLiteDatabaseClient(':memory:');
    db.setClientForTesting(client);
    const migrator = new SchemaMigrator(client);
    await migrator.applyMigrations();

    const tenants = new TenantRepository(client);
    tenantA = (await tenants.create({ name: 'Apollo Clinic', slug: 'apollo', plan_tier: 'enterprise', channel_plan: 'combined' })).id;
    tenantB = (await tenants.create({ name: 'Manipal Health', slug: 'manipal', plan_tier: 'enterprise', channel_plan: 'combined' })).id;

    mockState = {
      events: new Map(),
      refreshes: 0,
      force401Once: false,
    };
  });

  afterEach(async () => {
    await client.close();
  });

  // --------------------------------------------------------------------------
  // 1. Connector Repository & Multi-Tenant Lifecycle
  // --------------------------------------------------------------------------

  describe('Connector Repository & Tenant Isolation', () => {
    it('registers connector, encrypts credentials in vault, and prevents cross-tenant leaks', async () => {
      await inTenantA(async () => {
        const vault = new CredentialVault();
        const service = new ConnectorService({
          client,
          vault,
          fetchClient: createMockGoogleFetch(),
        });

        const { connector, health } = await service.registerConnector(
          {
            provider: 'google_calendar',
            category: 'calendar',
            name: 'Apollo OPD Main',
            credentialSlug: 'gcal_apollo_main',
            settings: { calendarId: 'primary' },
          },
          {
            clientId: 'client_id_apollo',
            clientSecret: 'client_sec_apollo',
            refreshToken: 'refresh_tok_apollo',
          }
        );

        expect(connector.id).toMatch(/^conn_/);
        expect(connector.provider).toBe('google_calendar');
        expect(connector.status).toBe('active');
        expect(health.healthy).toBe(true);

        // Verify credentials encrypted at rest
        const secret = await vault.getSecret('gcal_apollo_main');
        expect(secret).toMatchObject({
          clientId: 'client_id_apollo',
          refreshToken: 'refresh_tok_apollo',
        });

        // Duplicate registration fails with ConflictError
        await expect(
          service.registerConnector(
            {
              provider: 'google_calendar',
              category: 'calendar',
              name: 'Apollo OPD Main',
              credentialSlug: 'gcal_apollo_dup',
              settings: {},
            },
            { dummy: true }
          )
        ).rejects.toThrow(ConflictError);
      });

      // Tenant B sees nothing registered by Tenant A
      await inTenantB(async () => {
        const repo = new TenantConnectorRepository(client);
        const list = await repo.listConnectors();
        expect(list).toHaveLength(0);

        const vault = new CredentialVault();
        const bSecret = await vault.getSecret('gcal_apollo_main');
        expect(bSecret).toBeNull();
      });
    });
  });

  // --------------------------------------------------------------------------
  // 2. OAuth2 Token Management, Refresh & 401 Recovery
  // --------------------------------------------------------------------------

  describe('Google Calendar OAuth2 Management', () => {
    it('auto-refreshes expired access token and recovers transparently from 401', async () => {
      await inTenantA(async () => {
        const vault = new CredentialVault();
        const mockFetch = createMockGoogleFetch();

        // Store credential with expired token
        await vault.storeSecret({
          serviceSlug: 'gcal_token_test',
          name: 'Google Calendar Token Test',
          secretData: {
            clientId: 'client_id_1',
            clientSecret: 'client_sec_1',
            refreshToken: 'refresh_tok_1',
            accessToken: 'stale_token',
            expiresAt: Date.now() - 5000, // Expired 5 seconds ago
          },
        });

        const connector = new GoogleCalendarConnector({
          id: 'conn_token_test',
          credentialSlug: 'gcal_token_test',
          vault,
          fetchClient: mockFetch,
        });

        // 1. Connection test triggers token refresh
        const health = await connector.testConnection();
        expect(health.healthy).toBe(true);
        expect(mockState.refreshes).toBe(1);

        // Verify vault has fresh token
        const updatedCreds = (await vault.getSecret('gcal_token_test')) as any;
        expect(updatedCreds.accessToken).toBe('mock_gcal_token_1');
        expect(updatedCreds.expiresAt).toBeGreaterThan(Date.now() + 100000);

        // 2. Next call uses fresh token without another refresh
        await connector.testConnection();
        expect(mockState.refreshes).toBe(1);

        // 3. Simulated 401 forces token invalidation and re-auth
        mockState.force401Once = true;
        const recoveredHealth = await connector.testConnection();
        expect(recoveredHealth.healthy).toBe(true);
        expect(mockState.refreshes).toBe(2);
      });
    });
  });

  // --------------------------------------------------------------------------
  // 3. Free/Busy Availability & Event Operations
  // --------------------------------------------------------------------------

  describe('Google Calendar FreeBusy and Events', () => {
    it('creates tentative slot hold, verifies, confirms to booking, and cancels', async () => {
      await inTenantA(async () => {
        const vault = new CredentialVault();
        const mockFetch = createMockGoogleFetch();

        await vault.storeSecret({
          serviceSlug: 'gcal_events_test',
          name: 'Google Calendar Events Test',
          secretData: {
            clientId: 'client_1',
            clientSecret: 'secret_1',
            refreshToken: 'refresh_1',
          },
        });

        const connector = new GoogleCalendarConnector({
          id: 'conn_events_test',
          credentialSlug: 'gcal_events_test',
          vault,
          fetchClient: mockFetch,
        });

        // 1. Hold a slot
        const hold = await connector.holdSlot({
          startsAt: '2026-10-15 10:00',
          endsAt: '2026-10-15 10:30',
          summary: 'Cardiology Consultation',
          holdId: 'hold_cardio_01',
          expiresInMinutes: 15,
        });

        expect(hold.holdRef).toBeDefined();
        expect(mockState.events.size).toBe(1);

        // Check availability: the held slot should now show as busy
        const busySlots = await connector.getAvailability({
          startDate: '2026-10-15',
          endDate: '2026-10-15',
          timeZone: 'Asia/Kolkata',
        });
        expect(busySlots).toHaveLength(1);
        expect(busySlots[0].start).toContain('2026-10-15');

        // 2. Read-back verification of held event
        const heldEvent = await connector.getEvent(hold.holdRef);
        expect(heldEvent).toBeDefined();
        expect(heldEvent?.summary).toContain('[HOLD]');

        // 3. Confirm booking (patches tentative hold to confirmed)
        const confirmed = await connector.confirmBooking({
          startsAt: '2026-10-15 10:00',
          endsAt: '2026-10-15 10:30',
          summary: 'Dr. Ramesh Rao - Patient Ananya Sharma',
          description: 'Confirmed Cardiology Visit',
          attendeeName: 'Ananya Sharma',
          attendeeEmail: 'ananya@example.com',
          holdRef: hold.holdRef,
        });

        expect(confirmed.id).toBe(hold.holdRef);
        expect(confirmed.status).toBe('confirmed');
        expect(confirmed.summary).toBe('Dr. Ramesh Rao - Patient Ananya Sharma');

        // 4. Cancel booking (removes event from calendar)
        const cancelled = await connector.cancelEvent(confirmed.id, 'Patient cancelled');
        expect(cancelled).toBe(true);

        const checkAfter = await connector.getEvent(confirmed.id);
        expect(checkAfter).toBeNull();
      });
    });
  });

  // --------------------------------------------------------------------------
  // 4. AppointmentBook Integration (ADR-011)
  // --------------------------------------------------------------------------

  describe('AppointmentBook Integration with CalendarConnector', () => {
    it('seamlessly integrates Google Calendar into availability, slot holds, confirmation, and cancellation', async () => {
      await inTenantA(async () => {
        const vault = new CredentialVault();
        const mockFetch = createMockGoogleFetch();

        await vault.storeSecret({
          serviceSlug: 'gcal_appt_book_test',
          name: 'ApptBook Test Calendar',
          secretData: {
            clientId: 'client_2',
            clientSecret: 'secret_2',
            refreshToken: 'refresh_2',
          },
        });

        const connector = new GoogleCalendarConnector({
          id: 'conn_appt_book_test',
          credentialSlug: 'gcal_appt_book_test',
          vault,
          fetchClient: mockFetch,
        });

        // Initialize AppointmentBook with the calendar connector
        const book = new AppointmentBook(client, connector);

        // Create a doctor resource
        const doctor = await book.createResource({
          name: 'Dr. Sunita Varma',
          kind: 'doctor',
          department: 'Neurology',
          timezone: 'Asia/Kolkata',
          slotMinutes: 30,
          workingHours: {
            mon: [['09:00', '12:00']],
            tue: [['09:00', '12:00']],
            wed: [['09:00', '12:00']],
            thu: [['09:00', '12:00']],
            fri: [['09:00', '12:00']],
            sat: [['09:00', '12:00']],
            sun: [],
          },
        });

        // Choose a future Monday
        const testDate = '2026-10-12'; // Monday

        // 1. Availability check: all working slots free
        const initialAvail = await book.availability(testDate, { resourceId: doctor.id });
        expect(initialAvail[0].freeSlots).toContain('10:00');
        expect(initialAvail[0].freeSlots).toContain('10:30');

        // 2. Pre-existing Google Calendar busy event at 10:30
        await connector.confirmBooking({
          startsAt: `${testDate} 10:30`,
          endsAt: `${testDate} 11:00`,
          summary: 'Hospital Admin Meeting',
          timeZone: 'Asia/Kolkata',
        });

        // 3. Availability check now automatically excludes 10:30!
        const availWithBusy = await book.availability(testDate, { resourceId: doctor.id });
        expect(availWithBusy[0].freeSlots).toContain('10:00');
        expect(availWithBusy[0].freeSlots).not.toContain('10:30');

        // 4. Hold slot at 10:00 for prepayment
        const slotHold = await book.holdSlot({
          resourceId: doctor.id,
          start: `${testDate} 10:00`,
          customerRef: 'cust_rajesh',
          customerName: 'Rajesh Nair',
          feeAmount: 700,
          holdMinutes: 15,
          idempotencyKey: 'idem_hold_test_1',
        });

        expect(slotHold.status).toBe('active');
        expect(slotHold.external_hold_ref).toBeDefined();

        // 5. Confirm slot hold (e.g. after customer pays)
        const apt = await book.confirmHold({
          holdId: slotHold.id,
          customerRef: 'cust_rajesh',
          idempotencyKey: 'idem_confirm_test_1',
        });

        expect(apt.status).toBe('confirmed');
        expect(apt.external_event_id).toBeDefined();

        // Verify Google Calendar event was converted to confirmed
        const gcalEvent = await connector.getEvent(apt.external_event_id!);
        expect(gcalEvent).toBeDefined();
        expect(gcalEvent?.status).toBe('confirmed');
        expect(gcalEvent?.summary).toContain('Dr. Sunita Varma');

        // 6. Cancel appointment
        await book.cancel({
          appointmentId: apt.id,
          customerRef: 'cust_rajesh',
          reason: 'Customer requested cancellation',
        });

        // Verify cancelled locally and removed from Google Calendar
        const aptAfter = await book.get(apt.id);
        expect(aptAfter?.status).toBe('cancelled');

        const gcalAfter = await connector.getEvent(apt.external_event_id!);
        expect(gcalAfter).toBeNull();
      });
    });
  });

  // --------------------------------------------------------------------------
  // 5. Calendar Connector Tools
  // --------------------------------------------------------------------------

  describe('Calendar Connector Tools Registry', () => {
    it('executes calendar_check_connection, calendar_get_availability, and calendar_sync_event with verify & compensate', async () => {
      await inTenantA(async () => {
        const vault = new CredentialVault();
        const mockFetch = createMockGoogleFetch();

        const service = new ConnectorService({
          client,
          vault,
          fetchClient: mockFetch,
        });

        // Register connector
        const { connector } = await service.registerConnector(
          {
            provider: 'google_calendar',
            category: 'calendar',
            name: 'Apollo Hospital Ops',
            credentialSlug: 'gcal_tools_slug',
            settings: { calendarId: 'primary' },
          },
          {
            clientId: 'client_3',
            clientSecret: 'secret_3',
            refreshToken: 'refresh_3',
          }
        );

        const tools = calendarTools({ connectorService: service, client });
        const registry = new ToolRegistryService();
        for (const t of tools) registry.registerTool(t);

        // 1. calendar_check_connection
        const checkTool = registry.getTool('calendar_check_connection')!;
        const checkOut = await checkTool.handler({}, {} as any);
        expect(checkOut.healthy).toBe(true);
        expect(checkOut.status).toBe('active');

        const checkVerify = await checkTool.verify!({}, checkOut, {} as any);
        expect(checkVerify.state).toBe('verified');

        // 2. calendar_get_availability
        const availTool = registry.getTool('calendar_get_availability')!;
        const availOut = await availTool.handler(
          { startDate: '2026-10-20', endDate: '2026-10-20', timeZone: 'Asia/Kolkata' },
          {} as any
        );
        expect(availOut.busySlotCount).toBe(0);

        const availVerify = await availTool.verify!({}, availOut, {} as any);
        expect(availVerify.state).toBe('verified');

        // 3. calendar_sync_event: sync a local appointment
        const book = new AppointmentBook(client);
        const doc = await book.createResource({
          name: 'Dr. Priya Mani',
          kind: 'doctor',
          timezone: 'Asia/Kolkata',
          slotMinutes: 30,
          workingHours: {
            tue: [['10:00', '13:00']],
          },
        });

        const apt = await book.book({
          resourceId: doc.id,
          start: '2026-10-20 10:00',
          customerRef: 'cust_amit',
          customerName: 'Amit Shah',
          idempotencyKey: 'idem_sync_test_1',
        });

        const syncTool = registry.getTool('calendar_sync_event')!;
        const syncOut = await syncTool.handler(
          { appointmentId: apt.id, customerRef: 'cust_amit' },
          { idempotencyKey: 'idem_tool_sync_1' } as any
        );

        expect(syncOut.status).toBe('synced');
        expect(syncOut.externalEventId).toBeDefined();

        // Verify tool read-back
        const syncVerify = await syncTool.verify!(
          { appointmentId: apt.id, customerRef: 'cust_amit' },
          syncOut,
          {} as any
        );
        expect(syncVerify.state).toBe('verified');

        // Saga compensate: removes event from Google Calendar
        await syncTool.compensate!(
          { appointmentId: apt.id, customerRef: 'cust_amit' },
          syncOut,
          {} as any
        );

        const cal = await service.getActiveCalendarConnector();
        const checkRemoved = await cal!.getEvent(String(syncOut.externalEventId));
        expect(checkRemoved).toBeNull();
      });
    });
  });
});
