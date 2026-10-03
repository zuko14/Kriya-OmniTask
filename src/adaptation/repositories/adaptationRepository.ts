/**
 * Kriya Omnitask — Governed Adaptation Repository (§6, §23 M12)
 * Persists failure signatures, clusters, remediation proposals, simulation results, and canary evaluations.
 */

import { db, DatabaseClient } from '../../storage/db.js';
import {
  FailureSignature,
  RemediationProposal,
  AdaptationCanaryEvaluationResult,
} from '../types/adaptationTypes.js';

export class AdaptationRepository {
  private client: DatabaseClient;

  constructor(client?: DatabaseClient) {
    this.client = client || db.getClient();
  }

  // ============================================================================
  // 1. Failure Signatures
  // ============================================================================

  public async saveFailureSignature(sig: FailureSignature): Promise<void> {
    const query = `
      INSERT INTO failure_signatures (
        id, tenant_id, failure_class, business_type, agent_id, agent_slug,
        stage, root_cause, frequency, cost_usd, customer_impact, model_tier,
        metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        frequency = failure_signatures.frequency + excluded.frequency,
        cost_usd = failure_signatures.cost_usd + excluded.cost_usd,
        updated_at = excluded.updated_at;
    `;

    await this.client.execute(query, [
      sig.id,
      sig.tenantId,
      sig.failureClass,
      sig.businessType,
      sig.agentId,
      sig.agentSlug,
      sig.stage,
      sig.rootCause,
      sig.frequency,
      sig.costUsd,
      sig.customerImpact,
      sig.modelTier,
      JSON.stringify(sig.metadata || {}),
      sig.createdAt,
      sig.updatedAt,
    ]);
  }

  public async getFailureSignatures(tenantId: string): Promise<FailureSignature[]> {
    const query = `
      SELECT * FROM failure_signatures
      WHERE tenant_id = ?
      ORDER BY frequency DESC, created_at DESC;
    `;
    const rows = await this.client.query(query, [tenantId]);
    return rows.map((r) => this.mapFailureSignature(r));
  }

  public async getAllFailureSignatures(): Promise<FailureSignature[]> {
    const query = `
      SELECT * FROM failure_signatures
      ORDER BY frequency DESC, created_at DESC;
    `;
    const rows = await this.client.query(query, []);
    return rows.map((r) => this.mapFailureSignature(r));
  }

  // ============================================================================
  // 2. Adaptation Proposals
  // ============================================================================

  public async saveProposal(prop: RemediationProposal): Promise<void> {
    const query = `
      INSERT INTO adaptation_proposals (
        id, tenant_id, scope, proposal_type, title, description,
        target_failure_class, cluster_signature_id, requires_human_approval,
        proposed_changes_json, golden_suite_validation_json,
        simulation_status, approval_status, approved_by, approved_at,
        deployed_version_tag, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        description = excluded.description,
        proposed_changes_json = excluded.proposed_changes_json,
        golden_suite_validation_json = excluded.golden_suite_validation_json,
        simulation_status = excluded.simulation_status,
        approval_status = excluded.approval_status,
        approved_by = excluded.approved_by,
        approved_at = excluded.approved_at,
        deployed_version_tag = excluded.deployed_version_tag,
        updated_at = excluded.updated_at;
    `;

    await this.client.execute(query, [
      prop.id,
      prop.tenantId,
      prop.scope,
      prop.proposalType,
      prop.title,
      prop.description,
      prop.targetFailureClass,
      prop.clusterSignatureId || null,
      prop.requiresHumanApproval ? 1 : 0,
      JSON.stringify(prop.proposedChanges),
      JSON.stringify(prop.goldenSuiteValidation || {}),
      prop.simulationStatus,
      prop.approvalStatus,
      prop.approvedBy || null,
      prop.approvedAt || null,
      prop.deployedVersionTag || null,
      JSON.stringify(prop.metadata || {}),
      prop.createdAt,
      prop.updatedAt,
    ]);
  }

  public async getProposalById(id: string): Promise<RemediationProposal | null> {
    const query = `SELECT * FROM adaptation_proposals WHERE id = ?;`;
    const row = await this.client.queryOne(query, [id]);
    return row ? this.mapProposal(row) : null;
  }

  public async listProposals(tenantId: string): Promise<RemediationProposal[]> {
    const query = `
      SELECT * FROM adaptation_proposals
      WHERE tenant_id = ? OR scope = 'platform'
      ORDER BY created_at DESC;
    `;
    const rows = await this.client.query(query, [tenantId]);
    return rows.map((r) => this.mapProposal(r));
  }

