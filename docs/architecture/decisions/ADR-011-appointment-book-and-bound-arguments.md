# ADR-011 — Kriya appointment book as a system of record; code-bound tool arguments

**Status:** Accepted · 2026-10-01 · Session 08 (WP-4.3, decision D8)

## Context
The Scheduling agent must verify every booking by reading it back from the system of record (02 §1).
The existing `calendar_*` tools were stateless sandbox stubs: fixed slots, invented ids, nothing to read back.
WP-5.4 (external calendar connectors) is not built yet. Many small clinics have no calendar system at all.

## Decision
1. **Kriya's own appointment book** (`src/scheduling/appointmentBook.ts`, migration 042) is a real system of record.
   - Resources have working hours and an IANA timezone.
   - Appointments are protected by a partial unique index on (tenant, resource, start) WHERE confirmed, so the
     database, not the agent, prevents double-booking.
   - Booking is idempotent on the run's idempotency key. Reschedule is one transaction.
   - Business limits live in code: one appointment per customer per doctor per day, and 5 upcoming per customer.
   - The tools (`schedule_find_slots`, `_my_appointments`, `_book`, `_reschedule`, `_cancel`) have `verify()`
     read-backs and `compensate()`. External calendars (WP-5.4) will sit behind the same tools.
2. **Code-bound tool arguments.** A tool node's `bindPaths` sets arguments from run state (e.g.
   `customerRef ← customer.ref`), overriding anything the model proposed. A missing bound value fails loudly.
   Charter tools declare `bind`. This makes "act on someone else's record" impossible even under prompt injection.

## Consequences
- The old `calendar_check_availability` / `calendar_book_slot` sandbox stubs remain for legacy templates only.
  New work uses the scheduling tools.
- There are no slot holds yet: booking is a single atomic confirm. Add hold → confirm when payment sits in between (WP-4.4).
- The booking limits are fixed defaults (ponytail). Make them tenant policy when a business needs different numbers.
