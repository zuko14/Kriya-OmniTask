/**
 * Kriya Omnitask — Tenant Repository
 * Manages tenant records, Business DNA bindings, lifecycle states, and temporary elevation sessions.
 * Conforms to CLAUDE1.md §2 (Owner-Provisioned Everything), §17.1, §17.2, §17.6.
 */

import { DatabaseClient, db } from '../db.js';
import { CryptoUtils } from '../../core/utils/crypto.js';

export interface TenantRecord {
  id: string;
  name: string;
  slug: string;
  status: 'active' | 'suspended' | 'degraded' | 'disabled';
  plan_tier: string;
  channel_plan: 'whatsapp_only' | 'voice_only' | 'combined';
  industry?: string;
  region?: string;
  languages_json?: string;
  timezone?: string;
  dna_profile_id?: string;
  brain_supply_mode?: 'byo' | 'managed';
  quotas_json?: string;
  autonomy_ceiling?: 'L1' | 'L2' | 'L3' | 'L4';
  created_at: string;
  updated_at: string;
}

export interface TenantElevationRecord {
  id: string;
  tenant_id: string;
  operator_id: string;
  operator_name?: string;
  reason: string;
  duration_minutes: number;
  starts_at: string;
  expires_at: string;
  revoked_at?: string | null;
  created_at: string;
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

  public async listAll(): Promise<TenantRecord[]> {
    return this.client.query<TenantRecord>(
      'SELECT * FROM tenants ORDER BY created_at DESC;'
    );
  }

  public async create(data: {
    name: string;
    slug: string;
    plan_tier?: string;
    channel_plan?: 'whatsapp_only' | 'voice_only' | 'combined';
    industry?: string;
    region?: string;
    languages?: string[];
    timezone?: string;
    dna_profile_id?: string;
    brain_supply_mode?: 'byo' | 'managed';
    quotas?: Record<string, unknown>;
    autonomy_ceiling?: 'L1' | 'L2' | 'L3' | 'L4';
    id?: string;
  }): Promise<TenantRecord> {
    const now = new Date().toISOString();
    const id = data.id || CryptoUtils.generateId();

    const record: TenantRecord = {
      id,
      name: data.name,
      slug: data.slug,
      status: 'active',
      plan_tier: data.plan_tier || 'growth',
      channel_plan: data.channel_plan || 'combined',
      industry: data.industry || 'general',
      region: data.region || 'ap-south-1',
      languages_json: JSON.stringify(data.languages || ['en', 'hi']),
      timezone: data.timezone || 'Asia/Kolkata',
      dna_profile_id: data.dna_profile_id || 'dna_general_service',
      brain_supply_mode: data.brain_supply_mode || 'byo',
      quotas_json: JSON.stringify(data.quotas || { max_concurrent_tasks: 10, monthly_budget_inr: 10000 }),
      autonomy_ceiling: data.autonomy_ceiling || 'L2',
      created_at: now,
      updated_at: now,
    };

    await this.client.execute(
      `INSERT INTO tenants (
        id, name, slug, status, plan_tier, channel_plan,
        industry, region, languages_json, timezone, dna_profile_id,
        brain_supply_mode, quotas_json, autonomy_ceiling, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        record.id,
        record.name,
        record.slug,
        record.status,
        record.plan_tier,
        record.channel_plan,
        record.industry,
        record.region,
        record.languages_json,
        record.timezone,
        record.dna_profile_id,
        record.brain_supply_mode,
        record.quotas_json,
        record.autonomy_ceiling,
        record.created_at,
        record.updated_at,
      ]
    );

    return record;
  }

  public async updateStatus(tenantId: string, status: 'active' | 'suspended' | 'degraded' | 'disabled'): Promise<void> {
    const now = new Date().toISOString();
    await this.client.execute(
      'UPDATE tenants SET status = ?, updated_at = ? WHERE id = ?;',
      [status, now, tenantId]
    );
  }

  // --- Elevation Session Management (§17.6) ---

  public async createElevationSession(data: {
    tenantId: string;
    operatorId: string;
    operatorName?: string;
    reason: string;
    durationMinutes: number;
  }): Promise<TenantElevationRecord> {
    const now = new Date();
    const startsAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + data.durationMinutes * 60 * 1000).toISOString();
    const id = `elev_${CryptoUtils.generateId()}`;

    const session: TenantElevationRecord = {
      id,
      tenant_id: data.tenantId,
      operator_id: data.operatorId,
      operator_name: data.operatorName || 'Platform Operator',
      reason: data.reason,
      duration_minutes: data.durationMinutes,
      starts_at: startsAt,
      expires_at: expiresAt,
      revoked_at: null,
      created_at: startsAt,
    };

    await this.client.execute(
      `INSERT INTO tenant_elevation_sessions (
        id, tenant_id, operator_id, operator_name, reason,
        duration_minutes, starts_at, expires_at, revoked_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        session.id,
        session.tenant_id,
        session.operator_id,
        session.operator_name,
        session.reason,
        session.duration_minutes,
        session.starts_at,
        session.expires_at,
        session.revoked_at,
        session.created_at,
      ]
    );

    return session;
  }

  public async getActiveElevationSession(tenantId: string): Promise<TenantElevationRecord | null> {
    const now = new Date().toISOString();
    return this.client.queryOne<TenantElevationRecord>(
      `SELECT * FROM tenant_elevation_sessions
       WHERE tenant_id = ? AND expires_at > ? AND revoked_at IS NULL
       ORDER BY created_at DESC LIMIT 1;`,
      [tenantId, now]
    );
  }

  public async revokeElevationSession(sessionId: string): Promise<void> {
    const now = new Date().toISOString();
    await this.client.execute(
      'UPDATE tenant_elevation_sessions SET revoked_at = ? WHERE id = ?;',
      [now, sessionId]
    );
  }

  public async listElevationHistory(tenantId: string): Promise<TenantElevationRecord[]> {
    return this.client.query<TenantElevationRecord>(
      `SELECT * FROM tenant_elevation_sessions
       WHERE tenant_id = ?
       ORDER BY created_at DESC;`,
      [tenantId]
    );
  }

  // --- Configuration Storage ---

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
