/**
 * Kriya Omnitask — Appointment book (docs/kriya WP-4.3; decision D8)
 *
 * A real system of record for tenants without an external calendar: resources (doctors, rooms) with
 * working hours, and appointments. The database makes double-booking impossible (partial unique index);
 * booking is idempotent on the run's idempotency key; every write can be read back (verify) and a booking
 * can be undone (compensate). External calendars (WP-5.4) plug in behind the same tools later.
 *
 * Times are local "YYYY-MM-DD HH:MM" in the resource's IANA timezone.
 * ponytail: no slot holds yet — book is a single atomic confirm. Add hold → confirm when a step (payment,
 * approval) sits between choosing and confirming (WP-4.4).
 */

import { z } from 'zod';
import { DatabaseClient, db } from '../storage/db.js';
import { TenantContextManager } from '../core/context/tenantContext.js';
import { CryptoUtils } from '../core/utils/crypto.js';
import { ConflictError, NotFoundError, ValidationError } from '../core/errors/errors.js';
import { logger } from '../core/logger/logger.js';
import type { CalendarConnector } from '../connectors/types/connectorTypes.js';
import type { RegisteredTool } from '../tools/registry/toolRegistry.js';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

export const WorkingHoursSchema = z.record(
  z.enum(DAYS),
  z.array(z.tuple([z.string().regex(HHMM), z.string().regex(HHMM)]).refine(([a, b]) => a < b, 'range must end after it starts'))
);

export const CreateResourceSchema = z.object({
  name: z.string().min(1).max(120),
  kind: z.enum(['doctor', 'room', 'staff', 'equipment']).default('doctor'),
  department: z.string().max(120).optional(),
  timezone: z
    .string()
    .default('Asia/Kolkata')
    .refine((tz) => {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, 'unknown timezone'),
  slotMinutes: z.number().int().min(5).max(480).default(30),
  workingHours: WorkingHoursSchema,
});
export type CreateResourceInput = z.input<typeof CreateResourceSchema>;

export interface ResourceRecord {
  id: string;
  tenant_id: string;
  name: string;
  kind: string;
  department: string | null;
  timezone: string;
  slot_minutes: number;
  working_hours_json: string;
  active: number;
}

export interface AppointmentRecord {
  id: string;
  tenant_id: string;
  resource_id: string;
  customer_ref: string;
  customer_name: string | null;
  starts_at: string;
  ends_at: string;
  status: 'confirmed' | 'cancelled';
  idempotency_key: string;
  cancelled_reason: string | null;
  fee_amount?: number;
  is_prepaid?: number;
  external_event_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface SlotHoldRecord {
  id: string;
  tenant_id: string;
  resource_id: string;
  starts_at: string;
  ends_at: string;
  customer_ref: string;
  customer_name: string | null;
  fee_amount: number;
  status: 'active' | 'released' | 'converted' | 'expired';
  expires_at: string;
  appointment_id: string | null;
  idempotency_key: string;
  external_hold_ref?: string | null;
  created_at: string;
  updated_at: string;
}

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const toHHMM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** Current local time in a timezone as "YYYY-MM-DD HH:MM". */
export function localNow(timezone: string, now = new Date()): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(now)
      .map((x) => [x.type, x.value])
  );
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

/** "Dr. Rao" / "doctor rao" / "डॉ. राव" → "rao"-style comparison key (title words in any script dropped). */
function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/^\s*(dr\.?|doctor|डॉ\.?|डॉक्टर|డాక్టర్|டாக்டர்|டாக்டர்\.)\s*/u, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Business limits on booking (code, not prompt — an injected "book all slots" must not work).
 * ponytail: fixed defaults; make them tenant policy when a business needs different ones.
 */
export const BOOKING_LIMITS = { perResourcePerDay: 1, upcomingPerCustomer: 5 } as const;

function parseLocal(start: string): { date: string; time: string } {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})$/.exec(start.trim());
  if (!m || Number.isNaN(Date.parse(`${m[1]}T00:00:00Z`))) throw new ValidationError(`'${start}' is not a local time "YYYY-MM-DD HH:MM".`);
  return { date: m[1], time: m[2] };
}

function localHhmm(isoString: string, timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(isoString));
    const h = parts.find((p) => p.type === 'hour')?.value ?? '00';
    const m = parts.find((p) => p.type === 'minute')?.value ?? '00';
    return `${h}:${m}`;
  } catch {
    return '00:00';
  }
}

