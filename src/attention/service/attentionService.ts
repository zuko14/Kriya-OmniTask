/**
 * Xylarc AI — Human Attention Center Controller Service
 * High-level orchestration for exception escalation, priority SLA queues, and live takeovers (§14, §16 of CLAUDE.md).
 */

import {
  AttentionItemRecord,
  ConversationTakeoverRecord,
  CreateAttentionItemRequest,
  ResolveAttentionItemRequest,
  StartTakeoverRequest,
  AttentionStatus,
  AttentionPriority,
  AttentionReasonCategory,
  AttentionMetricsOverview,
} from '../types/attentionTypes.js';
import { AttentionRepository } from '../repositories/attentionRepository.js';
import { PriorityCalculator } from '../priority/priorityCalculator.js';
import { NotFoundError } from '../../core/errors/errors.js';
import { logger } from '../../core/logger/logger.js';

export class AttentionService {
  private attentionRepo: AttentionRepository;

  constructor(attentionRepo?: AttentionRepository) {
    this.attentionRepo = attentionRepo || new AttentionRepository();
  }

  /**
   * Auto-escalates an agent event or policy exception to the human attention center.
   */
  public async escalateToHuman(request: CreateAttentionItemRequest): Promise<AttentionItemRecord> {
    const priority = PriorityCalculator.calculatePriority({
      reasonCategory: request.reasonCategory,
      financialValueUsd: request.financialValueUsd,
      explicitPriority: request.priority,
    });

    const slaExpiresAt = PriorityCalculator.calculateSlaExpiry(priority);

    const item = await this.attentionRepo.createItem(request, priority, slaExpiresAt);

    logger.warn(
      `[HUMAN ATTENTION] Escalated item '${item.id}' (${priority}) for agent '${request.sourceAgentId}': ${request.title}`
    );

    return item;
  }

  /**
   * Claims an attention item by a human operator.
   */
  public async claimItem(itemId: string, userId: string): Promise<AttentionItemRecord> {
    const item = await this.attentionRepo.findById(itemId);
    if (!item) throw new NotFoundError(`Attention item '${itemId}' not found.`);

    return this.attentionRepo.claimItem(itemId, userId);
  }

  /**
   * Resolves an attention item with human verdict and notes.
   */
  public async resolveItem(
    itemId: string,
    request: ResolveAttentionItemRequest
  ): Promise<AttentionItemRecord> {
    const item = await this.attentionRepo.findById(itemId);
    if (!item) throw new NotFoundError(`Attention item '${itemId}' not found.`);

    const resolved = await this.attentionRepo.resolveItem({
      itemId,
      action: request.action,
      notes: request.notes,
    });

    logger.info(
      `[HUMAN ATTENTION] Resolved item '${itemId}' with action '${request.action}'`
    );

    return resolved;
  }

  /**
   * Starts a human live takeover for a customer conversation.
   */
  public async startTakeover(
    userId: string,
    request: StartTakeoverRequest
  ): Promise<ConversationTakeoverRecord> {
    const takeover = await this.attentionRepo.startTakeover({
      customerId: request.customerId,
      channel: request.channel,
      userId,
      reason: request.reason,
    });

    logger.warn(
      `[HUMAN TAKEOVER] User '${userId}' took over conversation for customer '${request.customerId}' on channel '${request.channel}'`
    );

    return takeover;
  }

  /**
   * Ends human takeover and hands conversation back to AI agents.
   */
  public async handbackTakeover(customerId: string): Promise<boolean> {
    const success = await this.attentionRepo.handbackTakeover(customerId);
    if (success) {
      logger.info(`[HUMAN TAKEOVER] Conversation for customer '${customerId}' handed back to autonomous agents.`);
    }
    return success;
  }

  /**
   * Checks if customer conversation is currently under active human takeover.
   */
  public async isUnderTakeover(customerId: string): Promise<boolean> {
    return this.attentionRepo.isCustomerUnderTakeover(customerId);
  }

  /**
   * Retrieves an attention item by ID.
   */
  public async getItem(id: string): Promise<AttentionItemRecord> {
    const item = await this.attentionRepo.findById(id);
    if (!item) throw new NotFoundError(`Attention item '${id}' not found.`);
    return item;
  }

  /**
   * Lists attention items matching query filters.
   */
  public async listItems(filter?: {
    status?: AttentionStatus;
    priority?: AttentionPriority;
    reasonCategory?: AttentionReasonCategory;
    assignedUserId?: string;
    limit?: number;
  }): Promise<AttentionItemRecord[]> {
    return this.attentionRepo.listItems(filter);
  }

  /**
   * Aggregates attention center overview metrics.
   */
  public async getMetricsOverview(): Promise<AttentionMetricsOverview> {
    return this.attentionRepo.getMetricsOverview();
  }
}
