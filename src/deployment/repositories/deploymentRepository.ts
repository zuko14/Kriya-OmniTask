/**
 * Xylarc AI — Deployment & Release Repository
 * Database access layer for deployments, feature flags, and Expand-Migrate-Contract schema transitions.
 */

import { DatabaseClient } from '../../storage/db.js';
import {
  ReleaseDeployment,
  FeatureFlag,
  SchemaTransition,
  DeploymentStatus,
} from '../types/deploymentTypes.js';

export class DeploymentRepository {
  constructor(private client: DatabaseClient) {}

  // 1. Release Deployments
  public async saveDeployment(deployment: ReleaseDeployment): Promise<void> {
    await this.client.execute(
      `INSERT INTO release_deployments (
        id, version_tag, environment, status, canary_weight_pct,
        gate_verdict, gate_details_json, deployed_by, created_at, promoted_at, rolled_back_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        canary_weight_pct = excluded.canary_weight_pct,
        gate_verdict = excluded.gate_verdict,
        gate_details_json = excluded.gate_details_json,
        promoted_at = excluded.promoted_at,
        rolled_back_at = excluded.rolled_back_at;`,
      [
        deployment.id,
        deployment.versionTag,
        deployment.environment,
        deployment.status,
        deployment.canaryWeightPct,
        deployment.gateVerdict,
        JSON.stringify(deployment.gateDetails),
        deployment.deployedBy,
        deployment.createdAt,
        deployment.promotedAt ?? null,
        deployment.rolledBackAt ?? null,
      ]
    );
  }

  public async getDeploymentById(id: string): Promise<ReleaseDeployment | null> {
    const rows = await this.client.query<any>('SELECT * FROM release_deployments WHERE id = ?;', [id]);
    if (!rows.length) return null;
    return this.mapRowToDeployment(rows[0]);
  }

  public async listDeployments(environment?: string, limit = 50): Promise<ReleaseDeployment[]> {
    const query = environment
      ? 'SELECT * FROM release_deployments WHERE environment = ? ORDER BY created_at DESC LIMIT ?;'
      : 'SELECT * FROM release_deployments ORDER BY created_at DESC LIMIT ?;';
    const params = environment ? [environment, limit] : [limit];

    const rows = await this.client.query<any>(query, params);
    return rows.map((r: any) => this.mapRowToDeployment(r));
  }

  public async updateDeploymentStatus(
    id: string,
    status: DeploymentStatus,
    timestamp: string = new Date().toISOString()
  ): Promise<void> {
    if (status === 'promoted') {
      await this.client.execute(
        'UPDATE release_deployments SET status = ?, canary_weight_pct = 100, promoted_at = ? WHERE id = ?;',
        [status, timestamp, id]
      );
    } else if (status === 'rolled_back') {
      await this.client.execute(
        'UPDATE release_deployments SET status = ?, canary_weight_pct = 0, rolled_back_at = ? WHERE id = ?;',
        [status, timestamp, id]
      );
    } else {
      await this.client.execute(
        'UPDATE release_deployments SET status = ? WHERE id = ?;',
        [status, id]
      );
    }
  }

  public async updateCanaryWeight(id: string, weightPct: number): Promise<void> {
    await this.client.execute(
      'UPDATE release_deployments SET canary_weight_pct = ?, status = ? WHERE id = ?;',
      [weightPct, weightPct > 0 ? 'canary' : 'pending', id]
    );
  }

  // 2. Feature Flags
  public async saveFeatureFlag(flag: FeatureFlag): Promise<void> {
    await this.client.execute(
      `INSERT INTO feature_flags (
        id, flag_key, name, description, is_enabled,
        allowed_tenants_json, allowed_roles_json, rollout_pct, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(flag_key) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        is_enabled = excluded.is_enabled,
        allowed_tenants_json = excluded.allowed_tenants_json,
        allowed_roles_json = excluded.allowed_roles_json,
        rollout_pct = excluded.rollout_pct,
        updated_at = excluded.updated_at;`,
      [
        flag.id,
        flag.flagKey,
        flag.name,
        flag.description ?? null,
        flag.isEnabled ? 1 : 0,
        JSON.stringify(flag.allowedTenants),
        JSON.stringify(flag.allowedRoles),
        flag.rolloutPct,
        flag.createdAt,
        flag.updatedAt,
      ]
    );
  }

