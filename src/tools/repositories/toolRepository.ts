/**
 * Xylarc AI — Tool Gateway & Credential Repositories
 * Relational data layer for encrypted credentials, tool definitions, scoped permissions, and execution audit logging.
 */

import { BaseRepository } from '../../storage/repositories/baseRepository.js';
import { DatabaseClient, db } from '../../storage/db.js';
import {
  TenantCredentialRecord,
  ToolDefinitionRecord,
  ToolPermissionRecord,
  ToolExecutionRecord,
  ToolCategory,
  ToolExecutionStatus,
} from '../types/toolTypes.js';
import { RiskTier } from '../../agents/types/agentTypes.js';
import { CryptoUtils } from '../../core/utils/crypto.js';

export class CredentialRepository extends BaseRepository<TenantCredentialRecord> {
  protected readonly tableName = 'tenant_credentials';

  constructor(client?: DatabaseClient) {
    super(client);
  }

  public async saveCredential(params: {
    serviceSlug: string;
    name: string;
    encryptedData: string;
    iv: string;
    tag: string;
    metadata?: Record<string, unknown>;
  }): Promise<TenantCredentialRecord> {
    const tenantId = this.getTenantId();
    const existing = await this.findByServiceSlug(params.serviceSlug);

    if (existing) {
      return this.update(existing.id, {
        name: params.name,
        encrypted_data: params.encryptedData,
        iv: params.iv,
        tag: params.tag,
        metadata_json: JSON.stringify(params.metadata || {}),
      });
    }

    return this.create({
      service_slug: params.serviceSlug,
      name: params.name,
      encrypted_data: params.encryptedData,
      iv: params.iv,
      tag: params.tag,
      metadata_json: JSON.stringify(params.metadata || {}),
    });
  }

  public async findByServiceSlug(serviceSlug: string): Promise<TenantCredentialRecord | null> {
    const tenantId = this.getTenantId();
    const sql = `SELECT * FROM tenant_credentials WHERE tenant_id = ? AND service_slug = ? LIMIT 1;`;
    const rows = await this.client.query<TenantCredentialRecord>(sql, [tenantId, serviceSlug]);
    return rows[0] || null;
  }

  public async listCredentials(): Promise<Array<Omit<TenantCredentialRecord, 'encrypted_data' | 'iv' | 'tag'>>> {
    const tenantId = this.getTenantId();
    const sql = `
      SELECT id, tenant_id, service_slug, name, metadata_json, created_at, updated_at
      FROM tenant_credentials
      WHERE tenant_id = ?
      ORDER BY service_slug ASC;
    `;
    return this.client.query(sql, [tenantId]);
  }

  public async deleteByServiceSlug(serviceSlug: string): Promise<boolean> {
    const tenantId = this.getTenantId();
    const sql = `DELETE FROM tenant_credentials WHERE tenant_id = ? AND service_slug = ?;`;
    const res = await this.client.execute(sql, [tenantId, serviceSlug]);
    return res.changes > 0;
  }
}

export class ToolDefinitionRepository {
  private client: DatabaseClient;

  constructor(client?: DatabaseClient) {
    this.client = client || db.getClient();
  }

  public async upsertTool(tool: {
    slug: string;
    name: string;
    description: string;
    category: ToolCategory;
    riskTier: RiskTier;
    requiresApproval: boolean;
    inputSchema?: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
    isSystem?: boolean;
  }): Promise<ToolDefinitionRecord> {
    const existing = await this.findBySlug(tool.slug);
    const now = new Date().toISOString();

    if (existing) {
      const sql = `
        UPDATE tool_definitions
        SET name = ?, description = ?, category = ?, risk_tier = ?, requires_approval = ?,
            input_schema_json = ?, output_schema_json = ?, is_system = ?, updated_at = ?
        WHERE slug = ?
        RETURNING *;
      `;
      const rows = await this.client.query<ToolDefinitionRecord>(sql, [
        tool.name,
        tool.description,
        tool.category,
        tool.riskTier,
        tool.requiresApproval ? 1 : 0,
        JSON.stringify(tool.inputSchema || {}),
        JSON.stringify(tool.outputSchema || {}),
        tool.isSystem !== false ? 1 : 0,
        now,
        tool.slug,
      ]);
      return rows[0];
    }

    const id = CryptoUtils.generateId();
    const sql = `
      INSERT INTO tool_definitions (
        id, slug, name, description, category, risk_tier, requires_approval,
        input_schema_json, output_schema_json, is_system, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING *;
    `;
    const rows = await this.client.query<ToolDefinitionRecord>(sql, [
      id,
      tool.slug,
      tool.name,
      tool.description,
      tool.category,
      tool.riskTier,
      tool.requiresApproval ? 1 : 0,
      JSON.stringify(tool.inputSchema || {}),
      JSON.stringify(tool.outputSchema || {}),
      tool.isSystem !== false ? 1 : 0,
      now,
      now,
    ]);
    return rows[0];
  }

  public async findBySlug(slug: string): Promise<ToolDefinitionRecord | null> {
    const sql = `SELECT * FROM tool_definitions WHERE slug = ? LIMIT 1;`;
    const rows = await this.client.query<ToolDefinitionRecord>(sql, [slug]);
    return rows[0] || null;
  }

