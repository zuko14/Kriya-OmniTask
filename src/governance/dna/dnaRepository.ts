/**
 * Kriya Omnitask — Business DNA & Roster Manifest Repository (§3, §4, §23)
 * Handles persistence and queries for global DNA Profiles and Tenant Roster Manifests.
 */

import { DatabaseClient, db } from '../../storage/db.js';
import {
  DnaProfile,
  DnaProfileSchema,
  TenantRosterManifest,
  TenantRosterManifestSchema,
} from './dnaTypes.js';
import { NotFoundError } from '../../core/errors/errors.js';

export interface RawDnaProfileRow {
  id: string;
  version: string;
  business_type: string;
  display_name: string;
  description: string | null;
  lifecycle_model_json: string;
  entity_vocabulary_json: string;
  capabilities_json: string;
  required_agents_json: string;
  optional_agents_json: string;
  forbidden_actions_json: string;
  compliance_profile_json: string;
  default_kpis_json: string;
  knowledge_schema_json: string;
  escalation_defaults_json: string;
  skill_grants_json: string;
  external_retrieval_policy_json: string;
  min_tier_requirements_json: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface RawRosterManifestRow {
  id: string;
  tenant_id: string;
  version: number;
  dna_profile_id: string;
  dna_profile_version: string;
  entity_vocabulary_json: string;
  capabilities_json: string;
  lifecycle_stages_json: string;
  agents_json: string;
  checksum: string;
  status: string;
  created_by: string;
  created_at: string;
  rolled_back_from_version: number | null;
}

export class DnaRepository {
  private client: DatabaseClient;

  constructor(client?: DatabaseClient) {
    this.client = client || db.getClient();
  }

  // ============================================================================
  // DNA Profiles (Global Owner Plane)
  // ============================================================================

  public async getProfile(id: string): Promise<DnaProfile | null> {
    const row = await this.client.queryOne<RawDnaProfileRow>(
      'SELECT * FROM dna_profiles WHERE id = ?;',
      [id]
    );
    return row ? this.mapRowToProfile(row) : null;
  }

  public async getRequiredProfile(id: string): Promise<DnaProfile> {
    let profile = await this.getProfile(id);
    if (!profile && (id === 'dna_general_service' || !id)) {
      profile = await this.getProfile('dna_retail_commerce');
    }
    if (!profile) {
      throw new NotFoundError(`Business DNA Profile '${id}' not found.`);
    }
    return profile;
  }

  public async listProfiles(activeOnly = true): Promise<DnaProfile[]> {
    const sql = activeOnly
      ? 'SELECT * FROM dna_profiles WHERE is_active = 1 ORDER BY display_name ASC;'
      : 'SELECT * FROM dna_profiles ORDER BY display_name ASC;';
    const rows = await this.client.query<RawDnaProfileRow>(sql);
    return rows.map((r) => this.mapRowToProfile(r));
  }

  public async createOrUpdateProfile(profile: DnaProfile): Promise<DnaProfile> {
    const validated = DnaProfileSchema.parse(profile);
    const sql = `
      INSERT OR REPLACE INTO dna_profiles (
        id, version, business_type, display_name, description,
        lifecycle_model_json, entity_vocabulary_json, capabilities_json,
        required_agents_json, optional_agents_json, forbidden_actions_json,
        compliance_profile_json, default_kpis_json, knowledge_schema_json,
        escalation_defaults_json, skill_grants_json, external_retrieval_policy_json,
        min_tier_requirements_json, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `;

    await this.client.execute(sql, [
      validated.id,
      validated.version,
      validated.business_type,
      validated.display_name,
      validated.description || null,
      JSON.stringify(validated.lifecycle_model),
      JSON.stringify(validated.entity_vocabulary),
      JSON.stringify(validated.capabilities),
      JSON.stringify(validated.required_agents),
      JSON.stringify(validated.optional_agents),
      JSON.stringify(validated.forbidden_actions),
      JSON.stringify(validated.compliance_profile),
      JSON.stringify(validated.default_kpis),
      JSON.stringify(validated.knowledge_schema),
      JSON.stringify(validated.escalation_defaults),
      JSON.stringify(validated.skill_grants),
      JSON.stringify(validated.external_retrieval_policy),
      JSON.stringify(validated.min_tier_requirements),
      validated.is_active ? 1 : 0,
      validated.created_at,
      validated.updated_at,
    ]);

    return validated;
  }

  // ============================================================================
  // Tenant Roster Manifests (Tenant Specific & Versioned)
  // ============================================================================

  public async getActiveManifest(tenantId: string): Promise<TenantRosterManifest | null> {
    const row = await this.client.queryOne<RawRosterManifestRow>(
      `SELECT * FROM tenant_roster_manifests 
       WHERE tenant_id = ? AND status = 'active' 
       ORDER BY version DESC LIMIT 1;`,
      [tenantId]
    );
    return row ? this.mapRowToManifest(row) : null;
  }

