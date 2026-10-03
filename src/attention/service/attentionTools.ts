/**
 * Kriya AI — Attention & Escalation Center Tools
 * Built-in registered tools for human attention queue management and conversation takeovers (§14, §16 of CLAUDE.md, docs/kriya WP-4.6).
 */

import { z } from 'zod';
import { RegisteredTool } from '../../tools/registry/toolRegistry.js';
import { AttentionService } from './attentionService.js';
import {
  AttentionPriorityEnum,
  AttentionStatusEnum,
  AttentionReasonCategoryEnum,
  ResolutionActionEnum,
} from '../types/attentionTypes.js';

export function attentionTools(
  serviceFactory: () => AttentionService = () => new AttentionService()
): RegisteredTool[] {
  return [
    {
      definition: {
        slug: 'attention_list_queue',
        name: 'Attention List Queue',
        description: 'Lists human attention items with filtering by status, priority, role, or branch.',
        category: 'custom',
        riskTier: 'LOW',
        requiresApproval: false,
        inputSchema: {
          status: 'pending | claimed | resolved | dismissed | timed_out (optional)',
          priority: 'P0_CRITICAL | P1_HIGH | P2_MEDIUM | P3_LOW (optional)',
          assignedRole: 'string (optional)',
          branchId: 'string (optional)',
          limit: 'number (optional, default 50)',
        },
        outputSchema: { items: 'AttentionItemRecord[]' },
        isSystem: true,
      },
      inputValidator: z.object({
        status: AttentionStatusEnum.optional(),
        priority: AttentionPriorityEnum.optional(),
        reasonCategory: AttentionReasonCategoryEnum.optional(),
        assignedRole: z.string().optional(),
        branchId: z.string().optional(),
        limit: z.number().int().min(1).max(100).default(50),
      }),
      handler: async (input) => {
        const service = serviceFactory();
        const items = await service.listItems(input as any);
        return { items: items as unknown as Record<string, unknown> };
      },
    },
    {
      definition: {
        slug: 'attention_claim_item',
        name: 'Attention Claim Item',
        description: 'Claims an attention item by an operator or supervisor.',
        category: 'custom',
        riskTier: 'MEDIUM',
        requiresApproval: false,
        inputSchema: { itemId: 'string', userId: 'string' },
        outputSchema: { item: 'AttentionItemRecord' },
        isSystem: true,
      },
      inputValidator: z.object({
        itemId: z.string().min(1),
        userId: z.string().min(1),
      }),
      handler: async (input) => {
        const service = serviceFactory();
        const item = await service.claimItem(input.itemId as string, input.userId as string);
        return { item: item as unknown as Record<string, unknown> };
      },
      verify: async (input) => {
        const service = serviceFactory();
        const item = await service.getItem(input.itemId as string);
        const verified = item.status === 'claimed' && item.assigned_user_id === input.userId;
        return {
          state: verified ? 'verified' : 'mismatch',
          observed: { status: item.status, assignedUserId: item.assigned_user_id },
        };
      },
    },
    {
      definition: {
        slug: 'attention_resolve_item',
        name: 'Attention Resolve Item',
        description: 'Resolves an attention item with human verdict and resolution notes.',
        category: 'custom',
        riskTier: 'MEDIUM',
        requiresApproval: false,
        inputSchema: {
          itemId: 'string',
          action: 'approved | rejected | overridden | taken_over | dismissed',
          notes: 'string (optional)',
        },
        outputSchema: { item: 'AttentionItemRecord' },
        isSystem: true,
      },
      inputValidator: z.object({
        itemId: z.string().min(1),
        action: ResolutionActionEnum,
        notes: z.string().optional(),
      }),
      handler: async (input) => {
        const service = serviceFactory();
        const item = await service.resolveItem(input.itemId as string, {
          action: input.action as any,
          notes: input.notes as string | undefined,
        });
        return { item: item as unknown as Record<string, unknown> };
      },
      verify: async (input) => {
        const service = serviceFactory();
        const item = await service.getItem(input.itemId as string);
        const verified = item.status === 'resolved' && item.resolution_action === input.action;
        return {
          state: verified ? 'verified' : 'mismatch',
          observed: { status: item.status, resolutionAction: item.resolution_action },
        };
      },
    },
    {
      definition: {
        slug: 'attention_route_item',
        name: 'Attention Route Item',
        description: 'Explicitly re-routes an attention item to a target role or branch.',
        category: 'custom',
        riskTier: 'MEDIUM',
        requiresApproval: false,
        inputSchema: {
          itemId: 'string',
          assignedRole: 'string',
          assignedUserId: 'string (optional)',
          branchId: 'string (optional)',
        },
        outputSchema: { item: 'AttentionItemRecord' },
        isSystem: true,
      },
      inputValidator: z.object({
        itemId: z.string().min(1),
        assignedRole: z.string().min(1),
        assignedUserId: z.string().optional(),
        branchId: z.string().optional(),
      }),
      handler: async (input) => {
        const service = serviceFactory();
        const item = await service.routeItem(input.itemId as string, {
          assignedRole: input.assignedRole as string,
          assignedUserId: input.assignedUserId as string | undefined,
          branchId: input.branchId as string | undefined,
        });
        return { item: item as unknown as Record<string, unknown> };
      },
      verify: async (input) => {
        const service = serviceFactory();
        const item = await service.getItem(input.itemId as string);
        const verified = item.assigned_role === input.assignedRole;
        return {
          state: verified ? 'verified' : 'mismatch',
          observed: { assignedRole: item.assigned_role, branchId: item.branch_id },
        };
      },
    },
    {
      definition: {
        slug: 'attention_takeover',
        name: 'Attention Takeover',
        description: 'Initiates a human takeover of a customer conversation on a specific channel.',
        category: 'custom',
        riskTier: 'HIGH',
        requiresApproval: false,
        inputSchema: {
          customerId: 'string',
          channel: 'string',
          userId: 'string',
          reason: 'string',
        },
        outputSchema: { takeover: 'ConversationTakeoverRecord' },
        isSystem: true,
      },
      inputValidator: z.object({
        customerId: z.string().min(1),
        channel: z.string().default('whatsapp'),
        userId: z.string().min(1),
        reason: z.string().min(1),
      }),
      handler: async (input) => {
        const service = serviceFactory();
        const takeover = await service.startTakeover(input.userId as string, {
          customerId: input.customerId as string,
          channel: input.channel as string,
          reason: input.reason as string,
        });
        return { takeover: takeover as unknown as Record<string, unknown> };
      },
      verify: async (input) => {
        const service = serviceFactory();
        const isUnderTakeover = await service.isUnderTakeover(input.customerId as string);
        return {
          state: isUnderTakeover ? 'verified' : 'mismatch',
          observed: { isUnderTakeover, customerId: input.customerId },
        };
      },
      compensate: async (input) => {
        const service = serviceFactory();
        await service.handbackTakeover(input.customerId as string);
      },
    },
    {
      definition: {
        slug: 'attention_handback',
        name: 'Attention Handback',
        description: 'Ends a human conversation takeover and hands control back to AI agents.',
        category: 'custom',
        riskTier: 'MEDIUM',
        requiresApproval: false,
        inputSchema: { customerId: 'string' },
        outputSchema: { success: 'boolean' },
        isSystem: true,
      },
      inputValidator: z.object({
        customerId: z.string().min(1),
      }),
      handler: async (input) => {
        const service = serviceFactory();
        const success = await service.handbackTakeover(input.customerId as string);
        return { success };
      },
      verify: async (input) => {
        const service = serviceFactory();
        const isUnderTakeover = await service.isUnderTakeover(input.customerId as string);
        return {
          state: !isUnderTakeover ? 'verified' : 'mismatch',
          observed: { isUnderTakeover, customerId: input.customerId },
        };
      },
    },
  ];
}
