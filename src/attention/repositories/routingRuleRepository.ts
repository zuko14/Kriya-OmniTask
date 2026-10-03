/**
 * Kriya AI — Attention Routing Rules Relational Repository
 * Persistence and ordering for human routing matrix rules (§14 of CLAUDE.md, docs/kriya WP-4.6).
 */

import { BaseRepository } from '../../storage/repositories/baseRepository.js';
import { DatabaseClient } from '../../storage/db.js';
import {
  AttentionRoutingRuleRecord,
  CreateRoutingRuleInput,
  CreateRoutingRuleSchema,
} from '../types/attentionTypes.js';
import { CryptoUtils } from '../../core/utils/crypto.js';
import { NotFoundError } from '../../core/errors/errors.js';

export class RoutingRuleRepository extends BaseRepository<AttentionRoutingRuleRecord> {
  protected readonly tableName = 'attention_routing_rules';

  constructor(client?: DatabaseClient) {
    super(client);
  }

  /**
   * Creates a new attention routing rule.
   */
  public async createRule(input: CreateRoutingRuleInput): Promise<AttentionRoutingRuleRecord> {
    const validated = CreateRoutingRuleSchema.parse(input);
    const tenantId = this.getTenantId();
    const id = CryptoUtils.generateId();
    const now = new Date().toISOString();

    const record: AttentionRoutingRuleRecord = {
      id,
      tenant_id: tenantId,
      name: validated.name,
      priority_order: validated.priorityOrder,
      conditions_json: JSON.stringify(validated.conditions),
      target_role: validated.targetRole,
      target_user_id: validated.targetUserId || null,
      branch_id: validated.branchId || null,
      active: 1,
      created_at: now,
      updated_at: now,
    };

    await this.client.execute(
      `INSERT INTO attention_routing_rules (
        id, tenant_id, name, priority_order, conditions_json, target_role, target_user_id, branch_id, active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        record.id,
        record.tenant_id,
        record.name,
        record.priority_order,
        record.conditions_json,
        record.target_role,
        record.target_user_id,
        record.branch_id,
        record.active,
        record.created_at,
        record.updated_at,
      ]
    );

    return record;
  }

  /**
   * Updates an existing routing rule.
   */
  public async updateRule(
    id: string,
    updates: Partial<CreateRoutingRuleInput> & { active?: number }
  ): Promise<AttentionRoutingRuleRecord> {
    const tenantId = this.getTenantId();
    const existing = await this.findById(id);
    if (!existing) throw new NotFoundError(`Routing rule '${id}' not found.`);

    const now = new Date().toISOString();
    const updated = {
      name: updates.name ?? existing.name,
      priority_order: updates.priorityOrder !== undefined ? updates.priorityOrder : existing.priority_order,
      conditions_json: updates.conditions ? JSON.stringify(updates.conditions) : existing.conditions_json,
      target_role: updates.targetRole ?? existing.target_role,
      target_user_id: updates.targetUserId !== undefined ? updates.targetUserId : existing.target_user_id,
      branch_id: updates.branchId !== undefined ? updates.branchId : existing.branch_id,
      active: updates.active !== undefined ? updates.active : existing.active,
    };

    await this.client.execute(
      `UPDATE attention_routing_rules SET
        name = ?, priority_order = ?, conditions_json = ?, target_role = ?, target_user_id = ?, branch_id = ?, active = ?, updated_at = ?
       WHERE id = ? AND tenant_id = ?;`,
      [
        updated.name,
        updated.priority_order,
        updated.conditions_json,
        updated.target_role,
        updated.target_user_id,
        updated.branch_id,
        updated.active,
        now,
        id,
        tenantId,
      ]
    );

    return (await this.findById(id))!;
  }

  /**
   * Retrieves active routing rules ordered by priority (lowest number = highest priority).
   */
  public async listActiveRules(): Promise<AttentionRoutingRuleRecord[]> {
    const tenantId = this.getTenantId();
    return this.client.query<AttentionRoutingRuleRecord>(
      'SELECT * FROM attention_routing_rules WHERE tenant_id = ? AND active = 1 ORDER BY priority_order ASC, created_at ASC;',
      [tenantId]
    );
  }

  /**
   * Deactivates or removes a routing rule.
   */
  public async deleteRule(id: string): Promise<boolean> {
    const tenantId = this.getTenantId();
    const res = await this.client.execute(
      'DELETE FROM attention_routing_rules WHERE id = ? AND tenant_id = ?;',
      [id, tenantId]
    );
    return res.changes > 0;
  }
}