  public async getFeatureFlagByKey(key: string): Promise<FeatureFlag | null> {
    const rows = await this.client.query<any>('SELECT * FROM feature_flags WHERE flag_key = ?;', [key]);
    if (!rows.length) return null;
    return this.mapRowToFlag(rows[0]);
  }

  public async listFeatureFlags(): Promise<FeatureFlag[]> {
    const rows = await this.client.query<any>('SELECT * FROM feature_flags ORDER BY flag_key ASC;');
    return rows.map((r: any) => this.mapRowToFlag(r));
  }

  public async deleteFeatureFlag(id: string): Promise<void> {
    await this.client.execute('DELETE FROM feature_flags WHERE id = ?;', [id]);
  }

  // 3. Schema Transitions
  public async saveSchemaTransition(transition: SchemaTransition): Promise<void> {
    await this.client.execute(
      `INSERT INTO schema_transitions (
        id, table_name, version, phase, status, details_json, created_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        details_json = excluded.details_json,
        completed_at = excluded.completed_at;`,
      [
        transition.id,
        transition.tableName,
        transition.version,
        transition.phase,
        transition.status,
        JSON.stringify(transition.details),
        transition.createdAt,
        transition.completedAt ?? null,
      ]
    );
  }

  public async getLatestTransitionForTable(tableName: string): Promise<SchemaTransition | null> {
    const rows = await this.client.query<any>(
      'SELECT * FROM schema_transitions WHERE table_name = ? ORDER BY created_at DESC LIMIT 1;',
      [tableName]
    );
    if (!rows.length) return null;
    return this.mapRowToTransition(rows[0]);
  }

  public async listSchemaTransitions(tableName?: string): Promise<SchemaTransition[]> {
    const query = tableName
      ? 'SELECT * FROM schema_transitions WHERE table_name = ? ORDER BY created_at DESC;'
      : 'SELECT * FROM schema_transitions ORDER BY created_at DESC;';
    const params = tableName ? [tableName] : [];

    const rows = await this.client.query<any>(query, params);
    return rows.map((r: any) => this.mapRowToTransition(r));
  }

  private mapRowToDeployment(r: any): ReleaseDeployment {
    return {
      id: r.id,
      versionTag: r.version_tag,
      environment: r.environment,
      status: r.status,
      canaryWeightPct: Number(r.canary_weight_pct),
      gateVerdict: r.gate_verdict,
      gateDetails: JSON.parse(r.gate_details_json || '{}'),
      deployedBy: r.deployed_by,
      createdAt: r.created_at,
      promotedAt: r.promoted_at ?? undefined,
      rolledBackAt: r.rolled_back_at ?? undefined,
    };
  }

  private mapRowToFlag(r: any): FeatureFlag {
    return {
      id: r.id,
      flagKey: r.flag_key,
      name: r.name,
      description: r.description ?? undefined,
      isEnabled: Boolean(r.is_enabled),
      allowedTenants: JSON.parse(r.allowed_tenants_json || '[]'),
      allowedRoles: JSON.parse(r.allowed_roles_json || '[]'),
      rolloutPct: Number(r.rollout_pct),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  private mapRowToTransition(r: any): SchemaTransition {
    return {
      id: r.id,
      tableName: r.table_name,
      version: r.version,
      phase: r.phase,
      status: r.status,
      details: JSON.parse(r.details_json || '{}'),
      createdAt: r.created_at,
      completedAt: r.completed_at ?? undefined,
    };
  }
}
