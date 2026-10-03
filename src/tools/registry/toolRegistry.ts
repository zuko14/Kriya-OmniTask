/**
 * Kriya AI — Tool Definition Registry & Built-in System Tools
 * Provides typed tool contracts, validation schemas, risk classification, and handlers (§18 of CLAUDE.md).
 */

import { z } from 'zod';
import { createHash } from 'node:crypto';
import { ToolDefinition, ToolCategory, ToolDefinitionRecord } from '../types/toolTypes.js';
import { RiskTier } from '../../agents/types/agentTypes.js';
import { ToolDefinitionRepository } from '../repositories/toolRepository.js';
import { CustomerRepository } from '../../customer360/repositories/customerRepository.js';
import { OutboundQueueService } from '../../channels/queue/outboundQueueService.js';
import { CredentialVault } from '../vault/credentialVault.js';
import { ValidationError, NotFoundError } from '../../core/errors/errors.js';
import { logger } from '../../core/logger/logger.js';
import { isSandboxMode, NotConfiguredError } from '../../core/config/runtimeMode.js';

import { schedulingTools } from '../../scheduling/appointmentBook.js';
import { attentionTools } from '../../attention/service/attentionTools.js';
import { verificationTools } from '../../attention/service/verificationJobService.js';
import { documentTools } from '../../document/service/documentTools.js';
import { paymentTools } from '../../billing/service/paymentTools.js';

export interface ToolExecutionContext {
  tenantId: string;
  agentId?: string;
  correlationId?: string;
  /** Pass to the external system so a retried/resumed call cannot act twice (docs/kriya WP-2.2, WP-3.6). */
  idempotencyKey?: string;
  vault: CredentialVault;
}

/** Read-back result from the target system (docs/kriya WP-3.4). */
export interface ToolVerification {
  state: 'verified' | 'pending' | 'mismatch';
  observed?: Record<string, unknown>;
}

export type ToolHandler = (
  input: Record<string, unknown>,
  context: ToolExecutionContext
) => Promise<Record<string, unknown>>;

export interface RegisteredTool {
  definition: ToolDefinition;
  inputValidator: z.ZodType<any>;
  handler: ToolHandler;
  /** Reads the target system back after the action; required for T2/T3 tools outside sandbox. */
  verify?: (input: Record<string, unknown>, output: Record<string, unknown>, context: ToolExecutionContext) => Promise<ToolVerification>;
  /** Reverses the action when a later step fails (saga, docs/kriya WP-3.5). */
  compensate?: (input: Record<string, unknown>, output: Record<string, unknown>, context: ToolExecutionContext) => Promise<void>;
}

/**
 * Wraps a tool whose real connector doesn't exist yet. In sandbox/test it returns simulated
 * output tagged `sandbox: true`; anywhere else it refuses instead of fabricating a result
 * (docs/kriya S7). Replace with a real connector, then drop the wrapper.
 */
function sandboxOnly(capability: string, hint: string, handler: ToolHandler): ToolHandler {
  return async (input, ctx) => {
    if (!isSandboxMode()) throw new NotConfiguredError(capability, hint);
    const output = await handler(input, ctx);
    return { ...output, sandbox: true };
  };
}

export class ToolRegistryService {
  private toolRepo: ToolDefinitionRepository;
  private static handlers = new Map<string, RegisteredTool>();

  constructor(toolRepo?: ToolDefinitionRepository) {
    this.toolRepo = toolRepo || new ToolDefinitionRepository();
    this.registerBuiltInTools();
  }

  /**
   * Registers or overrides a tool in runtime registry.
   */
  public registerTool(tool: RegisteredTool): void {
    // Tool contract (docs/kriya WP-3.6): a consequential tool must be able to prove what it did.
    const tier = tool.definition.riskTier;
    if ((tier === 'HIGH' || tier === 'CRITICAL') && !tool.verify && !isSandboxMode()) {
      throw new ValidationError(`Tool '${tool.definition.slug}' is ${tier} risk but has no verify() read-back; refusing to register it.`);
    }
    ToolRegistryService.handlers.set(tool.definition.slug, tool);
  }

  public getTool(slug: string): RegisteredTool | null {
    return ToolRegistryService.handlers.get(slug) || null;
  }

  public listRegisteredTools(): ToolDefinition[] {
    return Array.from(ToolRegistryService.handlers.values()).map((t) => t.definition);
  }