  public async listTools(category?: ToolCategory): Promise<ToolDefinitionRecord[]> {
    if (category) {
      const sql = `SELECT * FROM tool_definitions WHERE category = ? ORDER BY slug ASC;`;
      return this.client.query<ToolDefinitionRecord>(sql, [category]);
    }
    const sql = `SELECT * FROM tool_definitions ORDER BY category ASC, slug ASC;`;
    return this.client.query<ToolDefinitionRecord>(sql);
  }
}

export class ToolPermissionRepository extends BaseRepository<ToolPermissionRecord> {
  protected readonly tableName = 'tool_permissions';

  constructor(client?: DatabaseClient) {
    super(client);
  }

  public async findPermission(toolSlug: string, agentId?: string): Promise<ToolPermissionRecord | null> {
    const tenantId = this.getTenantId();
    // 1. Check agent-specific permission if agentId is provided
    if (agentId) {
      const agentSql = `
        SELECT * FROM tool_permissions
        WHERE tenant_id = ? AND agent_id = ? AND tool_slug = ?
        LIMIT 1;
      `;
      const agentRows = await this.client.query<ToolPermissionRecord>(agentSql, [tenantId, agentId, toolSlug]);
      if (agentRows.length > 0) return agentRows[0];
    }

    // 2. Check tenant-wide policy (agent_id IS NULL)
    const tenantSql = `
      SELECT * FROM tool_permissions
      WHERE tenant_id = ? AND agent_id IS NULL AND tool_slug = ?
      LIMIT 1;
    `;
    const tenantRows = await this.client.query<ToolPermissionRecord>(tenantSql, [tenantId, toolSlug]);
    return tenantRows[0] || null;
  }

  public async setPermission(params: {
    toolSlug: string;
    agentId?: string;
    isEnabled: boolean;
    dailyQuotaLimit?: number;
  }): Promise<ToolPermissionRecord> {
    const tenantId = this.getTenantId();
    const existing = await this.findPermission(params.toolSlug, params.agentId);

    if (existing) {
      return this.update(existing.id, {
        is_enabled: params.isEnabled ? 1 : 0,
        daily_quota_limit: params.dailyQuotaLimit ?? existing.daily_quota_limit,
      });
    }

    return this.create({
      agent_id: params.agentId || null,
      tool_slug: params.toolSlug,
      is_enabled: params.isEnabled ? 1 : 0,
      daily_quota_limit: params.dailyQuotaLimit ?? 1000,
      daily_invocation_count: 0,
      last_invoked_at: null,
    });
  }

  public async recordInvocation(permissionId: string): Promise<void> {
    const now = new Date().toISOString();
    const sql = `
      UPDATE tool_permissions
      SET daily_invocation_count = daily_invocation_count + 1,
          last_invoked_at = ?,
          updated_at = ?
      WHERE id = ?;
    `;
    await this.client.execute(sql, [now, now, permissionId]);
  }
}

export class ToolExecutionRepository extends BaseRepository<ToolExecutionRecord> {
  protected readonly tableName = 'tool_executions';

  constructor(client?: DatabaseClient) {
    super(client);
  }

  public async findByIdempotencyKey(idempotencyKey: string): Promise<ToolExecutionRecord | null> {
    const tenantId = this.getTenantId();
    const sql = `SELECT * FROM tool_executions WHERE tenant_id = ? AND idempotency_key = ? LIMIT 1;`;
    const rows = await this.client.query<ToolExecutionRecord>(sql, [tenantId, idempotencyKey]);
    return rows[0] || null;
  }

  public async recordExecutionStart(params: {
    toolSlug: string;
    agentId?: string;
    idempotencyKey?: string;
    riskTier: RiskTier;
    input: Record<string, unknown>;
    callerIp?: string;
    correlationId?: string;
  }): Promise<ToolExecutionRecord> {
    return this.create({
      tool_slug: params.toolSlug,
      agent_id: params.agentId || null,
      idempotency_key: params.idempotencyKey || null,
      risk_tier: params.riskTier,
      status: 'executing',
      input_json: JSON.stringify(params.input),
      output_json: null,
      error_message: null,
      duration_ms: 0,
      caller_ip: params.callerIp || null,
      correlation_id: params.correlationId || null,
    });
  }

  public async recordExecutionComplete(params: {
    executionId: string;
    status: ToolExecutionStatus;
    output?: Record<string, unknown>;
    errorMessage?: string;
    durationMs: number;
  }): Promise<ToolExecutionRecord> {
    return this.update(params.executionId, {
      status: params.status,
      output_json: params.output ? JSON.stringify(params.output) : null,
      error_message: params.errorMessage || null,
      duration_ms: params.durationMs,
    });
  }

  public async listRecent(limit: number = 50, toolSlug?: string): Promise<ToolExecutionRecord[]> {
    const tenantId = this.getTenantId();
    if (toolSlug) {
      const sql = `
        SELECT * FROM tool_executions
        WHERE tenant_id = ? AND tool_slug = ?
        ORDER BY created_at DESC
        LIMIT ?;
      `;
      return this.client.query<ToolExecutionRecord>(sql, [tenantId, toolSlug, limit]);
    }

    const sql = `
      SELECT * FROM tool_executions
      WHERE tenant_id = ?
      ORDER BY created_at DESC
      LIMIT ?;
    `;
    return this.client.query<ToolExecutionRecord>(sql, [tenantId, limit]);
  }
}
