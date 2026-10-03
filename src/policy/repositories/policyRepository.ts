/**
 * Kriya AI — Policy Repository Layer
 * Relational persistence for declarative business policy rules and audit evaluation ledger (§14, §16 of CLAUDE.md).
 */

import { BaseRepository } from '../../storage/repositories/baseRepository.js';
import { DatabaseClient, db } from '../../storage/db.js';
import {
  PolicyRuleRecord,
  PolicyEvaluationRecord,
  PolicyCategory,
  PolicySeverity,
  PolicyAction,
  ConditionExpression,
} from '../types/policyTypes.js';
import { CryptoUtils } from '../../core/utils/crypto.js';

export class PolicyRuleRepository {
  private client: DatabaseClient;

  constructor(client?: DatabaseClient) {
    this.client = client || db.getClient();
  }

  public async saveRule(params: {
    tenantId?: string | null;
    slug: string;
    name: string;
    description: string;
    category: PolicyCategory;
    severity: PolicySeverity;
    action: PolicyAction;
    condition: ConditionExpression;
    isEnabled?: boolean;
    isSystem?: boolean;
  }): Promise<PolicyRuleRecord> {
    const existing = await this.findBySlug(params.slug, params.tenantId);
    const now = new Date().toISOString();
    const tenantId = params.tenantId || null;

    if (existing) {
      const sql = `
        UPDATE policy_rules
        SET name = ?, description = ?, category = ?, severity = ?, action = ?,
            condition_json = ?, is_enabled = ?, is_system = ?, updated_at = ?
        WHERE id = ?
        RETURNING *;
      `;
      const rows = await this.client.query<PolicyRuleRecord>(sql, [
        params.name,
        params.description,
        params.category,
        params.severity,
        params.action,
        JSON.stringify(params.condition),
        params.isEnabled !== false ? 1 : 0,
        params.isSystem ? 1 : 0,
        now,
        existing.id,
      ]);
      return rows[0];
    }

    const id = CryptoUtils.generateId();
    const sql = `
      INSERT INTO policy_rules (
        id, tenant_id, slug, name, description, category, severity, action,
        condition_json, is_enabled, is_system, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING *;
    `;
    const rows = await this.client.query<PolicyRuleRecord>(sql, [
      id,
      tenantId,
      params.slug,
      params.name,
      params.description,
      params.category,
      params.severity,
      params.action,
      JSON.stringify(params.condition),
      params.isEnabled !== false ? 1 : 0,
      params.isSystem ? 1 : 0,
      now,
      now,
    ]);
    return rows[0];
  }

  public async findBySlug(slug: string, tenantId?: string | null): Promise<PolicyRuleRecord | null> {
    if (tenantId) {
      // First check tenant-specific override
      const tenantSql = `SELECT * FROM policy_rules WHERE tenant_id = ? AND slug = ? LIMIT 1;`;
      const tenantRows = await this.client.query<PolicyRuleRecord>(tenantSql, [tenantId, slug]);
      if (tenantRows.length > 0) return tenantRows[0];
    }

    // Check system global rule (tenant_id IS NULL)
    const globalSql = `SELECT * FROM policy_rules WHERE tenant_id IS NULL AND slug = ? LIMIT 1;`;
    const globalRows = await this.client.query<PolicyRuleRecord>(globalSql, [slug]);
    return globalRows[0] || null;
  }

  public async listActiveRules(tenantId?: string | null, category?: PolicyCategory): Promise<PolicyRuleRecord[]> {
    let sql: string;
    let params: any[];

    if (tenantId) {
      if (category) {
        sql = `
          SELECT * FROM policy_rules
          WHERE (tenant_id = ? OR tenant_id IS NULL)
            AND category = ?
            AND is_enabled = 1
          ORDER BY tenant_id DESC, slug ASC;
        `;
        params = [tenantId, category];
      } else {
        sql = `
          SELECT * FROM policy_rules
          WHERE (tenant_id = ? OR tenant_id IS NULL)
            AND is_enabled = 1
          ORDER BY tenant_id DESC, slug ASC;
        `;
        params = [tenantId];
      }
    } else {
      if (category) {
        sql = `SELECT * FROM policy_rules WHERE tenant_id IS NULL AND category = ? AND is_enabled = 1 ORDER BY slug ASC;`;
        params = [category];
      } else {
        sql = `SELECT * FROM policy_rules WHERE tenant_id IS NULL AND is_enabled = 1 ORDER BY slug ASC;`;
        params = [];
      }
    }

    const rows = await this.client.query<PolicyRuleRecord>(sql, params);

    // Deduplicate by slug (preferring tenant-specific overrides over global defaults)
    const seen = new Set<string>();
    const result: PolicyRuleRecord[] = [];

    for (const rule of rows) {
      if (!seen.has(rule.slug)) {
        seen.add(rule.slug);
        result.push(rule);
      }
    }

    return result;
  }

  public async deleteRule(slug: string, tenantId?: string | null): Promise<boolean> {
    if (tenantId) {
      const sql = `DELETE FROM policy_rules WHERE tenant_id = ? AND slug = ?;`;
      const res = await this.client.execute(sql, [tenantId, slug]);
      return res.changes > 0;
    }
    const sql = `DELETE FROM policy_rules WHERE tenant_id IS NULL AND slug = ?;`;
    const res = await this.client.execute(sql, [slug]);
    return res.changes > 0;
  }
}

export class PolicyEvaluationRepository extends BaseRepository<PolicyEvaluationRecord> {
  protected readonly tableName = 'policy_evaluations';

  constructor(client?: DatabaseClient) {
    super(client);
  }

  public async recordEvaluation(params: {
    actionType: string;
    resourceId?: string;
    actorType: 'agent' | 'user' | 'system';
    actorId?: string;
    evaluationResult: 'PASS' | 'WARN' | 'BLOCKED' | 'ESCALATED';
    violations: Array<Record<string, unknown>>;
    contextSnapshot: Record<string, unknown>;
  }): Promise<PolicyEvaluationRecord> {
    return this.create({
      action_type: params.actionType,
      resource_id: params.resourceId || null,
      actor_type: params.actorType,
      actor_id: params.actorId || null,
      evaluation_result: params.evaluationResult,
      violations_json: JSON.stringify(params.violations),
      context_snapshot_json: JSON.stringify(params.contextSnapshot),
    });
  }

  public async listRecent(limit: number = 50, resultFilter?: string): Promise<PolicyEvaluationRecord[]> {
    const tenantId = this.getTenantId();
    if (resultFilter) {
      const sql = `
        SELECT * FROM policy_evaluations
        WHERE tenant_id = ? AND evaluation_result = ?
        ORDER BY created_at DESC
        LIMIT ?;
      `;
      return this.client.query<PolicyEvaluationRecord>(sql, [tenantId, resultFilter, limit]);
    }

    const sql = `
      SELECT * FROM policy_evaluations
      WHERE tenant_id = ?
      ORDER BY created_at DESC
      LIMIT ?;
    `;
    return this.client.query<PolicyEvaluationRecord>(sql, [tenantId, limit]);
  }
}
