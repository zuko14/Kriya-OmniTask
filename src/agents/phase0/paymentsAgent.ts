/**
 * Kriya Omnitask — Payments & Mandate Agent (docs/kriya WP-4.4, 02 §9)
 * Owns payment links, holds, and refunds: only writer of payment transactions under Mandate.
 *
 * A charter on the bounded agent loop: payment link generation → verification → refund → Ed25519 proof receipts.
 * Actions within Mandate execute autonomously (T2); over-limit actions park at `human_gate` for `billing_manager` approval.
 * `customerRef` is bound by code from the conversation to prevent cross-customer financial manipulation.
 *
 * `createPaymentsReceiver` plugs this agent directly into Intake's hand-off delivery.
 */

import { AgentCharterInput, buildAgentFromCharter } from '../charter/agentCharter.js';
import { HandoffReceiver } from './intakeAgent.js';
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

export const DEFAULT_PAYMENTS_CHARTER: AgentCharterInput = {
  slug: 'payments',
  version: '1.0.0',
  owns: 'payment links, holds, and refunds: only writer of payment transactions under Mandate',
  goal:
    'You are the payments and mandate agent for a business. ' +
    'You generate secure payment collection links for customer fees, invoices, or appointment prepayments using payment_create_link. ' +
    'Check payment status, link status, and hold status using payment_verify_status. ' +
    'To issue refunds for cancellations or billing disputes, use payment_refund within your authorized mandate limits. ' +
    'Look up past refund records using payment_get_refund. ' +
    "Never generate a payment link or refund on someone else's behalf; customerRef is strictly bound by code from the conversation. " +
    'Never claim a transaction or refund has completed unless a tool confirmed it. ' +
    'If an action exceeds your delegated mandate limit, explain that managerial approval is required. ' +
    'Reply politely, concisely, and helpfully in the customer language.',
  tools: [
    {
      slug: 'payment_create_link',
      description:
        'args {"amount":number,"currency"?:string,"description":string,"appointmentId"?:string,"holdId"?:string,"expiresInMinutes"?:number}: generate a secure payment link',
      amountArg: 'amount',
      bind: BOUND,
    },
    {
      slug: 'payment_verify_status',
      description:
        'args {"linkId"?:string,"holdId"?:string,"appointmentId"?:string}: verify payment link or hold status',
      bind: BOUND,
    },
    {
      slug: 'payment_refund',
      description:
        'args {"amount":number,"reason":string,"appointmentId"?:string,"currency"?:string}: issue an authorized refund within mandate',
      amountArg: 'amount',
      bind: BOUND,
    },
    {
      slug: 'payment_get_refund',
      description:
        'args {"refundId"?:string,"appointmentId"?:string}: look up refund records from the system of record',
      bind: BOUND,
    },
  ],
  dataScope: ['handoff', 'customer.ref', 'customer.name'],
  autonomyTierCap: 'T2',
  budgets: { maxIterations: 8, maxCostUsd: 0.05 },
  modelTier: 'T2',
  owner: 'billing_manager',
  evalSuiteId: 'payments-golden-v1',
};

import { TenantContextManager } from '../../core/context/tenantContext.js';
import { AutonomyThrottlingService } from '../../throttling/service/autonomyThrottlingService.js';

export interface PaymentsReceiverDeps {
  registry: ToolRegistryService;
  gateway?: ModelGateway;
  charter?: AgentCharterInput;
  client?: DatabaseClient;
  attention?: AttentionService;
  mandateService?: MandateService;
  proofService?: ProofService;
  throttlingService?: AutonomyThrottlingService;
}

export function createPaymentsReceiver(deps: PaymentsReceiverDeps): HandoffReceiver {
  return async (handoff, ctx) => {
    if (!ctx.customerId) {
      throw new Error('the Payments agent needs a known customer (no customerId on the conversation).');
    }
    const runs = new GraphRunRepository(deps.client);
    const existing = await runs.findByCorrelationId(ctx.key);
    if (existing) {
      return { ref: existing.id, outcome: existing.outcome ?? existing.status };
    }

    const charter = deps.charter ?? DEFAULT_PAYMENTS_CHARTER;
    let tenantId = 'tenant_default';
    try {
      tenantId = TenantContextManager.getTenantId();
    } catch {}

    const throttling = deps.throttlingService ?? new AutonomyThrottlingService(deps.client);
    const effectiveAutonomyTierCap = await throttling.getEffectiveTierCap(
      tenantId,
      charter.slug,
      charter.autonomyTierCap
    );

    const built = buildAgentFromCharter(charter, {
      registry: deps.registry,
      effectiveAutonomyTierCap,
    });
    const { handlers, compensator } = createRuntimeHandlers({
      agentSlug: built.agentSlug,
      agentVersion: built.agentVersion,
      gateway: deps.gateway,
      schemas: built.schemas,
      rules: built.rules,
      toolRegistry: deps.registry,
      proofService: deps.proofService ?? new ProofService(deps.client),
      mandateService: deps.mandateService ?? new MandateService(deps.client),
      dbClient: deps.client,
    });

    const attention = deps.attention ?? new AttentionService(deps.client);
    const res = await new GraphExecutor(handlers, runs, compensator, attention).start(
      built.graph,
      {
        request: ctx.request,
        handoff,
        customerId: ctx.customerId,
        customerRef: ctx.customerId,
        sourceAgentId: 'payments',
        requiredRole: 'billing_manager',
        customer: { ref: ctx.customerId, name: handoff.entities.personName ?? undefined },
        language: handoff.language,
      },
      { correlationId: ctx.key }
    );

    const plan = res.state.plan as { action?: string; answer?: string } | undefined;
    const done = res.outcome === 'verified' || res.outcome === 'informed';

    if (!done && res.status !== 'parked') {
      const isOverLimit =
        res.parkReason?.toLowerCase().includes('mandate') ||
        res.parkReason?.toLowerCase().includes('limit') ||
        (res.state.mandate as { decision?: string } | undefined)?.decision === 'over_limit';

      await attention.escalateOnce({
        correlationId: `${ctx.key}:payments`,
        customerId: ctx.customerId,
        channel: 'whatsapp',
        sourceAgentId: 'payments',
        title: isOverLimit
          ? 'Payment action exceeds delegated Mandate limit'
          : `Payments run ended '${res.outcome ?? res.status}'`,
        description: `Customer wrote: "${ctx.request.slice(0, 500)}". ${res.error ?? res.parkReason ?? ''}`.trim(),
        reasonCategory: isOverLimit ? 'financial_threshold' : 'workflow_suspended',
        priority: isOverLimit ? 'P1_HIGH' : 'P2_MEDIUM',
        contextData: {
          runId: res.runId,
          outcome: res.outcome ?? null,
          status: res.status,
          parkReason: res.parkReason ?? null,
          mandate: res.state.mandate ?? null,
          requiredRole: 'billing_manager',
        },
        recommendedAction: isOverLimit
          ? 'Review financial transaction proposal and approve or reject.'
          : 'Review the run and handle payment transaction manually.',
      });
    }

    return {
      ref: res.runId,
      outcome: res.outcome ?? res.status,
      ...(done && plan?.action === 'finish' && plan.answer ? { reply: plan.answer } : {}),
    };
  };
}
