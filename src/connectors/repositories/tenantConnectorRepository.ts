/**
 * Kriya Omnitask — Tenant Connector Repository (WP-5.4)
 * Multi-tenant repository managing third-party connector configurations.
 */

import { DatabaseClient, db } from '../../storage/db.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';
import { CryptoUtils } from '../../core/utils/crypto.js';
import { ConflictError, NotFoundError } from '../../core/errors/errors.js';
import {
  TenantConnectorRecord,
  RegisterConnectorInput,
  ConnectorStatus,
  ConnectorCategory,
} from '../types/connectorTypes.js';

export class TenantConnectorRepository {
  constructor(private readonly customClient?: DatabaseClient) {}

  private get client(): DatabaseClient {
    return this.customClient ?? db.getClient();
  }

  private tenant(): string {
    return TenantContextManager.getTenantId();
  }

  public async registerConnector(input: RegisterConnectorInput): Promise<TenantConnectorRecord> {
    const tenantId = this.tenant();
    const id = `conn_${CryptoUtils.generateId()}`;
    const now = new Date().toISOString();
    const settingsJson = JSON.stringify(input.settings ?? {});

    const existing = await this.client.queryOne<TenantConnectorRecord>(
      'SELECT id FROM tenant_connectors WHERE tenant_id = ? AND provider = ? AND name = ?',
      [tenantId, input.provider, input.name]
    );

    if (existing) {
      throw new ConflictError(
        `Connector with provider '${input.provider}' and name '${input.name}' already exists for this tenant.`
      );
    }

    await this.client.execute(
      `INSERT INTO tenant_connectors 
         (id, tenant_id, provider, category, name, status, credential_slug, settings_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
      [id, tenantId, input.provider, input.category, input.name, input.credentialSlug, settingsJson, now, now]
    );

    return (await this.getConnector(id))!;
  }

  public async getConnector(id: string): Promise<TenantConnectorRecord | null> {
    return this.client.queryOne<TenantConnectorRecord>(
      'SELECT * FROM tenant_connectors WHERE id = ? AND tenant_id = ?',
      [id, this.tenant()]
    );
  }

  public async findByProvider(provider: string): Promise<TenantConnectorRecord[]> {
    return this.client.query<TenantConnectorRecord>(
      'SELECT * FROM tenant_connectors WHERE tenant_id = ? AND provider = ? ORDER BY created_at ASC',
      [this.tenant(), provider]
    );
  }

  public async findByCategory(category: ConnectorCategory): Promise<TenantConnectorRecord[]> {
    return this.client.query<TenantConnectorRecord>(
      'SELECT * FROM tenant_connectors WHERE tenant_id = ? AND category = ? ORDER BY created_at ASC',
      [this.tenant(), category]
    );
  }

  public async listConnectors(): Promise<TenantConnectorRecord[]> {
    return this.client.query<TenantConnectorRecord>(
      'SELECT * FROM tenant_connectors WHERE tenant_id = ? ORDER BY created_at ASC',
      [this.tenant()]
    );
  }

  public async updateStatus(id: string, status: ConnectorStatus, errorMessage?: string | null): Promise<void> {
    const now = new Date().toISOString();
    await this.client.execute(
      'UPDATE tenant_connectors SET status = ?, error_message = ?, updated_at = ? WHERE id = ? AND tenant_id = ?',
      [status, errorMessage ?? null, now, id, this.tenant()]
    );
  }

  public async updateLastSynced(id: string, timestamp?: string): Promise<void> {
    const ts = timestamp ?? new Date().toISOString();
    await this.client.execute(
      'UPDATE tenant_connectors SET last_synced_at = ?, updated_at = ? WHERE id = ? AND tenant_id = ?',
      [ts, ts, id, this.tenant()]
    );
  }

  public async deleteConnector(id: string): Promise<void> {
    const res = await this.client.execute(
      'DELETE FROM tenant_connectors WHERE id = ? AND tenant_id = ?',
      [id, this.tenant()]
    );
    if (res.changes === 0) {
      throw new NotFoundError(`Connector '${id}' not found for this tenant.`);
    }
  }
}
