/**
 * Xylarc AI — Tenant Repository
 * Manages tenant life cycles, plans, and configuration state.
 */

import { DatabaseClient, db } from '../db.js';
import { CryptoUtils } from '../../core/utils/crypto.js';
import { NotFoundError } from '../../core/errors/errors.js';

export interface TenantRecord {
  id: string;
  name: string;
  slug: string;
  status: 'active' | 'suspended' | 'disabled';
  plan_tier: string;
  channel_plan: 'whatsapp_only' | 'voice_only' | 'combined';
  created_at: string;
  updated_at: string;
}

export interface TenantConfigurationRecord {
  tenant_id: string;
  settings_json: string;
  updated_at: string;
}

export class TenantRepository {
  private customClient?: DatabaseClient;

  constructor(client?: DatabaseClient) {
    this.customClient = client;
  }

  private get client(): DatabaseClient {
    return this.customClient || db.getClient();
  }

  public async findById(id: string): Promise<TenantRecord | null> {
    return this.client.queryOne<TenantRecord>(
      'SELECT * FROM tenants WHERE id = ?;',
      [id]
    );
  }

  public async findBySlug(slug: string): Promise<TenantRecord | null> {
    return this.client.queryOne<TenantRecord>(
      'SELECT * FROM tenants WHERE slug = ?;',
      [slug]
    );
  }

  public async create(data: {
    name: string;
    slug: string;
    plan_tier?: string;
    channel_plan?: 'whatsapp_only' | 'voice_only' | 'combined';
    id?: string;
  }): Promise<TenantRecord> {
    const now = new Date().toISOString();
    const id = data.id || CryptoUtils.generateId();

    const record: TenantRecord = {
      id,
      name: data.name,
      slug: data.slug,
      status: 'active',
      plan_tier: data.plan_tier || 'standard',
      channel_plan: data.channel_plan || 'combined',
      created_at: now,
      updated_at: now,
    };

    await this.client.execute(
      `INSERT INTO tenants (id, name, slug, status, plan_tier, channel_plan, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
      [record.id, record.name, record.slug, record.status, record.plan_tier, record.channel_plan, record.created_at, record.updated_at]
    );

    return record;
  }

  public async getConfiguration<T = Record<string, unknown>>(tenantId: string): Promise<T> {
    const row = await this.client.queryOne<TenantConfigurationRecord>(
      'SELECT * FROM tenant_configurations WHERE tenant_id = ?;',
      [tenantId]
    );
    if (!row) return {} as T;
    try {
      return JSON.parse(row.settings_json) as T;
    } catch {
      return {} as T;
    }
  }

  public async setConfiguration(tenantId: string, settings: Record<string, unknown>): Promise<void> {
    const now = new Date().toISOString();
    const jsonStr = JSON.stringify(settings);
    await this.client.execute(
      `INSERT INTO tenant_configurations (tenant_id, settings_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(tenant_id) DO UPDATE SET settings_json = excluded.settings_json, updated_at = excluded.updated_at;`,
      [tenantId, jsonStr, now]
    );
  }
}
