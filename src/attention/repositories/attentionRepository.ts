/**
 * Xylarc AI — Human Attention Items & Takeovers Relational Repository
 * Persistence for exception items, SLAs, and conversation overrides (§14, §16 of CLAUDE.md).
 */

import { BaseRepository } from '../../storage/repositories/baseRepository.js';
import { DatabaseClient } from '../../storage/db.js';
import {
  AttentionItemRecord,
  ConversationTakeoverRecord,
  CreateAttentionItemRequest,
  AttentionPriority,
  AttentionStatus,
  AttentionReasonCategory,
  ResolutionAction,
  AttentionMetricsOverview,
} from '../types/attentionTypes.js';
import { CryptoUtils } from '../../core/utils/crypto.js';

export class AttentionRepository extends BaseRepository<AttentionItemRecord> {
  protected readonly tableName = 'attention_items';

  constructor(client?: DatabaseClient) {
    super(client);
  }

  /**
   * Creates a new attention item in the priority queue.
   */
  public async createItem(
    request: CreateAttentionItemRequest,
    priority: AttentionPriority,
    slaExpiresAt: string
  ): Promise<AttentionItemRecord> {
    const tenantId = this.getTenantId();
    const id = CryptoUtils.generateId();
    const now = new Date().toISOString();

    const record: AttentionItemRecord = {
      id,
      tenant_id: tenantId,
      organization_id: 'default',
      correlation_id: request.correlationId || CryptoUtils.generateCorrelationId(),
      trace_id: request.traceId,
      customer_id: request.customerId,
      channel: request.channel || 'whatsapp',
      source_agent_id: request.sourceAgentId,
      title: request.title,
      description: request.description,
      reason_category: request.reasonCategory,
      priority,
      status: 'pending',
      context_data_json: JSON.stringify(request.contextData || {}),
      recommended_action: request.recommendedAction,
      sla_expires_at: slaExpiresAt,
      created_at: now,
      updated_at: now,
    };

    await this.client.execute(
      `INSERT INTO attention_items (
        id, tenant_id, organization_id, correlation_id, trace_id, customer_id,
        channel, source_agent_id, title, description, reason_category, priority,
        status, context_data_json, recommended_action, sla_expires_at,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        record.id,
        record.tenant_id,
        record.organization_id,
        record.correlation_id,
        record.trace_id || null,
        record.customer_id || null,
        record.channel,
        record.source_agent_id,
        record.title,
        record.description,
        record.reason_category,
        record.priority,
        record.status,
        record.context_data_json,
        record.recommended_action || null,
        record.sla_expires_at,
        record.created_at,
        record.updated_at,
      ]
    );

    return record;
  }

  /**
   * Claims an attention item by a human operator.
   */
  public async claimItem(itemId: string, userId: string): Promise<AttentionItemRecord> {
    const tenantId = this.getTenantId();
    const now = new Date().toISOString();

    await this.client.execute(
      `UPDATE attention_items SET
        status = 'claimed',
        assigned_user_id = ?,
        updated_at = ?
       WHERE id = ? AND tenant_id = ?;`,
      [userId, now, itemId, tenantId]
    );

    return (await this.findById(itemId))!;
  }

  /**
   * Resolves an attention item with a human decision.
   */
  public async resolveItem(params: {
    itemId: string;
    action: ResolutionAction;
    notes?: string;
  }): Promise<AttentionItemRecord> {
    const tenantId = this.getTenantId();
    const now = new Date().toISOString();

    await this.client.execute(
      `UPDATE attention_items SET
        status = 'resolved',
        resolution_action = ?,
        resolution_notes = ?,
        resolved_at = ?,
        updated_at = ?
       WHERE id = ? AND tenant_id = ?;`,
      [params.action, params.notes || null, now, now, params.itemId, tenantId]
    );

    return (await this.findById(params.itemId))!;
  }

  /**
   * Lists attention items with optional filtering.
   */
  public async listItems(filter?: {
    status?: AttentionStatus;
    priority?: AttentionPriority;
    reasonCategory?: AttentionReasonCategory;
    assignedUserId?: string;
    limit?: number;
  }): Promise<AttentionItemRecord[]> {
    const tenantId = this.getTenantId();
    let sql = 'SELECT * FROM attention_items WHERE tenant_id = ?';
    const params: unknown[] = [tenantId];

    if (filter?.status) {
      sql += ' AND status = ?';
      params.push(filter.status);
    }
    if (filter?.priority) {
      sql += ' AND priority = ?';
      params.push(filter.priority);
    }
    if (filter?.reasonCategory) {
      sql += ' AND reason_category = ?';
      params.push(filter.reasonCategory);
    }
    if (filter?.assignedUserId) {
      sql += ' AND assigned_user_id = ?';
      params.push(filter.assignedUserId);
    }

    // Order by priority (P0 first) and SLA expiration
    sql += ` ORDER BY 
      CASE priority 
        WHEN 'P0_CRITICAL' THEN 1 
        WHEN 'P1_HIGH' THEN 2 
        WHEN 'P2_MEDIUM' THEN 3 
        WHEN 'P3_LOW' THEN 4 
        ELSE 5 
      END ASC,
      sla_expires_at ASC
      LIMIT ?;`;
    params.push(filter?.limit || 50);

    return this.client.query<AttentionItemRecord>(sql, params);
  }

  /**
   * Starts a human live takeover for a customer conversation.
   */
  public async startTakeover(params: {
    customerId: string;
    channel: string;
    userId: string;
    reason: string;
  }): Promise<ConversationTakeoverRecord> {
    const tenantId = this.getTenantId();
    const id = CryptoUtils.generateId();
    const now = new Date().toISOString();

    // Deactivate any existing active takeover for this customer
    await this.client.execute(
      `UPDATE conversation_takeovers SET is_active = 0, ended_at = ?, updated_at = ? WHERE tenant_id = ? AND customer_id = ? AND is_active = 1;`,
      [now, now, tenantId, params.customerId]
    );

    const record: ConversationTakeoverRecord = {
      id,
      tenant_id: tenantId,
      organization_id: 'default',
      customer_id: params.customerId,
      channel: params.channel,
      taken_over_by_user_id: params.userId,
      is_active: 1,
      reason: params.reason,
      started_at: now,
      created_at: now,
      updated_at: now,
    };

    await this.client.execute(
      `INSERT INTO conversation_takeovers (
        id, tenant_id, organization_id, customer_id, channel,
        taken_over_by_user_id, is_active, reason, started_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        record.id,
        record.tenant_id,
        record.organization_id,
        record.customer_id,
        record.channel,
        record.taken_over_by_user_id,
        1,
        record.reason,
        record.started_at,
        record.created_at,
        record.updated_at,
      ]
    );

    return record;
  }