export class AppointmentBook {
  constructor(
    private readonly customClient?: DatabaseClient,
    private readonly calendarConnector?: CalendarConnector
  ) {}

  private get client(): DatabaseClient {
    return this.customClient ?? db.getClient();
  }

  private tenant(): string {
    return TenantContextManager.getTenantId();
  }

  public async createResource(input: CreateResourceInput): Promise<ResourceRecord> {
    const r = CreateResourceSchema.parse(input);
    const id = `res_${CryptoUtils.generateId()}`;
    const now = new Date().toISOString();
    await this.client.execute(
      `INSERT INTO schedule_resources (id, tenant_id, name, kind, department, timezone, slot_minutes, working_hours_json, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      [id, this.tenant(), r.name, r.kind, r.department ?? null, r.timezone, r.slotMinutes, JSON.stringify(r.workingHours), now, now]
    );
    return (await this.resource(id))!;
  }

  public async resource(id: string): Promise<ResourceRecord | null> {
    return this.client.queryOne<ResourceRecord>('SELECT * FROM schedule_resources WHERE id = ? AND tenant_id = ?', [id, this.tenant()]);
  }

  /** Slot start times a resource works on a date (before removing booked/past ones). */
  private workingSlots(r: ResourceRecord, date: string): string[] {
    const hours = JSON.parse(r.working_hours_json) as Record<string, Array<[string, string]>>;
    const day = DAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
    const slots: string[] = [];
    for (const [from, to] of hours[day] ?? []) {
      for (let t = toMin(from); t + r.slot_minutes <= toMin(to); t += r.slot_minutes) slots.push(toHHMM(t));
    }
    return slots;
  }

  /** Free slots on a date, from the system of record. Filters match name / department loosely, case-insensitively. */
  public async availability(date: string, filter: { resourceId?: string; doctor?: string; department?: string } = {}) {
    parseLocal(`${date} 00:00`);
    const doctor = filter.doctor ? normaliseName(filter.doctor) : '';
    const dept = filter.department?.trim().toLowerCase() ?? '';
    const resources = (await this.client.query<ResourceRecord>('SELECT * FROM schedule_resources WHERE tenant_id = ? AND active = 1 ORDER BY name', [this.tenant()])).filter((r) => {
      const name = normaliseName(r.name);
      const rd = (r.department ?? '').toLowerCase();
      return (
        (!filter.resourceId || r.id === filter.resourceId) &&
        (!doctor || name.includes(doctor) || doctor.includes(name)) &&
        (!dept || (rd !== '' && (rd.includes(dept) || dept.includes(rd))))
      );
    });
    const out = [];
    for (const r of resources) {
      const takenAppts = (
        await this.client.query<{ starts_at: string }>(
          "SELECT starts_at FROM appointments WHERE tenant_id = ? AND resource_id = ? AND status = 'confirmed' AND starts_at LIKE ?",
          [this.tenant(), r.id, `${date} %`]
        )
      ).map((a) => a.starts_at);
      const nowIso = new Date().toISOString();
      const takenHolds = (
        await this.client.query<{ starts_at: string }>(
          "SELECT starts_at FROM slot_holds WHERE tenant_id = ? AND resource_id = ? AND status = 'active' AND expires_at > ? AND starts_at LIKE ?",
          [this.tenant(), r.id, nowIso, `${date} %`]
        )
      ).map((h) => h.starts_at);

      const externalBusyTimes = new Set<string>();
      if (this.calendarConnector) {
        try {
          const busySlots = await this.calendarConnector.getAvailability({
            startDate: date,
            endDate: date,
            timeZone: r.timezone,
          });
          for (const slot of busySlots) {
            const startHhmm = localHhmm(slot.start, r.timezone);
            const endHhmm = localHhmm(slot.end, r.timezone);
            const startM = toMin(startHhmm);
            const endM = toMin(endHhmm);
            for (let t = startM; t < endM; t += r.slot_minutes) {
              externalBusyTimes.add(`${date} ${toHHMM(t)}`);
            }
          }
        } catch (err) {
          logger.warn(`Failed to fetch external calendar availability for resource '${r.id}':`, { err });
        }
      }

      const taken = new Set([...takenAppts, ...takenHolds, ...externalBusyTimes]);
      const now = localNow(r.timezone);
      const free = this.workingSlots(r, date).filter((t) => !taken.has(`${date} ${t}`) && `${date} ${t}` > now);
      out.push({ resourceId: r.id, name: r.name, department: r.department, freeSlots: free });
    }
    return out;
  }

  /**
   * Books a slot. Idempotent on `idempotencyKey` (a resumed run gets the same appointment back).
   * Refuses: unknown resource, outside working hours, misaligned, in the past, already taken.
   */
  public async book(p: {
    resourceId: string;
    start: string;
    customerRef: string;
    customerName?: string;
    idempotencyKey: string;
    replacing?: string;
    feeAmount?: number;
    isPrepaid?: boolean;
  }): Promise<AppointmentRecord> {
    const tenantId = this.tenant();
    const existing = await this.client.queryOne<AppointmentRecord>('SELECT * FROM appointments WHERE tenant_id = ? AND idempotency_key = ?', [tenantId, p.idempotencyKey]);
    if (existing) return existing;

    const r = await this.resource(p.resourceId);
    if (!r || !r.active) throw new NotFoundError(`No active resource '${p.resourceId}'.`);
    const { date, time } = parseLocal(p.start);
    if (!this.workingSlots(r, date).includes(time)) throw new ValidationError(`${r.name} does not work a slot starting at ${date} ${time}.`);
    if (`${date} ${time}` <= localNow(r.timezone)) throw new ValidationError(`${date} ${time} is in the past.`);

    const mine = (await this.upcomingFor(p.customerRef)).filter((a) => a.id !== p.replacing);
    const sameDay = mine.filter((a) => a.resource_id === r.id && a.starts_at.startsWith(date)).length;
    if (sameDay >= BOOKING_LIMITS.perResourcePerDay) throw new ConflictError(`The customer already has an appointment with ${r.name} on ${date}; reschedule it instead of booking another.`);
    if (mine.length >= BOOKING_LIMITS.upcomingPerCustomer) throw new ConflictError(`The customer already has ${mine.length} upcoming appointments (limit ${BOOKING_LIMITS.upcomingPerCustomer}).`);

    const id = `apt_${CryptoUtils.generateId()}`;
    const now = new Date().toISOString();
    const fee = p.feeAmount !== undefined ? p.feeAmount : 500.0;
    const prepaid = p.isPrepaid !== undefined ? (p.isPrepaid ? 1 : 0) : 1;
    let externalEventId: string | null = null;

    if (this.calendarConnector) {
      try {
        const calEvent = await this.calendarConnector.confirmBooking({
          startsAt: `${date} ${time}`,
          endsAt: `${date} ${toHHMM(toMin(time) + r.slot_minutes)}`,
          summary: `Appointment with ${r.name} - ${p.customerName ?? p.customerRef}`,
          description: `Kriya AI booking reference ${id}`,
          attendeeName: p.customerName,
          holdRef: (p as any).holdRef,
          timeZone: r.timezone,
        });
        externalEventId = calEvent.id;
      } catch (err) {
        logger.warn(`Could not sync appointment '${id}' to external calendar:`, { err });
      }
    }

    try {
      await this.client.execute(
        `INSERT INTO appointments (id, tenant_id, resource_id, customer_ref, customer_name, starts_at, ends_at, status, idempotency_key, fee_amount, is_prepaid, external_event_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?, ?, ?, ?)`,
        [id, tenantId, r.id, p.customerRef, p.customerName ?? null, `${date} ${time}`, `${date} ${toHHMM(toMin(time) + r.slot_minutes)}`, p.idempotencyKey, fee, prepaid, externalEventId, now, now]
      );
    } catch (err) {
      if (/unique/i.test(err instanceof Error ? err.message : String(err))) throw new ConflictError(`${r.name} at ${date} ${time} was just booked by someone else.`);
      throw err;
    }
    return (await this.get(id))!;
  }

  /** Moves a customer's own appointment: books the new slot and cancels the old one in ONE transaction. Idempotent. */
  public async reschedule(p: { appointmentId: string; customerRef: string; newStart: string; resourceId?: string; idempotencyKey: string }): Promise<{ from: AppointmentRecord; to: AppointmentRecord }> {
    return this.client.transaction(async (tx) => {
      const old = await tx.queryOne<AppointmentRecord>(
        'SELECT * FROM appointments WHERE id = ? AND tenant_id = ? FOR UPDATE',
        [p.appointmentId, this.tenant()]
      );
      if (!old || old.customer_ref !== p.customerRef) throw new NotFoundError(`No appointment '${p.appointmentId}' for this customer.`);
      const done = await tx.queryOne<AppointmentRecord>('SELECT * FROM appointments WHERE tenant_id = ? AND idempotency_key = ?', [this.tenant(), p.idempotencyKey]);
      if (done) return { from: (await this.get(old.id))!, to: done };
      if (old.status !== 'confirmed') throw new ValidationError(`Appointment '${old.id}' is ${old.status}; only confirmed appointments can be moved.`);
      const to = await this.book({ resourceId: p.resourceId ?? old.resource_id, start: p.newStart, customerRef: p.customerRef, customerName: old.customer_name ?? undefined, idempotencyKey: p.idempotencyKey, replacing: old.id });
      const from = await this.cancel({ appointmentId: old.id, customerRef: p.customerRef, reason: `rescheduled to ${to.starts_at}` });
      return { from, to };
    });
  }

  /** Cancels a customer's own appointment. Someone else's appointment is "not found" (no disclosure). */
  public async cancel(p: { appointmentId: string; customerRef: string; reason: string }): Promise<AppointmentRecord> {
    return this.client.transaction(async (tx) => {
      const a = await tx.queryOne<AppointmentRecord>(
        'SELECT * FROM appointments WHERE id = ? AND tenant_id = ? FOR UPDATE',
        [p.appointmentId, this.tenant()]
      );
      if (!a || a.customer_ref !== p.customerRef) throw new NotFoundError(`No appointment '${p.appointmentId}' for this customer.`);
      if (a.status === 'cancelled') return a;
      await tx.execute("UPDATE appointments SET status = 'cancelled', cancelled_reason = ?, updated_at = ? WHERE id = ? AND tenant_id = ?", [p.reason, new Date().toISOString(), a.id, this.tenant()]);
      if (this.calendarConnector && a.external_event_id) {
        try {
          await this.calendarConnector.cancelEvent(a.external_event_id, p.reason);
        } catch (err) {
          logger.warn(`Could not delete external calendar event '${a.external_event_id}':`, { err });
        }
      }
      return (await this.get(a.id))!;
    });
  }

  /** Re-confirms a cancelled appointment (compensation). The unique slot index refuses it if the slot was retaken. */
  public async restore(p: { appointmentId: string; customerRef: string }): Promise<AppointmentRecord> {
    return this.client.transaction(async (tx) => {
      const a = await tx.queryOne<AppointmentRecord>(
        'SELECT * FROM appointments WHERE id = ? AND tenant_id = ? FOR UPDATE',
        [p.appointmentId, this.tenant()]
      );
      if (!a || a.customer_ref !== p.customerRef) throw new NotFoundError(`No appointment '${p.appointmentId}' for this customer.`);
      if (a.status === 'confirmed') return a;
      try {
        await tx.execute("UPDATE appointments SET status = 'confirmed', cancelled_reason = NULL, updated_at = ? WHERE id = ? AND tenant_id = ?", [new Date().toISOString(), a.id, this.tenant()]);
      } catch (err) {
        if (/unique/i.test(err instanceof Error ? err.message : String(err))) throw new ConflictError(`Cannot restore ${a.starts_at}: the slot was booked by someone else.`);
        throw err;
      }
      return (await this.get(a.id))!;
    });
  }

  public async upcomingFor(customerRef: string): Promise<Array<AppointmentRecord & { resource_name: string }>> {
    return this.client.query(
      `SELECT a.*, r.name AS resource_name FROM appointments a JOIN schedule_resources r ON r.id = a.resource_id
       WHERE a.tenant_id = ? AND a.customer_ref = ? AND a.status = 'confirmed' ORDER BY a.starts_at`,
      [this.tenant(), customerRef]
    );
  }

  /**
   * Queries confirmed appointments for a staff or doctor resource within an optional time range.
   */
  public async forResource(resourceId: string, from?: string, to?: string): Promise<AppointmentRecord[]> {
    let sql = "SELECT * FROM appointments WHERE tenant_id = ? AND resource_id = ? AND status = 'confirmed'";
    const params: unknown[] = [this.tenant(), resourceId];
    if (from) {
      sql += ' AND starts_at >= ?';
      params.push(from);
    }
    if (to) {
      sql += ' AND starts_at <= ?';
      params.push(to);
    }
    sql += ' ORDER BY starts_at ASC';
    return this.client.query<AppointmentRecord>(sql, params);
  }

  public async get(id: string): Promise<AppointmentRecord | null> {
    return this.client.queryOne<AppointmentRecord>('SELECT * FROM appointments WHERE id = ? AND tenant_id = ?', [id, this.tenant()]);
  }

  public async holdSlot(p: {
    resourceId: string;
    start: string;
    customerRef: string;
    customerName?: string;
    holdMinutes?: number;
    feeAmount?: number;
    idempotencyKey: string;
  }): Promise<SlotHoldRecord> {
    const tenantId = this.tenant();
    const existing = await this.client.queryOne<SlotHoldRecord>(
      'SELECT * FROM slot_holds WHERE tenant_id = ? AND idempotency_key = ?',
      [tenantId, p.idempotencyKey]
    );
    if (existing) return existing;

    const r = await this.resource(p.resourceId);
    if (!r || !r.active) throw new NotFoundError(`No active resource '${p.resourceId}'.`);
    const { date, time } = parseLocal(p.start);
    if (!this.workingSlots(r, date).includes(time)) {
      throw new ValidationError(`${r.name} does not work a slot starting at ${date} ${time}.`);
    }
    if (`${date} ${time}` <= localNow(r.timezone)) {
      throw new ValidationError(`${date} ${time} is in the past.`);
    }

    return this.client.transaction(async (tx) => {
      const existingApt = await tx.queryOne<AppointmentRecord>(
        "SELECT * FROM appointments WHERE tenant_id = ? AND resource_id = ? AND starts_at = ? AND status = 'confirmed'",
        [tenantId, r.id, `${date} ${time}`]
      );
      if (existingApt) {
        throw new ConflictError(`${r.name} at ${date} ${time} is already booked.`);
      }

      const nowIso = new Date().toISOString();
      const existingHold = await tx.queryOne<SlotHoldRecord>(
        "SELECT * FROM slot_holds WHERE tenant_id = ? AND resource_id = ? AND starts_at = ? AND status = 'active' AND expires_at > ?",
        [tenantId, r.id, `${date} ${time}`, nowIso]
      );
      if (existingHold && existingHold.customer_ref !== p.customerRef) {
        throw new ConflictError(`${r.name} at ${date} ${time} is currently held by another customer.`);
      }

      const id = `shold_${CryptoUtils.generateId()}`;
      const duration = p.holdMinutes ?? 15;
      const expiresAt = new Date(Date.now() + duration * 60 * 1000).toISOString();
      const endsAt = `${date} ${toHHMM(toMin(time) + r.slot_minutes)}`;
      const fee = p.feeAmount ?? 500.0;
      let externalHoldRef: string | null = null;

      if (this.calendarConnector) {
        try {
          const calHold = await this.calendarConnector.holdSlot({
            startsAt: `${date} ${time}`,
            endsAt,
            summary: `Hold for ${r.name}`,
            holdId: id,
            expiresInMinutes: duration,
            timeZone: r.timezone,
          });
          externalHoldRef = calHold.holdRef;
        } catch (err) {
          logger.warn(`Could not create external calendar hold for '${id}':`, { err });
        }
      }

      await tx.execute(
        `INSERT INTO slot_holds (
          id, tenant_id, resource_id, starts_at, ends_at, customer_ref, customer_name,
          fee_amount, status, expires_at, appointment_id, idempotency_key, external_hold_ref, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, NULL, ?, ?, ?, ?)`,
        [
          id,
          tenantId,
          r.id,
          `${date} ${time}`,
          endsAt,
          p.customerRef,
          p.customerName ?? null,
          fee,
          expiresAt,
          p.idempotencyKey,
          externalHoldRef,
          nowIso,
          nowIso,
        ]
      );

      return (await this.getSlotHold(id))!;
    });
  }

  public async getSlotHold(id: string): Promise<SlotHoldRecord | null> {
    return this.client.queryOne<SlotHoldRecord>(
      'SELECT * FROM slot_holds WHERE id = ? AND tenant_id = ?',
      [id, this.tenant()]
    );
  }

  public async confirmHold(p: {
    holdId: string;
    customerRef: string;
    idempotencyKey: string;
  }): Promise<AppointmentRecord> {
    const tenantId = this.tenant();
    return this.client.transaction(async (tx) => {
      const hold = await tx.queryOne<SlotHoldRecord>(
        'SELECT * FROM slot_holds WHERE id = ? AND tenant_id = ? FOR UPDATE',
        [p.holdId, tenantId]
      );
      if (!hold || hold.customer_ref !== p.customerRef) {
        throw new NotFoundError(`No slot hold '${p.holdId}' for this customer.`);
      }
      if (hold.status === 'converted' && hold.appointment_id) {
        const apt = await this.get(hold.appointment_id);
        if (apt) return apt;
      }
      if (hold.status !== 'active') {
        throw new ConflictError(`Slot hold '${p.holdId}' is ${hold.status}; cannot be confirmed.`);
      }
      const nowIso = new Date().toISOString();
      if (hold.expires_at <= nowIso) {
        await tx.execute("UPDATE slot_holds SET status = 'expired', updated_at = ? WHERE id = ? AND tenant_id = ?", [nowIso, hold.id, tenantId]);
        throw new ConflictError(`Slot hold '${p.holdId}' has expired.`);
      }

      const apt = await this.book({
        resourceId: hold.resource_id,
        start: hold.starts_at,
        customerRef: hold.customer_ref,
        customerName: hold.customer_name ?? undefined,
        feeAmount: hold.fee_amount,
        isPrepaid: true,
        idempotencyKey: p.idempotencyKey,
        ...(hold.external_hold_ref ? { holdRef: hold.external_hold_ref } : {}),
      } as any);

      await tx.execute(
        "UPDATE slot_holds SET status = 'converted', appointment_id = ?, updated_at = ? WHERE id = ? AND tenant_id = ?",
        [apt.id, nowIso, hold.id, tenantId]
      );

      return apt;
    });
  }

  public async releaseHold(p: {
    holdId: string;
    customerRef: string;
    reason?: string;
  }): Promise<SlotHoldRecord> {
    const tenantId = this.tenant();
    return this.client.transaction(async (tx) => {
      const hold = await tx.queryOne<SlotHoldRecord>(
        'SELECT * FROM slot_holds WHERE id = ? AND tenant_id = ? FOR UPDATE',
        [p.holdId, tenantId]
      );
      if (!hold || hold.customer_ref !== p.customerRef) {
        throw new NotFoundError(`No slot hold '${p.holdId}' for this customer.`);
      }
      if (hold.status === 'released') return hold;
      if (hold.status === 'converted') {
        throw new ConflictError(`Cannot release slot hold '${p.holdId}' because it was already confirmed.`);
      }

      const nowIso = new Date().toISOString();
      await tx.execute(
        "UPDATE slot_holds SET status = 'released', updated_at = ? WHERE id = ? AND tenant_id = ?",
        [nowIso, hold.id, tenantId]
      );

      if (this.calendarConnector && hold.external_hold_ref) {
        try {
          await this.calendarConnector.cancelEvent(hold.external_hold_ref, p.reason);
        } catch (err) {
          logger.warn(`Could not release external calendar hold '${hold.external_hold_ref}':`, { err });
        }
      }

      return (await this.getSlotHold(hold.id))!;
    });
  }
}

/** The Scheduling agent's tools. `customerRef` is bound by code from the run (never chosen by the model). */
export function schedulingTools(
  bookOrClient?: (() => AppointmentBook) | DatabaseClient | AppointmentBook,
  calendarConnector?: CalendarConnector
): RegisteredTool[] {
  const book: () => AppointmentBook =
    typeof bookOrClient === 'function'
      ? bookOrClient
      : bookOrClient && 'query' in bookOrClient && typeof (bookOrClient as any).query === 'function'
      ? () => new AppointmentBook(bookOrClient as DatabaseClient, calendarConnector)
      : bookOrClient instanceof AppointmentBook
      ? () => bookOrClient
      : () => new AppointmentBook(undefined, calendarConnector);

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
      definition: def('schedule_find_slots', 'Find free slots', 'Free appointment slots on a date, from the appointment book.', 'LOW'),
      inputValidator: z.object({ date: z.string(), doctor: z.string().optional(), department: z.string().optional() }),
      handler: async (input) => {
        const filter = { doctor: input.doctor as string | undefined, department: input.department as string | undefined };
        const resources = await book().availability(String(input.date), filter);
        if (resources.length > 0 || (!filter.doctor && !filter.department)) return { date: input.date, resources };
        // Names arrive in many scripts ("డాక్టర్ రావు"); rather than claim "nothing free", show every resource and say so.
        return {
          date: input.date,
          note: `No resource matched ${JSON.stringify(filter)}; showing all resources. Pick the one the customer meant, or ask.`,
          resources: await book().availability(String(input.date)),
        };
      },
      // A read IS the observation of the system of record.
      verify: async (_i, output) => ({ state: 'verified', observed: { resources: (output.resources as unknown[]).length } }),
    },
    {
      definition: def('schedule_my_appointments', 'My appointments', "The customer's upcoming confirmed appointments.", 'LOW'),
      inputValidator: z.object({ customerRef: z.string().min(1) }),
      handler: async (input) => ({
        appointments: (await book().upcomingFor(String(input.customerRef))).map((a) => ({ appointmentId: a.id, with: a.resource_name, start: a.starts_at })),
      }),
      verify: async () => ({ state: 'verified' }),
    },
    {
      definition: def('schedule_resource_appointments', 'Resource appointments', "Lists confirmed appointments for a staff or doctor resource within a date/time range.", 'LOW'),
      inputValidator: z.object({ resourceId: z.string().min(1), from: z.string().optional(), to: z.string().optional() }),
      handler: async (input) => {
        const appts = await book().forResource(String(input.resourceId), input.from as string | undefined, input.to as string | undefined);
        return {
          resourceId: input.resourceId,
          from: input.from,
          to: input.to,
          count: appts.length,
          appointments: appts.map((a) => ({
            appointmentId: a.id,
            customerRef: a.customer_ref,
            customerName: a.customer_name,
            startsAt: a.starts_at,
            endsAt: a.ends_at,
            feeAmount: a.fee_amount ?? 500,
            isPrepaid: Boolean(a.is_prepaid ?? 1),
            status: a.status,
          })),
        };
      },
      verify: async (_i, output) => ({
        state: 'verified',
        observed: { resourceId: output.resourceId, count: output.count },
      }),
    },
    {
      definition: def('schedule_book', 'Book appointment', 'Books a free slot for the customer in the appointment book.', 'MEDIUM'),
      inputValidator: z.object({
        resourceId: z.string().min(1),
        start: z.string().min(1),
        customerRef: z.string().min(1),
        customerName: z.string().optional(),
        feeAmount: z.number().nonnegative().optional(),
        isPrepaid: z.boolean().optional(),
      }),
      handler: async (input, ctx) => {
        if (!ctx.idempotencyKey) throw new ValidationError('schedule_book needs an idempotency key.');
        const a = await book().book({
          resourceId: String(input.resourceId),
          start: String(input.start),
          customerRef: String(input.customerRef),
          customerName: input.customerName as string | undefined,
          feeAmount: typeof input.feeAmount === 'number' ? input.feeAmount : undefined,
          isPrepaid: typeof input.isPrepaid === 'boolean' ? input.isPrepaid : undefined,
          idempotencyKey: ctx.idempotencyKey,
        });
        return { appointmentId: a.id, start: a.starts_at, resourceId: a.resource_id, status: a.status, feeAmount: a.fee_amount ?? 500, isPrepaid: Boolean(a.is_prepaid ?? 1) };
      },
      verify: async (input, output) => {
        const a = await book().get(String(output.appointmentId));
        return a && a.status === 'confirmed' && a.resource_id === input.resourceId && a.customer_ref === input.customerRef
          ? { state: 'verified', observed: { appointmentId: a.id, start: a.starts_at, status: a.status } }
          : { state: 'mismatch', observed: { found: !!a, status: a?.status } };
      },
      compensate: async (input, output) => {
        await book().cancel({ appointmentId: String(output.appointmentId), customerRef: String(input.customerRef), reason: 'compensated: a later step failed' });
      },
    },
    {
      definition: def('schedule_reschedule', 'Reschedule appointment', "Moves one of the customer's appointments to a new free slot (atomic).", 'MEDIUM'),
      inputValidator: z.object({ appointmentId: z.string().min(1), newStart: z.string().min(1), resourceId: z.string().optional(), customerRef: z.string().min(1) }),
      handler: async (input, ctx) => {
        if (!ctx.idempotencyKey) throw new ValidationError('schedule_reschedule needs an idempotency key.');
        const { from, to } = await book().reschedule({
          appointmentId: String(input.appointmentId),
          newStart: String(input.newStart),
          resourceId: input.resourceId as string | undefined,
          customerRef: String(input.customerRef),
          idempotencyKey: ctx.idempotencyKey,
        });
        return { appointmentId: to.id, start: to.starts_at, previousAppointmentId: from.id, status: to.status };
      },
      verify: async (_i, output) => {
        const [to, from] = [await book().get(String(output.appointmentId)), await book().get(String(output.previousAppointmentId))];
        return to?.status === 'confirmed' && from?.status === 'cancelled'
          ? { state: 'verified', observed: { appointmentId: to.id, start: to.starts_at, previous: 'cancelled' } }
          : { state: 'mismatch', observed: { new: to?.status, previous: from?.status } };
      },
      compensate: async (input, output) => {
        // Undo: cancel the new slot and restore the old one. If the old slot was taken meanwhile, restore throws and
        // the run reports it as not undone — never a silent double-booking.
        await book().cancel({ appointmentId: String(output.appointmentId), customerRef: String(input.customerRef), reason: 'compensated: a later step failed' });
        await book().restore({ appointmentId: String(output.previousAppointmentId), customerRef: String(input.customerRef) });
      },
    },
    {
      definition: def('schedule_cancel', 'Cancel appointment', "Cancels one of the customer's own appointments.", 'MEDIUM'),
      inputValidator: z.object({ appointmentId: z.string().min(1), customerRef: z.string().min(1), reason: z.string().default('customer request') }),
      handler: async (input) => {
        const a = await book().cancel({ appointmentId: String(input.appointmentId), customerRef: String(input.customerRef), reason: String(input.reason ?? 'customer request') });
        return { appointmentId: a.id, status: a.status };
      },
      verify: async (_i, output) => {
        const a = await book().get(String(output.appointmentId));
        return a?.status === 'cancelled' ? { state: 'verified', observed: { appointmentId: a.id, status: a.status } } : { state: 'mismatch', observed: { status: a?.status } };
      },
    },
    {
      definition: def('schedule_hold_slot', 'Hold slot', 'Places a temporary reservation hold on an appointment slot for prepayment or approval.', 'MEDIUM'),
      inputValidator: z.object({
        resourceId: z.string().min(1),
        start: z.string().min(1),
        customerRef: z.string().min(1),
        customerName: z.string().optional(),
        holdMinutes: z.number().int().min(1).max(120).optional(),
        feeAmount: z.number().nonnegative().optional(),
      }),
      handler: async (input, ctx) => {
        if (!ctx.idempotencyKey) throw new ValidationError('schedule_hold_slot needs an idempotency key.');
        const hold = await book().holdSlot({
          resourceId: String(input.resourceId),
          start: String(input.start),
          customerRef: String(input.customerRef),
          customerName: input.customerName as string | undefined,
          holdMinutes: typeof input.holdMinutes === 'number' ? input.holdMinutes : undefined,
          feeAmount: typeof input.feeAmount === 'number' ? input.feeAmount : undefined,
          idempotencyKey: ctx.idempotencyKey,
        });
        return {
          holdId: hold.id,
          start: hold.starts_at,
          resourceId: hold.resource_id,
          expiresAt: hold.expires_at,
          feeAmount: hold.fee_amount,
          status: hold.status,
        };
      },
      verify: async (input, output) => {
        const hold = await book().getSlotHold(String(output.holdId));
        return hold && hold.status === 'active' && hold.customer_ref === input.customerRef
          ? { state: 'verified', observed: { holdId: hold.id, status: hold.status, expiresAt: hold.expires_at } }
          : { state: 'mismatch', observed: { found: !!hold, status: hold?.status } };
      },
      compensate: async (input, output) => {
        await book().releaseHold({ holdId: String(output.holdId), customerRef: String(input.customerRef), reason: 'compensated: a later step failed' });
      },
    },
    {
      definition: def('schedule_confirm_hold', 'Confirm held slot', 'Converts a temporary reservation hold into a confirmed appointment after payment.', 'MEDIUM'),
      inputValidator: z.object({
        holdId: z.string().min(1),
        customerRef: z.string().min(1),
      }),
      handler: async (input, ctx) => {
        if (!ctx.idempotencyKey) throw new ValidationError('schedule_confirm_hold needs an idempotency key.');
        const apt = await book().confirmHold({
          holdId: String(input.holdId),
          customerRef: String(input.customerRef),
          idempotencyKey: ctx.idempotencyKey,
        });
        return {
          appointmentId: apt.id,
          start: apt.starts_at,
          resourceId: apt.resource_id,
          status: apt.status,
          holdId: input.holdId,
        };
      },
      verify: async (input, output) => {
        const apt = await book().get(String(output.appointmentId));
        return apt && apt.status === 'confirmed' && apt.customer_ref === input.customerRef
          ? { state: 'verified', observed: { appointmentId: apt.id, start: apt.starts_at, status: apt.status } }
          : { state: 'mismatch', observed: { found: !!apt, status: apt?.status } };
      },
      compensate: async (input, output) => {
        await book().cancel({ appointmentId: String(output.appointmentId), customerRef: String(input.customerRef), reason: 'compensated: a later step failed' });
      },
    },
  ];
}
