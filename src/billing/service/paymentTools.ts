/**
 * Kriya Omnitask — Payment, Link, Hold & Refund Tools (docs/kriya WP-4.4, WP-4.7)
 * High-reliability financial operations with read-back verification and saga compensation.
 */

import { z } from 'zod';
import { RegisteredTool } from '../../tools/registry/toolRegistry.js';
import { DatabaseClient, db } from '../../storage/db.js';
import { RefundRepository } from '../repositories/refundRepository.js';
import { PaymentLinkRepository } from '../repositories/paymentLinkRepository.js';
import { PaymentHoldRepository } from '../repositories/paymentHoldRepository.js';
import { ValidationError } from '../../core/errors/errors.js';

export interface PaymentToolsDeps {
  client?: DatabaseClient;
  refundRepo?: RefundRepository | (() => RefundRepository);
  linkRepo?: PaymentLinkRepository | (() => PaymentLinkRepository);
  holdRepo?: PaymentHoldRepository | (() => PaymentHoldRepository);
}

export function paymentTools(
  depsOrClient?: DatabaseClient | RefundRepository | (() => RefundRepository) | PaymentToolsDeps
): RegisteredTool[] {
  let customClient: DatabaseClient | undefined;
  let refundFactory: () => RefundRepository;
  let linkFactory: () => PaymentLinkRepository;
  let holdFactory: () => PaymentHoldRepository;

  if (depsOrClient && 'query' in depsOrClient && typeof (depsOrClient as any).query === 'function') {
    customClient = depsOrClient as DatabaseClient;
    refundFactory = () => new RefundRepository(customClient);
    linkFactory = () => new PaymentLinkRepository(customClient);
    holdFactory = () => new PaymentHoldRepository(customClient);
  } else if (depsOrClient instanceof RefundRepository) {
    refundFactory = () => depsOrClient;
    linkFactory = () => new PaymentLinkRepository();
    holdFactory = () => new PaymentHoldRepository();
  } else if (typeof depsOrClient === 'function') {
    refundFactory = depsOrClient;
    linkFactory = () => new PaymentLinkRepository();
    holdFactory = () => new PaymentHoldRepository();
  } else if (depsOrClient && typeof depsOrClient === 'object') {
    const deps = depsOrClient as PaymentToolsDeps;
    customClient = deps.client;
    refundFactory =
      typeof deps.refundRepo === 'function'
        ? deps.refundRepo
        : deps.refundRepo
        ? () => deps.refundRepo as RefundRepository
        : () => new RefundRepository(customClient);
    linkFactory =
      typeof deps.linkRepo === 'function'
        ? deps.linkRepo
        : deps.linkRepo
        ? () => deps.linkRepo as PaymentLinkRepository
        : () => new PaymentLinkRepository(customClient);
    holdFactory =
      typeof deps.holdRepo === 'function'
        ? deps.holdRepo
        : deps.holdRepo
        ? () => deps.holdRepo as PaymentHoldRepository
        : () => new PaymentHoldRepository(customClient);
  } else {
    refundFactory = () => new RefundRepository();
    linkFactory = () => new PaymentLinkRepository();
    holdFactory = () => new PaymentHoldRepository();
  }

  const def = (
    slug: string,
    name: string,
    description: string,
    riskTier: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL',
    requiresApproval = false
  ) => ({
    slug,
    name,
    description,
    category: 'payment' as const,
    riskTier,
    requiresApproval,
    inputSchema: {},
    outputSchema: {},
    isSystem: true,
  });

  return [
    {
      definition: def(
        'payment_create_link',
        'Create Payment Link',
        'Generates an authorized payment collection link for customer billing, fees, or deposits.',
        'MEDIUM'
      ),
      inputValidator: z.object({
        customerRef: z.string().min(1),
        customerName: z.string().optional(),
        amount: z.number().positive(),
        currency: z.string().length(3).default('INR'),
        description: z.string().min(3),
        appointmentId: z.string().optional(),
        holdId: z.string().optional(),
        mandateId: z.string().optional(),
        expiresInMinutes: z.number().int().min(5).max(10080).optional(),
      }),
      handler: async (input, ctx) => {
        if (!ctx.idempotencyKey) {
          throw new ValidationError('payment_create_link requires an idempotency key.');
        }
        const repo = linkFactory();
        const link = await repo.createLink({
          customerRef: String(input.customerRef),
          customerName: input.customerName as string | undefined,
          amount: Number(input.amount),
          currency: input.currency ? String(input.currency) : 'INR',
          description: String(input.description),
          appointmentId: input.appointmentId ? String(input.appointmentId) : undefined,
          holdId: input.holdId ? String(input.holdId) : undefined,
          mandateId: input.mandateId ? String(input.mandateId) : undefined,
          expiresInMinutes: typeof input.expiresInMinutes === 'number' ? input.expiresInMinutes : undefined,
          idempotencyKey: ctx.idempotencyKey,
        });

        return {
          linkId: link.id,
          customerRef: link.customer_ref,
          amount: link.amount,
          currency: link.currency,
          paymentUrl: link.payment_url,
          status: link.status,
          expiresAt: link.expires_at,
          appointmentId: link.appointment_id,
        };
      },
      verify: async (input, output) => {
        const repo = linkFactory();
        const link = await repo.getLink(String(output.linkId));
        if (
          link &&
          link.status === 'created' &&
          link.amount === Number(input.amount) &&
          link.customer_ref === String(input.customerRef)
        ) {
          return {
            state: 'verified',
            observed: {
              linkId: link.id,
              amount: link.amount,
              currency: link.currency,
              status: link.status,
              paymentUrl: link.payment_url,
            },
          };
        }
        return {
          state: 'mismatch',
          observed: { found: !!link, status: link?.status, amount: link?.amount },
        };
      },
      compensate: async (_input, output) => {
        const repo = linkFactory();
        await repo.cancelLink(String(output.linkId), 'compensated: a later workflow step failed');
      },
    },
    {
      definition: def(
        'payment_verify_status',
        'Verify Payment Status',
        'Reads back and verifies the status of a payment link, payment hold, or refund.',
        'LOW'
      ),
      inputValidator: z.object({
        linkId: z.string().optional(),
        holdId: z.string().optional(),
        customerRef: z.string().min(1),
        appointmentId: z.string().optional(),
      }).refine((d) => d.linkId || d.holdId || d.appointmentId || d.customerRef, {
        message: 'Must provide either linkId, holdId, appointmentId, or customerRef.',
      }),
      handler: async (input) => {
        const linkRepo = linkFactory();
        const holdRepo = holdFactory();
        const customerRef = String(input.customerRef);

        if (input.linkId) {
          const link = await linkRepo.getLink(String(input.linkId));
          if (!link || link.customer_ref !== customerRef) {
            return { found: false, type: 'link', record: null };
          }
          return { found: true, type: 'link', status: link.status, amount: link.amount, currency: link.currency, paidAt: link.paid_at };
        }

        if (input.holdId) {
          const hold = await holdRepo.getHold(String(input.holdId));
          if (!hold || hold.customer_ref !== customerRef) {
            return { found: false, type: 'hold', record: null };
          }
          return { found: true, type: 'hold', status: hold.status, amount: hold.amount, currency: hold.currency, expiresAt: hold.expires_at };
        }

        if (input.appointmentId) {
          const links = await linkRepo.getByAppointmentId(String(input.appointmentId));
          const customerLinks = links.filter((l) => l.customer_ref === customerRef);
          return { found: customerLinks.length > 0, type: 'appointment_links', count: customerLinks.length, links: customerLinks };
        }

        const customerLinks = await linkRepo.listForCustomer(customerRef);
        return { found: customerLinks.length > 0, type: 'customer_links', count: customerLinks.length, links: customerLinks };
      },
      verify: async (_input, output) => ({
        state: 'verified',
        observed: { found: output.found, status: output.status },
      }),
    },
    {
      definition: def(
        'payment_hold',
        'Hold Payment Authorization',
        'Places a temporary financial hold or authorization on customer balance/card for an appointment or service.',
        'HIGH'
      ),
      inputValidator: z.object({
        customerRef: z.string().min(1),
        amount: z.number().positive(),
        currency: z.string().length(3).default('INR'),
        purpose: z.string().min(3),
        appointmentId: z.string().optional(),
        mandateId: z.string().optional(),
        holdMinutes: z.number().int().min(1).max(1440).optional(),
      }),
      handler: async (input, ctx) => {
        if (!ctx.idempotencyKey) {
          throw new ValidationError('payment_hold requires an idempotency key.');
        }
        const repo = holdFactory();
        const hold = await repo.createHold({
          customerRef: String(input.customerRef),
          amount: Number(input.amount),
          currency: input.currency ? String(input.currency) : 'INR',
          purpose: String(input.purpose),
          appointmentId: input.appointmentId ? String(input.appointmentId) : undefined,
          mandateId: input.mandateId ? String(input.mandateId) : undefined,
          holdMinutes: typeof input.holdMinutes === 'number' ? input.holdMinutes : undefined,
          idempotencyKey: ctx.idempotencyKey,
        });

        return {
          holdId: hold.id,
          customerRef: hold.customer_ref,
          amount: hold.amount,
          currency: hold.currency,
          status: hold.status,
          expiresAt: hold.expires_at,
          appointmentId: hold.appointment_id,
        };
      },
      verify: async (input, output) => {
        const repo = holdFactory();
        const hold = await repo.getHold(String(output.holdId));
        if (
          hold &&
          hold.status === 'held' &&
          hold.amount === Number(input.amount) &&
          hold.customer_ref === String(input.customerRef)
        ) {
          return {
            state: 'verified',
            observed: {
              holdId: hold.id,
              amount: hold.amount,
              currency: hold.currency,
              status: hold.status,
              expiresAt: hold.expires_at,
            },
          };
        }
        return {
          state: 'mismatch',
          observed: { found: !!hold, status: hold?.status, amount: hold?.amount },
        };
      },
      compensate: async (_input, output) => {
        const repo = holdFactory();
        await repo.releaseHold(String(output.holdId), 'compensated: a later workflow step failed');
      },
    },
    {
      definition: def(
        'payment_refund',
        'Issue Payment Refund',
        'Issues an authorized financial refund for prepaid fees or billing credits within delegated Mandate.',
        'HIGH'
      ),
      inputValidator: z.object({
        customerRef: z.string().min(1),
        appointmentId: z.string().optional(),
        amount: z.number().positive(),
        currency: z.string().length(3).default('INR'),
        reason: z.string().min(3),
        mandateId: z.string().optional(),
        humanApproverId: z.string().optional(),
      }),
      handler: async (input, ctx) => {
        if (!ctx.idempotencyKey) {
          throw new ValidationError('payment_refund requires an idempotency key.');
        }
        const repo = refundFactory();
        const record = await repo.createRefund({
          customerRef: String(input.customerRef),
          appointmentId: input.appointmentId ? String(input.appointmentId) : undefined,
          amount: Number(input.amount),
          currency: input.currency ? String(input.currency) : 'INR',
          reason: String(input.reason),
          mandateId: input.mandateId ? String(input.mandateId) : undefined,
          humanApproverId: input.humanApproverId ? String(input.humanApproverId) : undefined,
          idempotencyKey: ctx.idempotencyKey,
        });
        return {
          refundId: record.id,
          customerRef: record.customer_ref,
          appointmentId: record.appointment_id,
          amount: record.amount,
          currency: record.currency,
          status: record.status,
          processedAt: record.created_at,
        };
      },
      verify: async (input, output) => {
        const repo = refundFactory();
        const record = await repo.getRefund(String(output.refundId));
        if (
          record &&
          record.status === 'processed' &&
          record.amount === Number(input.amount) &&
          record.customer_ref === String(input.customerRef)
        ) {
          return {
            state: 'verified',
            observed: {
              refundId: record.id,
              amount: record.amount,
              currency: record.currency,
              status: record.status,
            },
          };
        }
        return {
          state: 'mismatch',
          observed: { found: !!record, status: record?.status, amount: record?.amount },
        };
      },
      compensate: async (_input, output) => {
        const repo = refundFactory();
        await repo.voidRefund(String(output.refundId), 'compensated: a later workflow step failed');
      },
    },
    {
      definition: def(
        'payment_get_refund',
        'Get Payment Refund',
        'Reads back a payment refund record by ID or appointment ID from the system of record.',
        'LOW'
      ),
      inputValidator: z.object({
        refundId: z.string().optional(),
        appointmentId: z.string().optional(),
      }).refine((data) => data.refundId || data.appointmentId, {
        message: 'Either refundId or appointmentId is required.',
      }),
      handler: async (input) => {
        const repo = refundFactory();
        if (input.refundId) {
          const record = await repo.getRefund(String(input.refundId));
          return { refund: record };
        }
        if (input.appointmentId) {
          const records = await repo.getByAppointmentId(String(input.appointmentId));
          return { refunds: records, count: records.length };
        }
        return { refund: null };
      },
      verify: async (_input, output) => ({
        state: 'verified',
        observed: { found: Boolean(output.refund || (output.count && (output.count as number) > 0)) },
      }),
    },
  ];
}