  /**
   * Ends human takeover and hands conversation back to AI agents.
   */
  public async handbackTakeover(customerId: string): Promise<boolean> {
    const tenantId = this.getTenantId();
    const now = new Date().toISOString();

    const res = await this.client.execute(
      `UPDATE conversation_takeovers SET is_active = 0, ended_at = ?, updated_at = ? WHERE tenant_id = ? AND customer_id = ? AND is_active = 1;`,
      [now, now, tenantId, customerId]
    );

    return res.changes > 0;
  }

  /**
   * Checks if customer conversation is currently under active human takeover.
   */
  public async isCustomerUnderTakeover(customerId: string): Promise<boolean> {
    const tenantId = this.getTenantId();
    const rows = await this.client.query<ConversationTakeoverRecord>(
      'SELECT id FROM conversation_takeovers WHERE tenant_id = ? AND customer_id = ? AND is_active = 1 LIMIT 1;',
      [tenantId, customerId]
    );
    return rows.length > 0;
  }

  /**
   * Aggregates metrics overview for the attention center.
   */
  public async getMetricsOverview(): Promise<AttentionMetricsOverview> {
    const tenantId = this.getTenantId();
    const now = new Date().toISOString();

    const items = await this.client.query<AttentionItemRecord>(
      'SELECT * FROM attention_items WHERE tenant_id = ?;',
      [tenantId]
    );

    const activeTakeovers = await this.client.query<ConversationTakeoverRecord>(
      'SELECT id FROM conversation_takeovers WHERE tenant_id = ? AND is_active = 1;',
      [tenantId]
    );

    if (items.length === 0) {
      return {
        totalItems: 0,
        pendingCount: 0,
        claimedCount: 0,
        resolvedCount: 0,
        slaBreachCount: 0,
        activeTakeoversCount: activeTakeovers.length,
        avgResolutionMinutes: 0,
      };
    }

    const totalItems = items.length;
    const pendingCount = items.filter((i) => i.status === 'pending').length;
    const claimedCount = items.filter((i) => i.status === 'claimed').length;
    const resolvedCount = items.filter((i) => i.status === 'resolved').length;

    // SLA breach: pending or claimed where current time > sla_expires_at
    const slaBreachCount = items.filter(
      (i) => (i.status === 'pending' || i.status === 'claimed') && i.sla_expires_at < now
    ).length;

    // Avg resolution time for resolved items
    const resolvedItems = items.filter((i) => i.status === 'resolved' && i.resolved_at);
    let totalMinutes = 0;
    for (const item of resolvedItems) {
      const created = new Date(item.created_at).getTime();
      const resolved = new Date(item.resolved_at!).getTime();
      totalMinutes += Math.max(0, Math.round((resolved - created) / (1000 * 60)));
    }

    const avgResolutionMinutes =
      resolvedItems.length > 0 ? Math.round(totalMinutes / resolvedItems.length) : 0;

    return {
      totalItems,
      pendingCount,
      claimedCount,
      resolvedCount,
      slaBreachCount,
      activeTakeoversCount: activeTakeovers.length,
      avgResolutionMinutes,
    };
  }
}