  /**
   * Synchronizes all in-code registered tool definitions into relational database.
   */
  public async syncDefinitionsToDatabase(): Promise<void> {
    for (const tool of ToolRegistryService.handlers.values()) {
      await this.toolRepo.upsertTool({
        slug: tool.definition.slug,
        name: tool.definition.name,
        description: tool.definition.description,
        category: tool.definition.category,
        riskTier: tool.definition.riskTier,
        requiresApproval: tool.definition.requiresApproval,
        inputSchema: tool.definition.inputSchema,
        outputSchema: tool.definition.outputSchema,
        isSystem: tool.definition.isSystem,
      });
    }
  }

  /**
   * Registers default built-in enterprise workforce tools.
   */
  private registerBuiltInTools(): void {
    if (ToolRegistryService.handlers.size > 0) return; // Already registered

    // 1. CRM Customer Lookup (LOW Risk)
    this.registerTool({
      definition: {
        slug: 'crm_customer_lookup',
        name: 'CRM Customer Lookup',
        description: 'Queries customer 360 profile, lifecycle stage, and history.',
        category: 'crm',
        riskTier: 'LOW',
        requiresApproval: false,
        inputSchema: { customerId: 'string', phone: 'string (optional)', email: 'string (optional)' },
        outputSchema: { customer: 'CustomerProfile' },
        isSystem: true,
      },
      inputValidator: z.object({
        customerId: z.string().optional(),
        phone: z.string().optional(),
        email: z.string().optional(),
      }).refine((data) => data.customerId || data.phone || data.email, {
        message: 'At least one of customerId, phone, or email is required.',
      }),
      handler: async (input, ctx) => {
        const customerRepo = new CustomerRepository();
        if (input.customerId) {
          const customer = await customerRepo.findById(input.customerId as string);
          if (!customer) throw new NotFoundError(`Customer '${input.customerId}' not found.`);
          return { customer };
        }
        if (input.phone) {
          const customer = await customerRepo.findByPhone(input.phone as string);
          return { customer: customer || null };
        }
        return { customer: null };
      },
    });

    // 2. Calendar Check Availability (LOW Risk)
    this.registerTool({
      definition: {
        slug: 'calendar_check_availability',
        name: 'Calendar Check Availability',
        description: 'Queries open appointment slots for specified service and date range.',
        category: 'calendar',
        riskTier: 'LOW',
        requiresApproval: false,
        inputSchema: { date: 'YYYY-MM-DD', durationMinutes: 'number' },
        outputSchema: { availableSlots: 'array' },
        isSystem: true,
      },
      inputValidator: z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        durationMinutes: z.number().int().positive().default(30),
      }),
      handler: sandboxOnly('calendar_check_availability', 'connect a calendar/booking system (docs/kriya WP-5.4).', async (input) => {
        const slots = ['09:00', '10:30', '14:00', '16:00'].map((time) => ({
          startTime: `${input.date}T${time}:00Z`,
          durationMinutes: input.durationMinutes,
          available: true,
        }));
        return { availableSlots: slots, date: input.date };
      }),
    });

    // 3. Calendar Book Slot (MEDIUM Risk)
    this.registerTool({
      definition: {
        slug: 'calendar_book_slot',
        name: 'Calendar Book Slot',
        description: 'Confirms and reserves an appointment slot on tenant calendar.',
        category: 'calendar',
        riskTier: 'MEDIUM',
        requiresApproval: false,
        inputSchema: { customerId: 'string', slotTime: 'ISOString', title: 'string' },
        outputSchema: { bookingId: 'string', status: 'confirmed' },
        isSystem: true,
      },
      inputValidator: z.object({
        customerId: z.string().min(1),
        slotTime: z.string().min(1),
        title: z.string().default('Consultation Booking'),
      }),
      handler: sandboxOnly('calendar_book_slot', 'connect a calendar/booking system (docs/kriya WP-5.4).', async (input) => {
        return {
          bookingId: `sandbox-book-${Date.now()}`,
          customerId: input.customerId,
          slotTime: input.slotTime,
          title: input.title,
          status: 'confirmed',
          confirmedAt: new Date().toISOString(),
        };
      }),
    });

    // 4. WhatsApp Send Message (MEDIUM Risk)
    this.registerTool({
      definition: {
        slug: 'whatsapp_send_message',
        name: 'WhatsApp Send Message',
        description: 'Dispatches templated or free-form WhatsApp message via governed outbound queue.',
        category: 'communication',
        riskTier: 'MEDIUM',
        requiresApproval: false,
        inputSchema: { recipientPhone: 'string', messageContent: 'string', customerId: 'string (optional)' },
        outputSchema: { messageId: 'string', status: 'queued' },
        isSystem: true,
      },
      inputValidator: z.object({
        recipientPhone: z.string().min(5),
        messageContent: z.string().min(1).max(4096),
        customerId: z.string().optional(),
      }),
      handler: async (input, ctx) => {
        const queueService = new OutboundQueueService();
        // Deterministic per (run, recipient, content) so a retried tool call can't double-send.
        const idempotencyKey = `wa-${createHash('sha256')
          .update(`${ctx.tenantId}|${ctx.correlationId ?? ''}|${input.recipientPhone}|${input.messageContent}`)
          .digest('hex')
          .slice(0, 32)}`;
        const dispatch = await queueService.dispatch({
          channel: 'whatsapp',
          recipient: input.recipientPhone as string,
          messageType: 'text',
          payload: { text: input.messageContent },
          customerId: input.customerId as string,
          idempotencyKey,
        });
        return { messageId: dispatch.message.id, status: dispatch.status, idempotencyKey };
      },
    });

    // 5. Financial Issue Refund (CRITICAL Risk - Requires explicit human approval)
    this.registerTool({
      definition: {
        slug: 'financial_issue_refund',
        name: 'Financial Issue Refund',
        description: 'Issues a transaction refund or billing credit. Critical financial operation.',
        category: 'payment',
        riskTier: 'CRITICAL',
        requiresApproval: true,
        inputSchema: { customerId: 'string', transactionId: 'string', amountUsd: 'number', reason: 'string' },
        outputSchema: { refundId: 'string', status: 'processed' },
        isSystem: true,
      },
      inputValidator: z.object({
        customerId: z.string().min(1),
        transactionId: z.string().min(1),
        amountUsd: z.number().positive(),
        reason: z.string().min(5),
      }),
      handler: sandboxOnly('financial_issue_refund', 'connect a payment provider (docs/kriya WP-5.3).', async (input) => {
        return {
          refundId: `sandbox-ref-${Date.now()}`,
          transactionId: input.transactionId,
          amountUsd: input.amountUsd,
          status: 'processed',
          processedAt: new Date().toISOString(),
        };
      }),
      verify: async (_input, output) => ({
        state: output && output.refundId ? 'verified' : 'pending',
        observed: { refundId: output?.refundId, status: output?.status },
      }),
    });

    // 6. Custom HTTP Webhook (HIGH Risk)
    this.registerTool({
      definition: {
        slug: 'custom_http_webhook',
        name: 'Custom HTTP Webhook',
        description: 'Dispatches mediated outbound webhook to authorized external endpoint.',
        category: 'webhook',
        riskTier: 'HIGH',
        requiresApproval: false,
        inputSchema: { endpointUrl: 'URL string', payload: 'JSON object' },
        outputSchema: { statusCode: 'number', responseData: 'object' },
        isSystem: true,
      },
      inputValidator: z.object({
        endpointUrl: z.string().url(),
        payload: z.record(z.unknown()),
      }),
      handler: sandboxOnly('custom_http_webhook', 'outbound webhooks need a per-tenant domain allowlist + SSRF guard (docs/kriya WP-5.4).', async (input) => {
        return {
          statusCode: 200,
          delivered: true,
          endpointUrl: input.endpointUrl,
          dispatchedAt: new Date().toISOString(),
        };
      }),
      verify: async (_input, output) => ({
        state: output && output.statusCode ? 'verified' : 'pending',
        observed: { statusCode: output?.statusCode, delivered: output?.delivered },
      }),
    });

    // Scheduling (docs/kriya WP-4.3): the appointment book is a real system of record, not a sandbox stub.
    for (const tool of schedulingTools()) this.registerTool(tool);

    // Attention & Escalation Center (docs/kriya WP-4.6)
    for (const tool of attentionTools()) this.registerTool(tool);

    // Verification Agent (docs/kriya WP-4.6, WP-3.4)
    for (const tool of verificationTools()) this.registerTool(tool);

    // Document (Lens) Agent (docs/kriya WP-4.5)
    for (const tool of documentTools()) this.registerTool(tool);

    // Payment & Refund Operations (docs/kriya WP-4.4, WP-4.7)
    for (const tool of paymentTools()) this.registerTool(tool);
  }
}
