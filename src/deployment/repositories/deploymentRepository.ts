/**
 * Kriya AI — Deployment & Release Repository
 * Database access layer for deployments, feature flags, and Expand-Migrate-Contract schema transitions.
 */

import { DatabaseClient } from '../../storage/db.js';
import {
  ReleaseDeployment,
  FeatureFlag,
  SchemaTransition,
  DeploymentStatus,
  ApiVersionRegistration,
  CanaryRoutingConfig,
  CanaryTelemetrySnapshot,
  DeploymentRollbackEvent,
  DataResidencyConfig,
} from '../types/deploymentTypes.js';
import { LaunchGateReviewReport } from '../gate/launchGateTypes.js';

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

  // 4. API Version Registrations
  public async saveApiVersion(reg: ApiVersionRegistration): Promise<void> {
    await this.client.execute(
      `INSERT INTO api_version_registrations (
        id, api_version, status, min_supported_client_version,
        deprecated_at, sunset_at, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(api_version) DO UPDATE SET
        status = excluded.status,
        min_supported_client_version = excluded.min_supported_client_version,
        deprecated_at = excluded.deprecated_at,
        sunset_at = excluded.sunset_at,
        notes = excluded.notes,
        updated_at = excluded.updated_at;`,
      [
        reg.id,
        reg.apiVersion,
        reg.status,
        reg.minSupportedClientVersion,
        reg.deprecatedAt ?? null,
        reg.sunsetAt ?? null,
        reg.notes ?? null,
        reg.createdAt,
        reg.updatedAt,
      ]
    );
  }

  public async getApiVersion(apiVersion: string): Promise<ApiVersionRegistration | null> {
    const rows = await this.client.query<any>(
      'SELECT * FROM api_version_registrations WHERE api_version = ?;',
      [apiVersion]
    );
    if (!rows.length) return null;
    return this.mapRowToApiVersion(rows[0]);
  }

  public async listApiVersions(status?: string): Promise<ApiVersionRegistration[]> {
    const query = status
      ? 'SELECT * FROM api_version_registrations WHERE status = ? ORDER BY api_version DESC;'
      : 'SELECT * FROM api_version_registrations ORDER BY api_version DESC;';
    const params = status ? [status] : [];
    const rows = await this.client.query<any>(query, params);
    return rows.map((r: any) => this.mapRowToApiVersion(r));
  }

  // 5. Canary Routing Configurations
  public async saveCanaryRoutingConfig(config: CanaryRoutingConfig): Promise<void> {
    await this.client.execute(
      `INSERT INTO canary_routing_configurations (
        id, deployment_id, traffic_weight_pct, routing_strategy,
        evaluation_interval_seconds, error_rate_threshold_pct, p99_latency_threshold_ms,
        consecutive_healthy_evaluations, consecutive_unhealthy_evaluations, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        traffic_weight_pct = excluded.traffic_weight_pct,
        routing_strategy = excluded.routing_strategy,
        evaluation_interval_seconds = excluded.evaluation_interval_seconds,
        error_rate_threshold_pct = excluded.error_rate_threshold_pct,
        p99_latency_threshold_ms = excluded.p99_latency_threshold_ms,
        consecutive_healthy_evaluations = excluded.consecutive_healthy_evaluations,
        consecutive_unhealthy_evaluations = excluded.consecutive_unhealthy_evaluations,
        status = excluded.status,
        updated_at = excluded.updated_at;`,
      [
        config.id,
        config.deploymentId,
        config.trafficWeightPct,
        config.routingStrategy,
        config.evaluationIntervalSeconds,
        config.errorRateThresholdPct,
        config.p99LatencyThresholdMs,
        config.consecutiveHealthyEvaluations,
        config.consecutiveUnhealthyEvaluations,
        config.status,
        config.createdAt,
        config.updatedAt,
      ]
    );
  }

  public async getCanaryRoutingConfigByDeployment(deploymentId: string): Promise<CanaryRoutingConfig | null> {
    const rows = await this.client.query<any>(
      'SELECT * FROM canary_routing_configurations WHERE deployment_id = ? ORDER BY created_at DESC LIMIT 1;',
      [deploymentId]
    );
    if (!rows.length) return null;
    return this.mapRowToCanaryConfig(rows[0]);
  }

  public async updateCanaryRoutingStatus(
    deploymentId: string,
    status: 'active' | 'paused' | 'completed' | 'rolled_back',
    weightPct?: number
  ): Promise<void> {
    const now = new Date().toISOString();
    if (weightPct !== undefined) {
      await this.client.execute(
        `UPDATE canary_routing_configurations 
         SET status = ?, traffic_weight_pct = ?, updated_at = ? 
         WHERE deployment_id = ?;`,
        [status, weightPct, now, deploymentId]
      );
    } else {
      await this.client.execute(
        `UPDATE canary_routing_configurations 
         SET status = ?, updated_at = ? 
         WHERE deployment_id = ?;`,
        [status, now, deploymentId]
      );
    }
  }

  // 6. Canary Telemetry Snapshots
  public async saveCanaryTelemetrySnapshot(snapshot: CanaryTelemetrySnapshot): Promise<void> {
    await this.client.execute(
      `INSERT INTO canary_telemetry_snapshots (
        id, deployment_id, sample_window_seconds, total_requests,
        error_count, error_rate_pct, p95_latency_ms, p99_latency_ms,
        verdict, action_taken, reason, evaluated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        snapshot.id,
        snapshot.deploymentId,
        snapshot.sampleWindowSeconds,
        snapshot.totalRequests,
        snapshot.errorCount,
        snapshot.errorRatePct,
        snapshot.p95LatencyMs,
        snapshot.p99LatencyMs,
        snapshot.verdict,
        snapshot.actionTaken,
        snapshot.reason ?? null,
        snapshot.evaluatedAt,
      ]
    );
  }

  public async listCanaryTelemetrySnapshots(deploymentId: string, limit = 50): Promise<CanaryTelemetrySnapshot[]> {
    const rows = await this.client.query<any>(
      'SELECT * FROM canary_telemetry_snapshots WHERE deployment_id = ? ORDER BY evaluated_at DESC LIMIT ?;',
      [deploymentId, limit]
    );
    return rows.map((r: any) => this.mapRowToTelemetrySnapshot(r));
  }

  // 7. Deployment Rollback Events
  public async saveRollbackEvent(event: DeploymentRollbackEvent): Promise<void> {
    await this.client.execute(
      `INSERT INTO deployment_rollback_events (
        id, deployment_id, rollback_type, trigger_reason,
        previous_weight_pct, target_weight_pct, proof_receipt_id,
        attention_item_id, executed_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        event.id,
        event.deploymentId,
        event.rollbackType,
        event.triggerReason,
        event.previousWeightPct,
        event.targetWeightPct,
        event.proofReceiptId ?? null,
        event.attentionItemId ?? null,
        event.executedBy,
        event.createdAt,
      ]
    );
  }

  public async listRollbackEvents(deploymentId?: string, limit = 50): Promise<DeploymentRollbackEvent[]> {
    const query = deploymentId
      ? 'SELECT * FROM deployment_rollback_events WHERE deployment_id = ? ORDER BY created_at DESC LIMIT ?;'
      : 'SELECT * FROM deployment_rollback_events ORDER BY created_at DESC LIMIT ?;';
    const params = deploymentId ? [deploymentId, limit] : [limit];
    const rows = await this.client.query<any>(query, params);
    return rows.map((r: any) => this.mapRowToRollbackEvent(r));
  }

  // 8. Data Residency Configurations
  public async saveDataResidencyConfig(config: DataResidencyConfig): Promise<void> {
    await this.client.execute(
      `INSERT INTO data_residency_configs (
        id, tenant_id, jurisdiction, primary_region, allowed_regions_json,
        strict_data_localization, cross_border_transfer_permitted,
        approved_llm_inference_regions_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id) DO UPDATE SET
        jurisdiction = excluded.jurisdiction,
        primary_region = excluded.primary_region,
        allowed_regions_json = excluded.allowed_regions_json,
        strict_data_localization = excluded.strict_data_localization,
        cross_border_transfer_permitted = excluded.cross_border_transfer_permitted,
        approved_llm_inference_regions_json = excluded.approved_llm_inference_regions_json,
        updated_at = excluded.updated_at;`,
      [
        config.id,
        config.tenantId,
        config.jurisdiction,
        config.primaryRegion,
        JSON.stringify(config.allowedRegions),
        config.strictDataLocalization ? 1 : 0,
        config.crossBorderTransferPermitted ? 1 : 0,
        JSON.stringify(config.approvedLlmInferenceRegions),
        config.createdAt,
        config.updatedAt,
      ]
    );
  }

  public async getDataResidencyConfig(tenantId: string): Promise<DataResidencyConfig | null> {
    const rows = await this.client.query<any>(
      'SELECT * FROM data_residency_configs WHERE tenant_id = ?;',
      [tenantId]
    );
    if (!rows.length) return null;
    return this.mapRowToResidencyConfig(rows[0]);
  }

  public async listDataResidencyConfigs(jurisdiction?: string): Promise<DataResidencyConfig[]> {
    const query = jurisdiction
      ? 'SELECT * FROM data_residency_configs WHERE jurisdiction = ? ORDER BY created_at DESC;'
      : 'SELECT * FROM data_residency_configs ORDER BY created_at DESC;';
    const params = jurisdiction ? [jurisdiction] : [];
    const rows = await this.client.query<any>(query, params);
    return rows.map((r: any) => this.mapRowToResidencyConfig(r));
  }

  private mapRowToApiVersion(r: any): ApiVersionRegistration {
    return {
      id: r.id,
      apiVersion: r.api_version,
      status: r.status,
      minSupportedClientVersion: r.min_supported_client_version,
      deprecatedAt: r.deprecated_at ?? undefined,
      sunsetAt: r.sunset_at ?? undefined,
      notes: r.notes ?? undefined,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  private mapRowToCanaryConfig(r: any): CanaryRoutingConfig {
    return {
      id: r.id,
      deploymentId: r.deployment_id,
      trafficWeightPct: Number(r.traffic_weight_pct),
      routingStrategy: r.routing_strategy,
      evaluationIntervalSeconds: Number(r.evaluation_interval_seconds),
      errorRateThresholdPct: Number(r.error_rate_threshold_pct),
      p99LatencyThresholdMs: Number(r.p99_latency_threshold_ms),
      consecutiveHealthyEvaluations: Number(r.consecutive_healthy_evaluations),
      consecutiveUnhealthyEvaluations: Number(r.consecutive_unhealthy_evaluations),
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  private mapRowToTelemetrySnapshot(r: any): CanaryTelemetrySnapshot {
    return {
      id: r.id,
      deploymentId: r.deployment_id,
      sampleWindowSeconds: Number(r.sample_window_seconds),
      totalRequests: Number(r.total_requests),
      errorCount: Number(r.error_count),
      errorRatePct: Number(r.error_rate_pct),
      p95LatencyMs: Number(r.p95_latency_ms),
      p99LatencyMs: Number(r.p99_latency_ms),
      verdict: r.verdict,
      actionTaken: r.action_taken,
      reason: r.reason ?? undefined,
      evaluatedAt: r.evaluated_at,
    };
  }

  private mapRowToRollbackEvent(r: any): DeploymentRollbackEvent {
    return {
      id: r.id,
      deploymentId: r.deployment_id,
      rollbackType: r.rollback_type,
      triggerReason: r.trigger_reason,
      previousWeightPct: Number(r.previous_weight_pct),
      targetWeightPct: Number(r.target_weight_pct),
      proofReceiptId: r.proof_receipt_id ?? undefined,
      attentionItemId: r.attention_item_id ?? undefined,
      executedBy: r.executed_by,
      createdAt: r.created_at,
    };
  }

  private mapRowToResidencyConfig(r: any): DataResidencyConfig {
    return {
      id: r.id,
      tenantId: r.tenant_id,
      jurisdiction: r.jurisdiction,
      primaryRegion: r.primary_region,
      allowedRegions: JSON.parse(r.allowed_regions_json || '["ap-south-1"]'),
      strictDataLocalization: Boolean(r.strict_data_localization),
      crossBorderTransferPermitted: Boolean(r.cross_border_transfer_permitted),
      approvedLlmInferenceRegions: JSON.parse(r.approved_llm_inference_regions_json || '["ap-south-1"]'),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  // 9. Launch Gate Reviews (WP-8.6)
  public async saveLaunchGateReview(report: LaunchGateReviewReport): Promise<void> {
    await this.client.execute(
      `INSERT INTO launch_gate_reviews (
        id, review_id, evaluated_at, overall_status, app_mode, environment,
        reviewer, proof_receipt_id, gate_checks_json, summary_json, signature, signed_payload_hash, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(review_id) DO UPDATE SET
        overall_status = excluded.overall_status,
        gate_checks_json = excluded.gate_checks_json,
        summary_json = excluded.summary_json,
        signature = excluded.signature,
        signed_payload_hash = excluded.signed_payload_hash,
        proof_receipt_id = excluded.proof_receipt_id;`,
      [
        report.reviewId,
        report.reviewId,
        report.evaluatedAt,
        report.overallStatus,
        report.appMode,
        report.environment,
        report.reviewer,
        report.proofReceiptId ?? null,
        JSON.stringify(report.gates),
        JSON.stringify(report.summary),
        report.signature,
        report.signedPayloadHash,
        report.evaluatedAt,
      ]
    );
  }

  public async getLaunchGateReview(reviewId: string): Promise<LaunchGateReviewReport | null> {
    const row = await this.client.queryOne<any>(
      `SELECT * FROM launch_gate_reviews WHERE review_id = ?`,
      [reviewId]
    );
    return row ? this.mapRowToLaunchGateReview(row) : null;
  }

  public async getLatestLaunchGateReview(): Promise<LaunchGateReviewReport | null> {
    const row = await this.client.queryOne<any>(
      `SELECT * FROM launch_gate_reviews ORDER BY evaluated_at DESC LIMIT 1`
    );
    return row ? this.mapRowToLaunchGateReview(row) : null;
  }

  public async listLaunchGateReviews(limit = 20): Promise<LaunchGateReviewReport[]> {
    const rows = await this.client.query<any>(
      `SELECT * FROM launch_gate_reviews ORDER BY evaluated_at DESC LIMIT ?`,
      [limit]
    );
    return rows.map((r) => this.mapRowToLaunchGateReview(r));
  }

  private mapRowToLaunchGateReview(r: any): LaunchGateReviewReport {
    return {
      reviewId: r.review_id,
      appMode: r.app_mode,
      environment: r.environment,
      evaluatedAt: r.evaluated_at,
      reviewer: r.reviewer,
      overallStatus: r.overall_status,
      gates: JSON.parse(r.gate_checks_json || '[]'),
      summary: JSON.parse(r.summary_json || '{}'),
      proofReceiptId: r.proof_receipt_id ?? undefined,
      signedPayloadHash: r.signed_payload_hash,
      signature: r.signature,
    };
  }
}