  public async updateProposalStatus(
    id: string,
    approvalStatus: 'approved' | 'rejected',
    approvedBy: string,
    versionTag?: string
  ): Promise<void> {
    const now = new Date().toISOString();
    const query = `
      UPDATE adaptation_proposals
      SET approval_status = ?, approved_by = ?, approved_at = ?, deployed_version_tag = ?, updated_at = ?
      WHERE id = ?;
    `;
    await this.client.execute(query, [
      approvalStatus,
      approvedBy,
      now,
      versionTag || null,
      now,
      id,
    ]);
  }

  // ============================================================================
  // 3. Canary Evaluations
  // ============================================================================

  public async saveCanaryEvaluation(evalResult: AdaptationCanaryEvaluationResult): Promise<void> {
    const query = `
      INSERT INTO adaptation_canary_evaluations (
        id, tenant_id, proposal_id, version_tag, canary_weight_pct,
        status, baseline_metrics_json, canary_metrics_json,
        regression_detected, rollback_reason, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        canary_weight_pct = excluded.canary_weight_pct,
        status = excluded.status,
        canary_metrics_json = excluded.canary_metrics_json,
        regression_detected = excluded.regression_detected,
        rollback_reason = excluded.rollback_reason,
        updated_at = excluded.updated_at;
    `;

    await this.client.execute(query, [
      evalResult.id,
      evalResult.tenantId,
      evalResult.proposalId,
      evalResult.versionTag,
      evalResult.canaryWeightPct,
      evalResult.status,
      JSON.stringify(evalResult.baselineMetrics),
      JSON.stringify(evalResult.canaryMetrics),
      evalResult.regressionDetected ? 1 : 0,
      evalResult.rollbackReason || null,
      evalResult.createdAt,
      evalResult.updatedAt,
    ]);
  }

  public async getCanaryEvaluationByProposal(proposalId: string): Promise<AdaptationCanaryEvaluationResult | null> {
    const query = `
      SELECT * FROM adaptation_canary_evaluations
      WHERE proposal_id = ?
      ORDER BY created_at DESC LIMIT 1;
    `;
    const row = await this.client.queryOne(query, [proposalId]);
    return row ? this.mapCanaryEvaluation(row) : null;
  }

  // ============================================================================
  // Mappers
  // ============================================================================

  private mapFailureSignature(r: any): FailureSignature {
    return {
      id: r.id,
      tenantId: r.tenant_id,
      failureClass: r.failure_class,
      businessType: r.business_type,
      agentId: r.agent_id,
      agentSlug: r.agent_slug,
      stage: r.stage,
      rootCause: r.root_cause,
      frequency: Number(r.frequency),
      costUsd: Number(r.cost_usd),
      customerImpact: r.customer_impact,
      modelTier: r.model_tier,
      metadata: r.metadata_json ? JSON.parse(r.metadata_json) : {},
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  private mapProposal(r: any): RemediationProposal {
    return {
      id: r.id,
      tenantId: r.tenant_id,
      scope: r.scope,
      proposalType: r.proposal_type,
      title: r.title,
      description: r.description,
      targetFailureClass: r.target_failure_class,
      clusterSignatureId: r.cluster_signature_id || undefined,
      requiresHumanApproval: Boolean(r.requires_human_approval),
      proposedChanges: r.proposed_changes_json ? JSON.parse(r.proposed_changes_json) : {},
      goldenSuiteValidation: r.golden_suite_validation_json
        ? JSON.parse(r.golden_suite_validation_json)
        : undefined,
      simulationStatus: r.simulation_status,
      approvalStatus: r.approval_status,
      approvedBy: r.approved_by,
      approvedAt: r.approved_at,
      deployedVersionTag: r.deployed_version_tag,
      metadata: r.metadata_json ? JSON.parse(r.metadata_json) : {},
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  private mapCanaryEvaluation(r: any): AdaptationCanaryEvaluationResult {
    return {
      id: r.id,
      tenantId: r.tenant_id,
      proposalId: r.proposal_id,
      versionTag: r.version_tag,
      canaryWeightPct: Number(r.canary_weight_pct),
      status: r.status,
      baselineMetrics: r.baseline_metrics_json ? JSON.parse(r.baseline_metrics_json) : ({} as any),
      canaryMetrics: r.canary_metrics_json ? JSON.parse(r.canary_metrics_json) : ({} as any),
      regressionDetected: Boolean(r.regression_detected),
      rollbackReason: r.rollback_reason,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }
}
