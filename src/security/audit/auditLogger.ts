/**
 * Kriya AI — Immutable Audit Ledger & Event Recorder
 * Records all security-relevant, administrative, and agent execution events
 * with cryptographic actor attribution and correlation tracking.
 */

import { DatabaseClient, db } from '../../storage/db.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';
import { CryptoUtils } from '../../core/utils/crypto.js';
import { logger } from '../../core/logger/logger.js';
import { config } from '../../core/config/config.js';

export interface AuditLogEntry {
  id: string;
  tenant_id: string;
  organization_id?: string;
  workspace_id?: string;
  user_id?: string;
  correlation_id: string;
  action: string;
  resource_type: string;
  resource_id?: string;
  details_json: string;
  ip_address?: string;
  created_at: string;
}

export class AuditLogger {
  private customClient?: DatabaseClient;

  constructor(client?: DatabaseClient) {
    this.customClient = client;
  }

  private get client(): DatabaseClient {
    return this.customClient || db.getClient();
  }

  /**
   * Appends an immutable audit event to the ledger.
   */
  public async logEvent(params: {
    action: string;
    resourceType: string;
    resourceId?: string;
    details?: Record<string, unknown>;
    ipAddress?: string;
    overrideTenantId?: string;
  }): Promise<AuditLogEntry | null> {
    if (!config.get('ENABLE_AUDIT_LOGGING')) {
      return null;
    }

    const tenantCtx = TenantContextManager.get();
    const tenantId = params.overrideTenantId || tenantCtx?.tenantId;

    if (!tenantId) {
      logger.warn('Audit log skipped: No tenant context or override provided.', { action: params.action });
      return null;
    }

    const now = new Date().toISOString();
    const id = CryptoUtils.generateId();
    const correlationId = tenantCtx?.correlationId || CryptoUtils.generateId();
    const detailsJson = JSON.stringify(params.details || {});

    const entry: AuditLogEntry = {
      id,
      tenant_id: tenantId,
      organization_id: tenantCtx?.organizationId,
      workspace_id: tenantCtx?.workspaceId,
      user_id: tenantCtx?.userId,
      correlation_id: correlationId,
      action: params.action,
      resource_type: params.resourceType,
      resource_id: params.resourceId,
      details_json: detailsJson,
      ip_address: params.ipAddress,
      created_at: now,
    };

    try {
      await this.client.execute(
        `INSERT INTO audit_logs (
          id, tenant_id, organization_id, workspace_id, user_id,
          correlation_id, action, resource_type, resource_id, details_json,
          ip_address, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        [
          entry.id,
          entry.tenant_id,
          entry.organization_id || null,
          entry.workspace_id || null,
          entry.user_id || null,
          entry.correlation_id,
          entry.action,
          entry.resource_type,
          entry.resource_id || null,
          entry.details_json,
          entry.ip_address || null,
          entry.created_at,
        ]
      );

      logger.debug(`Audit event recorded: ${entry.action}`, {
        resourceType: entry.resource_type,
        resourceId: entry.resource_id,
      });

      return entry;
    } catch (err) {
      logger.error('Failed to write audit log entry', err, { action: params.action });
      return null;
    }
  }

  /**
   * Retrieves audit logs for the active tenant.
   */
  public async getLogsForTenant(filters: {
    action?: string;
    resourceType?: string;
    resourceId?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<AuditLogEntry[]> {
    const tenantCtx = TenantContextManager.getRequired();
    const whereClauses = ['tenant_id = ?'];
    const params: unknown[] = [tenantCtx.tenantId];

    if (filters.action) {
      whereClauses.push('action = ?');
      params.push(filters.action);
    }
    if (filters.resourceType) {
      whereClauses.push('resource_type = ?');
      params.push(filters.resourceType);
    }
    if (filters.resourceId) {
      whereClauses.push('resource_id = ?');
      params.push(filters.resourceId);
    }

    const limit = Math.min(filters.limit || 50, 200);
    const offset = filters.offset || 0;

    const sql = `
      SELECT * FROM audit_logs
      WHERE ${whereClauses.join(' AND ')}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset};
    `;

    return this.client.query<AuditLogEntry>(sql, params);
  }
}

export const auditLogger = new AuditLogger();
