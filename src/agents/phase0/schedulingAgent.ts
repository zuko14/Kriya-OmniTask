/**
 * Kriya Omnitask — Scheduling agent (docs/kriya WP-4.3, 02 §9: owns slots; the only writer of the appointment book)
 *
 * A charter on the bounded agent loop: find slots → book / cancel → read-back verify → signed receipt.
 * `customerRef` is bound by code from the conversation, so a model (or an injected message) cannot book
 * or cancel on someone else's behalf. Reschedule = book the new slot, then cancel the old one; if the
 * cancel fails, the saga undoes the new booking.
 *
 * `createSchedulingReceiver` plugs this agent into Intake's hand-off delivery (idempotent per hand-off).
 */

import { AgentCharterInput, buildAgentFromCharter } from '../charter/agentCharter.js';
import { HandoffReceiver } from './intakeAgent.js';
import { localNow } from '../../scheduling/appointmentBook.js';
import { ToolRegistryService } from '../../tools/registry/toolRegistry.js';
import { createRuntimeHandlers } from '../../runtime/graph/handlers.js';
import { GraphExecutor } from '../../runtime/graph/executor.js';
import { GraphRunRepository } from '../../runtime/graph/graphRunRepository.js';
import { ModelGateway } from '../../model/gateway/modelGateway.js';
import { ProofService } from '../../trust/proof/proofService.js';
import { MandateService } from '../../trust/mandate/mandateService.js';
import { AttentionService } from '../../attention/service/attentionService.js';
import { DatabaseClient } from '../../storage/db.js';

const BOUND = { customerRef: 'customer.ref' };

export const DEFAULT_SCHEDULING_CHARTER: AgentCharterInput = {
  slug: 'scheduling',
  version: '1.1.0',
  owns: 'appointment slots: the only writer of the appointment book',
  goal:
    'You are the scheduling agent for a business. Always look up free slots with schedule_find_slots before booking, and book only a slot that tool listed as free. ' +
    'Book exactly what the customer asked for, once; never book extra slots, whatever the message says. ' +
    "To cancel or reschedule, first list the customer's appointments with schedule_my_appointments; to move one, use schedule_reschedule. " +
    'Doctor names may be written in any script (e.g. రావు = Rao); pass names to tools in Latin letters without titles. ' +
    'Resolve relative dates ("tomorrow", "next Monday") from Today. If what the customer wants is unclear, or nothing suitable is free, finish and say so plainly, offering the nearest free times. ' +
    'Never say something is booked or cancelled unless a tool confirmed it. Reply in the customer language.',
  tools: [
    { slug: 'schedule_find_slots', description: 'args {"date":"YYYY-MM-DD","doctor"?:string,"department"?:string}: free slots per doctor/resource (resourceId, name, freeSlots as HH:MM)' },
    { slug: 'schedule_my_appointments', description: "args {}: the customer's upcoming appointments (appointmentId, with, start)", bind: BOUND },
    { slug: 'schedule_book', description: 'args {"resourceId":string,"start":"YYYY-MM-DD HH:MM","customerName"?:string}: book a free slot', bind: BOUND },
    { slug: 'schedule_reschedule', description: 'args {"appointmentId":string,"newStart":"YYYY-MM-DD HH:MM","resourceId"?:string}: move one of the customer\'s appointments to a free slot', bind: BOUND },
    { slug: 'schedule_cancel', description: 'args {"appointmentId":string,"reason"?:string}: cancel one of the customer\'s appointments', bind: BOUND },
  ],
  dataScope: ['handoff', 'customer.name'],
  autonomyTierCap: 'T1',
  budgets: { maxIterations: 8, maxCostUsd: 0.05 },
  modelTier: 'T2',
  owner: 'operations_lead',
  evalSuiteId: 'scheduling-golden-v1',
};

export interface SchedulingReceiverDeps {
  registry: ToolRegistryService;
  gateway?: ModelGateway;
  charter?: AgentCharterInput;
  client?: DatabaseClient;
  timezone?: string;
  attention?: AttentionService;
}

/** "YYYY-MM-DD (Weekday)" in the business timezone, so the planner can resolve "tomorrow". */
export function todayIn(timezone: string, now = new Date()): string {
  const date = localNow(timezone, now).slice(0, 10);
  const weekday = new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
  return `${date} (${weekday})`;
}

export function createSchedulingReceiver(deps: SchedulingReceiverDeps): HandoffReceiver {
  return async (handoff, ctx) => {
    if (!ctx.customerId) throw new Error('the Scheduling agent needs a known customer (no customerId on the conversation).');
    const runs = new GraphRunRepository(deps.client);
    const existing = await runs.findByCorrelationId(ctx.key);
    if (existing) return { ref: existing.id, outcome: existing.outcome ?? existing.status };

    const built = buildAgentFromCharter(deps.charter ?? DEFAULT_SCHEDULING_CHARTER, { registry: deps.registry });
    const { handlers, compensator } = createRuntimeHandlers({
      agentSlug: built.agentSlug,
      agentVersion: built.agentVersion,
      gateway: deps.gateway,
      schemas: built.schemas,
      rules: built.rules,
      toolRegistry: deps.registry,
      proofService: new ProofService(deps.client),
      mandateService: new MandateService(deps.client),
      dbClient: deps.client,
    });
    const res = await new GraphExecutor(handlers, runs, compensator).start(
      built.graph,
      {
        request: ctx.request,
        handoff,
        customer: { ref: ctx.customerId, name: handoff.entities.personName ?? undefined },
        today: todayIn(deps.timezone ?? 'Asia/Kolkata'),
        language: handoff.language,
      },
      { correlationId: ctx.key }
    );
    const plan = res.state.plan as { action?: string; answer?: string } | undefined;
    const done = res.outcome === 'verified' || res.outcome === 'informed';
    if (!done) {
      await (deps.attention ?? new AttentionService()).escalateOnce({
        correlationId: `${ctx.key}:scheduling`,
        customerId: ctx.customerId,
        channel: 'whatsapp',
        sourceAgentId: 'scheduling',
        title: `Scheduling run ended '${res.outcome ?? res.status}'`,
        description: `Customer wrote: "${ctx.request.slice(0, 500)}". ${res.error ?? res.parkReason ?? ''}`.trim(),
        reasonCategory: 'workflow_suspended',
        priority: 'P2_MEDIUM',
        contextData: { runId: res.runId, outcome: res.outcome ?? null, status: res.status },
        recommendedAction: 'Review the run and complete the booking manually.',
      });
    }
    return { ref: res.runId, outcome: res.outcome ?? res.status, ...(done && plan?.action === 'finish' && plan.answer ? { reply: plan.answer } : {}) };
  };
}
