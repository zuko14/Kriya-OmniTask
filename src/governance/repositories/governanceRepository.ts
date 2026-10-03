/**
 * Kriya AI — Enterprise Governance Repository
 * Persistence for org units, enterprise SSO configs, retention policies, and purge audit logs.
 */

import { BaseRepository } from '../../storage/repositories/baseRepository.js';
import { DatabaseClient } from '../../storage/db.js';
import {
  OrganizationUnit,
  EnterpriseSsoConfig,
  DataRetentionPolicy,
  GovernancePurgeAudit,
  SsoProviderType,
  OrgUnitType,
  DataClassification,
  TargetResourceType,
  PurgeAction,
} from '../types/governanceTypes.js';

export class GovernanceRepository extends BaseRepository<any> {
  protected readonly tableName = 'organization_units';

  constructor(client?: DatabaseClient) {
    super(client);
  }

  public async createOrgUnit(unit: OrganizationUnit): Promise<void> {
    await this.client.execute(
      `INSERT INTO organization_units
       (id, tenant_id, parent_unit_id, name, code, unit_type, lead_user_id, metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        unit.id,
        unit.tenantId,
        unit.parentUnitId || null,
        unit.name,
        unit.code,
        unit.unitType,
        unit.leadUserId || null,
        JSON.stringify(unit.metadata),
        unit.createdAt,
        unit.updatedAt,
      ]
    );
  }

  public async listOrgUnits(tenantId: string): Promise<OrganizationUnit[]> {
    const rows = await this.client.query<any>(
      `SELECT id, tenant_id, parent_unit_id, name, code, unit_type, lead_user_id, metadata_json, created_at, updated_at
       FROM organization_units
       WHERE tenant_id = ?
       ORDER BY created_at ASC;`,
      [tenantId]
    );

    return rows.map((r) => ({
      id: r.id,
      tenantId: r.tenant_id,
      parentUnitId: r.parent_unit_id || undefined,
      name: r.name,
      code: r.code,
      unitType: r.unit_type as OrgUnitType,
      leadUserId: r.lead_user_id || undefined,
      metadata: JSON.parse(r.metadata_json),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  public async upsertSsoConfig(config: EnterpriseSsoConfig, encryptedSecret: string): Promise<void> {
    await this.client.execute(
      `INSERT OR REPLACE INTO enterprise_sso_configs
       (id, tenant_id, provider_type, issuer_url, client_id, client_secret_encrypted, claims_mapping_json, enforce_sso, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        config.id,
        config.tenantId,
        config.providerType,
        config.issuerUrl,
        config.clientId,
        encryptedSecret,
        JSON.stringify(config.claimsMapping),
        config.enforceSso ? 1 : 0,
        config.isActive ? 1 : 0,
        config.createdAt,
        config.updatedAt,
      ]
    );
  }

  public async getSsoConfig(
    tenantId: string,
    providerType: SsoProviderType
  ): Promise<EnterpriseSsoConfig | null> {
    const rows = await this.client.query<any>(
      `SELECT id, tenant_id, provider_type, issuer_url, client_id, claims_mapping_json, enforce_sso, is_active, created_at, updated_at
       FROM enterprise_sso_configs
       WHERE tenant_id = ? AND provider_type = ?;`,
      [tenantId, providerType]
    );

    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      id: r.id,
      tenantId: r.tenant_id,
      providerType: r.provider_type as SsoProviderType,
      issuerUrl: r.issuer_url,
      clientId: r.client_id,
      claimsMapping: JSON.parse(r.claims_mapping_json),
      enforceSso: Boolean(r.enforce_sso),
      isActive: Boolean(r.is_active),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  public async upsertRetentionPolicy(policy: DataRetentionPolicy): Promise<void> {
    await this.client.execute(
      `INSERT OR REPLACE INTO data_retention_policies
       (id, tenant_id, data_classification, target_resource_type, retention_days, purge_action, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        policy.id,
        policy.tenantId,
        policy.dataClassification,
        policy.targetResourceType,
        policy.retentionDays,
        policy.purgeAction,
        policy.isActive ? 1 : 0,
        policy.createdAt,
        policy.updatedAt,
      ]
    );
  }

  public async listRetentionPolicies(tenantId: string): Promise<DataRetentionPolicy[]> {
    const rows = await this.client.query<any>(
      `SELECT id, tenant_id, data_classification, target_resource_type, retention_days, purge_action, is_active, created_at, updated_at
       FROM data_retention_policies
       WHERE tenant_id = ?
       ORDER BY data_classification ASC;`,
      [tenantId]
    );

    return rows.map((r) => ({
      id: r.id,
      tenantId: r.tenant_id,
      dataClassification: r.data_classification as DataClassification,
      targetResourceType: r.target_resource_type as TargetResourceType,
      retentionDays: Number(r.retention_days),
      purgeAction: r.purge_action as PurgeAction,
      isActive: Boolean(r.is_active),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  public async insertPurgeAudit(audit: GovernancePurgeAudit): Promise<void> {
    await this.client.execute(
      `INSERT INTO governance_purge_audit
       (id, tenant_id, policy_id, target_resource_type, records_evaluated, records_purged, status, executed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        audit.id,
        audit.tenantId,
        audit.policyId,
        audit.targetResourceType,
        audit.recordsEvaluated,
        audit.recordsPurged,
        audit.status,
        audit.executedAt,
      ]
    );
  }

  public async listPurgeAudits(tenantId: string, limit = 50): Promise<GovernancePurgeAudit[]> {
    const rows = await this.client.query<any>(
      `SELECT id, tenant_id, policy_id, target_resource_type, records_evaluated, records_purged, status, executed_at
       FROM governance_purge_audit
       WHERE tenant_id = ?
       ORDER BY executed_at DESC
       LIMIT ?;`,
      [tenantId, limit]
    );

    return rows.map((r) => ({
      id: r.id,
      tenantId: r.tenant_id,
      policyId: r.policy_id,
      targetResourceType: r.target_resource_type as TargetResourceType,
      recordsEvaluated: Number(r.records_evaluated),
      recordsPurged: Number(r.records_purged),
      status: r.status as 'completed' | 'failed',
      executedAt: r.executed_at,
    }));
  }
}