  public async getManifestByVersion(tenantId: string, version: number): Promise<TenantRosterManifest | null> {
    const row = await this.client.queryOne<RawRosterManifestRow>(
      `SELECT * FROM tenant_roster_manifests 
       WHERE tenant_id = ? AND version = ?;`,
      [tenantId, version]
    );
    return row ? this.mapRowToManifest(row) : null;
  }

  public async listManifestHistory(tenantId: string): Promise<TenantRosterManifest[]> {
    const rows = await this.client.query<RawRosterManifestRow>(
      `SELECT * FROM tenant_roster_manifests 
       WHERE tenant_id = ? 
       ORDER BY version DESC;`,
      [tenantId]
    );
    return rows.map((r) => this.mapRowToManifest(r));
  }

  public async getLatestVersionNumber(tenantId: string): Promise<number> {
    const row = await this.client.queryOne<{ max_version: number | null }>(
      'SELECT MAX(version) as max_version FROM tenant_roster_manifests WHERE tenant_id = ?;',
      [tenantId]
    );
    return row?.max_version ? Number(row.max_version) : 0;
  }

  public async saveManifest(manifest: TenantRosterManifest): Promise<TenantRosterManifest> {
    const validated = TenantRosterManifestSchema.parse(manifest);

    // If new manifest is active, supersede previous active manifests for this tenant in a transaction
    await this.client.transaction(async (tx) => {
      if (validated.status === 'active') {
        await tx.execute(
          `UPDATE tenant_roster_manifests 
           SET status = 'superseded' 
           WHERE tenant_id = ? AND status = 'active';`,
          [validated.tenant_id]
        );
      }

      const sql = `
        INSERT INTO tenant_roster_manifests (
          id, tenant_id, version, dna_profile_id, dna_profile_version,
          entity_vocabulary_json, capabilities_json, lifecycle_stages_json,
          agents_json, checksum, status, created_by, created_at,
          rolled_back_from_version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
      `;

      await tx.execute(sql, [
        validated.id,
        validated.tenant_id,
        validated.version,
        validated.dna_profile_id,
        validated.dna_profile_version,
        JSON.stringify(validated.entity_vocabulary),
        JSON.stringify(validated.capabilities),
        JSON.stringify(validated.lifecycle_stages),
        JSON.stringify(validated.agents),
        validated.checksum,
        validated.status,
        validated.created_by,
        validated.created_at,
        validated.rolled_back_from_version || null,
      ]);
    });

    return validated;
  }

  // ============================================================================
  // Row Mappers
  // ============================================================================

  private mapRowToProfile(row: RawDnaProfileRow): DnaProfile {
    return DnaProfileSchema.parse({
      id: row.id,
      version: row.version,
      business_type: row.business_type,
      display_name: row.display_name,
      description: row.description || undefined,
      lifecycle_model: JSON.parse(row.lifecycle_model_json),
      entity_vocabulary: JSON.parse(row.entity_vocabulary_json),
      capabilities: JSON.parse(row.capabilities_json),
      required_agents: JSON.parse(row.required_agents_json),
      optional_agents: JSON.parse(row.optional_agents_json),
      forbidden_actions: JSON.parse(row.forbidden_actions_json),
      compliance_profile: JSON.parse(row.compliance_profile_json),
      default_kpis: JSON.parse(row.default_kpis_json),
      knowledge_schema: JSON.parse(row.knowledge_schema_json),
      escalation_defaults: JSON.parse(row.escalation_defaults_json),
      skill_grants: JSON.parse(row.skill_grants_json),
      external_retrieval_policy: JSON.parse(row.external_retrieval_policy_json),
      min_tier_requirements: JSON.parse(row.min_tier_requirements_json),
      is_active: row.is_active === 1,
      created_at: row.created_at,
      updated_at: row.updated_at,
    });
  }

  private mapRowToManifest(row: RawRosterManifestRow): TenantRosterManifest {
    return TenantRosterManifestSchema.parse({
      id: row.id,
      tenant_id: row.tenant_id,
      version: row.version,
      dna_profile_id: row.dna_profile_id,
      dna_profile_version: row.dna_profile_version,
      entity_vocabulary: JSON.parse(row.entity_vocabulary_json),
      capabilities: JSON.parse(row.capabilities_json),
      lifecycle_stages: JSON.parse(row.lifecycle_stages_json),
      agents: JSON.parse(row.agents_json),
      checksum: row.checksum,
      status: row.status as 'active' | 'superseded' | 'rolled_back',
      created_by: row.created_by,
      created_at: row.created_at,
      rolled_back_from_version: row.rolled_back_from_version || undefined,
    });
  }
}
