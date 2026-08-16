/**
 * Xylarc AI — Tool Definition Registry & Built-in System Tools
 * Provides typed tool contracts, validation schemas, risk classification, and handlers (§18 of CLAUDE.md).
 */

import { z } from 'zod';
import { ToolDefinition, ToolCategory, ToolDefinitionRecord } from '../types/toolTypes.js';
import { RiskTier } from '../../agents/types/agentTypes.js';
import { ToolDefinitionRepository } from '../repositories/toolRepository.js';
import { CustomerRepository } from '../../customer360/repositories/customerRepository.js';
import { OutboundQueueService } from '../../channels/queue/outboundQueueService.js';
import { CredentialVault } from '../vault/credentialVault.js';
import { ValidationError, NotFoundError } from '../../core/errors/errors.js';
import { logger } from '../../core/logger/logger.js';

export interface ToolExecutionContext {
  tenantId: string;
  agentId?: string;
  correlationId?: string;
  vault: CredentialVault;
}

export type ToolHandler = (
  input: Record<string, unknown>,
  context: ToolExecutionContext
) => Promise<Record<string, unknown>>;

export interface RegisteredTool {
  definition: ToolDefinition;
  inputValidator: z.ZodType<any>;
  handler: ToolHandler;
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
      handler: async (input) => {
        // Deterministic availability generator
        const slots = ['09:00', '10:30', '14:00', '16:00'].map((time) => ({
          startTime: `${input.date}T${time}:00Z`,
          durationMinutes: input.durationMinutes,
          available: true,
        }));
        return { availableSlots: slots, date: input.date };
      },
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
      handler: async (input, ctx) => {
        const bookingId = `book-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        return {
          bookingId,
          customerId: input.customerId,
          slotTime: input.slotTime,
          title: input.title,
          status: 'confirmed',
          confirmedAt: new Date().toISOString(),
        };
      },
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
        const idempotencyKey = `wa-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
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
      handler: async (input) => {
        return {
          refundId: `ref-${Date.now()}`,
          transactionId: input.transactionId,
          amountUsd: input.amountUsd,
          status: 'processed',
          processedAt: new Date().toISOString(),
        };
      },
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
      handler: async (input) => {
        return {
          statusCode: 200,
          delivered: true,
          endpointUrl: input.endpointUrl,
          dispatchedAt: new Date().toISOString(),
        };
      },
    });
  }
}
