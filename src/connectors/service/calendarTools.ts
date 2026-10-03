/**
 * Kriya Omnitask — Calendar Connector Tools (WP-5.4, Blueprint §05, §13, ADR-011)
 * Registered tools enabling agents to inspect, verify, and synchronize external calendar integrations.
 */

import { z } from 'zod';
import { ConnectorService } from './connectorService.js';
import { AppointmentBook } from '../../scheduling/appointmentBook.js';
import { DatabaseClient } from '../../storage/db.js';
import { NotFoundError, ValidationError } from '../../core/errors/errors.js';
import type { RegisteredTool } from '../../tools/registry/toolRegistry.js';

export function calendarTools(deps: {
  connectorService?: ConnectorService;
  client?: DatabaseClient;
} = {}): RegisteredTool[] {
  const service = deps.connectorService ?? new ConnectorService({ client: deps.client });
  const book = new AppointmentBook(deps.client);

  const def = (slug: string, name: string, description: string, riskTier: 'LOW' | 'MEDIUM') => ({
    slug,
    name,
    description,
    category: 'calendar' as const,
    riskTier,
    requiresApproval: false,
    inputSchema: {},
    outputSchema: {},
    isSystem: true,
  });

  return [
    {
      definition: def(
        'calendar_check_connection',
        'Check Calendar Connection',
        'Tests external calendar connectivity and credentials (OAuth token status).',
        'LOW'
      ),
      inputValidator: z.object({
        connectorId: z.string().optional(),
      }),
      handler: async (input) => {
        let connId = input.connectorId ? String(input.connectorId) : undefined;
        if (!connId) {
          const active = await service.getActiveCalendarConnector();
          if (!active) {
            return {
              healthy: false,
              status: 'disconnected',
              latencyMs: 0,
              message: 'No active calendar connector configured for this tenant.',
            };
          }
          connId = active.id;
        }

        const health = await service.testConnector(String(connId));
        return {
          connectorId: connId,
          healthy: health.healthy,
          status: health.status,
          latencyMs: health.latencyMs,
          message: health.message,
        };
      },
      verify: async (_input, output) => ({
        state: 'verified',
        observed: { connectorId: output.connectorId, status: output.status },
      }),
    },
    {
      definition: def(
        'calendar_get_availability',
        'Query External Calendar Availability',
        'Inspects external calendar busy/free time intervals directly from Google Calendar.',
        'LOW'
      ),
      inputValidator: z.object({
        connectorId: z.string().optional(),
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        timeZone: z.string().default('Asia/Kolkata'),
      }),
      handler: async (input) => {
        const connId = input.connectorId ? String(input.connectorId) : undefined;
        const cal = await service.getActiveCalendarConnector(connId);
        if (!cal) {
          throw new NotFoundError('No active calendar connector found for this tenant.');
        }

        const busySlots = await cal.getAvailability({
          startDate: String(input.startDate),
          endDate: String(input.endDate),
          timeZone: String(input.timeZone ?? 'Asia/Kolkata'),
        });

        return {
          connectorId: cal.id,
          startDate: input.startDate,
          endDate: input.endDate,
          busySlotCount: busySlots.length,
          busySlots,
        };
      },
      verify: async (_input, output) => ({
        state: 'verified',
        observed: { busySlotCount: output.busySlotCount },
      }),
    },
    {
      definition: def(
        'calendar_sync_event',
        'Sync Appointment to External Calendar',
        'Synchronizes a confirmed appointment from the local appointment book to an external calendar.',
        'MEDIUM'
      ),
      inputValidator: z.object({
        appointmentId: z.string().min(1),
        customerRef: z.string().min(1),
        connectorId: z.string().optional(),
      }),
      handler: async (input, ctx) => {
        if (!ctx.idempotencyKey) throw new ValidationError('calendar_sync_event needs an idempotency key.');
        const appointmentId = String(input.appointmentId);
        const customerRef = String(input.customerRef);
        const connectorId = input.connectorId ? String(input.connectorId) : undefined;

        const apt = await book.get(appointmentId);
        if (!apt || apt.customer_ref !== customerRef) {
          throw new NotFoundError(`No appointment '${appointmentId}' for this customer.`);
        }
        if (apt.status !== 'confirmed') {
          throw new ValidationError(`Appointment '${apt.id}' is ${apt.status}; only confirmed appointments can be synced.`);
        }

        const cal = await service.getActiveCalendarConnector(connectorId);
        if (!cal) {
          throw new NotFoundError('No active calendar connector configured for this tenant.');
        }

        const resource = await book.resource(apt.resource_id);
        const tz = resource?.timezone ?? 'Asia/Kolkata';

        const calEvent = await cal.confirmBooking({
          startsAt: apt.starts_at,
          endsAt: apt.ends_at,
          summary: `Appointment with ${resource?.name ?? 'Specialist'} - ${apt.customer_name ?? apt.customer_ref}`,
          description: `Kriya AI booking reference ${apt.id}`,
          attendeeName: apt.customer_name ?? undefined,
          timeZone: tz,
        });

        // Update appointment with external event ID
        const client = deps.client ?? (book as any).client;
        await client.execute(
          'UPDATE appointments SET external_event_id = ? WHERE id = ?',
          [calEvent.id, apt.id]
        );

        return {
          appointmentId: apt.id,
          externalEventId: calEvent.id,
          status: 'synced',
          startsAt: calEvent.startsAt,
          endsAt: calEvent.endsAt,
          htmlLink: calEvent.htmlLink,
        };
      },
      verify: async (input, output) => {
        const connectorId = input.connectorId ? String(input.connectorId) : undefined;
        const cal = await service.getActiveCalendarConnector(connectorId);
        if (!cal) return { state: 'mismatch', observed: { reason: 'Connector inactive' } };

        const event = await cal.getEvent(String(output.externalEventId));
        return event && event.status === 'confirmed'
          ? { state: 'verified', observed: { eventId: event.id, status: event.status } }
          : { state: 'mismatch', observed: { eventId: output.externalEventId, found: Boolean(event) } };
      },
      compensate: async (input, output) => {
        const connectorId = input.connectorId ? String(input.connectorId) : undefined;
        const cal = await service.getActiveCalendarConnector(connectorId);
        if (cal && output.externalEventId) {
          await cal.cancelEvent(String(output.externalEventId), 'saga compensation');
        }
      },
    },
  ];
}
