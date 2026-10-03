/**
 * Kriya AI — Human Attention Center Controller Service
 * High-level orchestration for exception escalation, priority SLA queues, deterministic routing, and live takeovers (§14, §16 of CLAUDE.md, docs/kriya WP-4.6).
 */

import { DatabaseClient } from '../../storage/db.js';
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
  BranchRecord,
  CreateBranchInput,
  AttentionRoutingRuleRecord,
  CreateRoutingRuleInput,
} from '../types/attentionTypes.js';
import { AttentionRepository } from '../repositories/attentionRepository.js';
import { BranchRepository } from '../repositories/branchRepository.js';
import { RoutingRuleRepository } from '../repositories/routingRuleRepository.js';
import { AttentionRouter, RoutingDecision } from '../routing/attentionRouter.js';
import { PriorityCalculator } from '../priority/priorityCalculator.js';
import { NotFoundError } from '../../core/errors/errors.js';
import { logger } from '../../core/logger/logger.js';

export class AttentionService {
  private attentionRepo: AttentionRepository;
  private branchRepo: BranchRepository;
  private ruleRepo: RoutingRuleRepository;
  private router: AttentionRouter;

  private client?: DatabaseClient;

  constructor(clientOrRepo?: DatabaseClient | AttentionRepository, attentionRepo?: AttentionRepository) {
    if (clientOrRepo && 'execute' in clientOrRepo && typeof clientOrRepo.execute === 'function') {
      this.client = clientOrRepo;
      this.attentionRepo = attentionRepo || new AttentionRepository(this.client);
    } else {
      this.attentionRepo = (clientOrRepo as AttentionRepository) || new AttentionRepository();
    }
    this.branchRepo = new BranchRepository(this.client);
    this.ruleRepo = new RoutingRuleRepository(this.client);
    this.router = new AttentionRouter(this.client);
  }

  /**
   * Auto-escalates an agent event or policy exception to the human attention center with deterministic routing.
   */
  public async escalateToHuman(request: CreateAttentionItemRequest): Promise<AttentionItemRecord> {
    const priority = PriorityCalculator.calculatePriority({
      reasonCategory: request.reasonCategory,
      financialValueUsd: request.financialValueUsd,
      explicitPriority: request.priority,
    });

    const slaExpiresAt = PriorityCalculator.calculateSlaExpiry(priority);

    // Deterministic Routing (role, branch, hours, emergency bypass)
    const routing = await this.router.route(request, priority);

    const item = await this.attentionRepo.createItem(request, priority, slaExpiresAt, routing);

    logger.warn(
      `[HUMAN ATTENTION] Escalated item '${item.id}' (${priority}) for agent '${request.sourceAgentId}' -> routed to '${routing.assignedRole}' (${routing.reason}): ${request.title}`
    );

    return item;
  }

  /**
   * Idempotent escalation: one item per correlation id, so a resumed or retried run never files it twice.
   */
  public async escalateOnce(request: CreateAttentionItemRequest): Promise<AttentionItemRecord> {
    return (await this.attentionRepo.findByCorrelationId(request.correlationId)) ?? this.escalateToHuman(request);
  }

  /**
   * Explicitly re-routes an attention item.
   */
  public async routeItem(
    itemId: string,
    routing: {
      assignedRole: string;
      assignedUserId?: string | null;
      branchId?: string | null;
      routingRuleId?: string | null;
      afterHours?: number;
      nextAvailableAt?: string | null;
    }
  ): Promise<AttentionItemRecord> {
    const item = await this.attentionRepo.findById(itemId);
    if (!item) throw new NotFoundError(`Attention item '${itemId}' not found.`);

    return this.attentionRepo.routeItem(itemId, routing);
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
    assignedRole?: string;
    branchId?: string;
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

  // ==========================================================================
  // Branch & Routing Rule Management Helpers
  // ==========================================================================

  public async createBranch(input: CreateBranchInput): Promise<BranchRecord> {
    return this.branchRepo.createBranch(input);
  }

  public async listBranches(activeOnly = true): Promise<BranchRecord[]> {
    return this.branchRepo.listBranches(activeOnly);
  }

  public async createRoutingRule(input: CreateRoutingRuleInput): Promise<AttentionRoutingRuleRecord> {
    return this.ruleRepo.createRule(input);
  }

  public async listRoutingRules(): Promise<AttentionRoutingRuleRecord[]> {
    return this.ruleRepo.listActiveRules();
  }
}
