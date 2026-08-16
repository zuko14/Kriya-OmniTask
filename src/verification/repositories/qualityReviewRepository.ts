/**
 * Xylarc AI — Quality Reviews Relational Repository
 * Persistence and aggregation for pre-flight and quality evaluations (§14, §15 of CLAUDE.md).
 */

import { BaseRepository } from '../../storage/repositories/baseRepository.js';
import { DatabaseClient } from '../../storage/db.js';
import {
  QualityReviewRecord,
  QualityReviewRequest,
  QualityReviewResult,
  QualityVerdict,
  VerificationMetricsOverview,
} from '../types/verificationTypes.js';
import { CryptoUtils } from '../../core/utils/crypto.js';

export class QualityReviewRepository extends BaseRepository<QualityReviewRecord> {
  protected readonly tableName = 'quality_reviews';

  constructor(client?: DatabaseClient) {
    super(client);
  }

  /**
   * Persists a completed quality review evaluation.
   */
  public async createReview(
    request: QualityReviewRequest,
    result: QualityReviewResult
  ): Promise<QualityReviewRecord> {
    const tenantId = this.getTenantId();
    const id = CryptoUtils.generateId();
    const now = new Date().toISOString();

    const record: QualityReviewRecord = {
      id,
      tenant_id: tenantId,
      organization_id: 'default',
      correlation_id: request.correlationId,
      trace_id: request.traceId,
      agent_id: request.agentId,
      target_content: request.targetContent,
      retrieved_evidence_json: JSON.stringify(request.retrievedEvidence),
      verdict: result.verdict,
      faithfulness_score: result.faithfulnessScore,
      policy_compliance_score: result.policyComplianceScore,
      tone_clarity_score: result.toneClarityScore,
      overall_score: result.overallScore,
      flagged_issues_json: JSON.stringify(result.flaggedIssues),
      corrected_content: result.correctedContent,
      reviewer_type: result.reviewerType,
      reviewed_at: now,
      created_at: now,
      updated_at: now,
    };

    await this.client.execute(
      `INSERT INTO quality_reviews (
        id, tenant_id, organization_id, correlation_id, trace_id, agent_id,
        target_content, retrieved_evidence_json, verdict, faithfulness_score,
        policy_compliance_score, tone_clarity_score, overall_score,
        flagged_issues_json, corrected_content, reviewer_type, reviewed_at,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        record.id,
        record.tenant_id,
        record.organization_id,
        record.correlation_id,
        record.trace_id || null,
        record.agent_id,
        record.target_content,
        record.retrieved_evidence_json,
        record.verdict,
        record.faithfulness_score,
        record.policy_compliance_score,
        record.tone_clarity_score,
        record.overall_score,
        record.flagged_issues_json,
        record.corrected_content || null,
        record.reviewer_type,
        record.reviewed_at,
        record.created_at,
        record.updated_at,
      ]
    );

    return record;
  }

  /**
   * Lists reviews with optional filtering.
   */
  public async listReviews(filter?: {
    agentId?: string;
    verdict?: QualityVerdict;
    limit?: number;
  }): Promise<QualityReviewRecord[]> {
    const tenantId = this.getTenantId();
    let sql = 'SELECT * FROM quality_reviews WHERE tenant_id = ?';
    const params: unknown[] = [tenantId];

    if (filter?.agentId) {
      sql += ' AND agent_id = ?';
      params.push(filter.agentId);
    }
    if (filter?.verdict) {
      sql += ' AND verdict = ?';
      params.push(filter.verdict);
    }

    sql += ' ORDER BY reviewed_at DESC LIMIT ?;';
    params.push(filter?.limit || 50);

    return this.client.query<QualityReviewRecord>(sql, params);
  }

  /**
   * Aggregates quality review metrics for the tenant.
   */
  public async getMetricsOverview(): Promise<VerificationMetricsOverview> {
    const tenantId = this.getTenantId();
    const reviews = await this.client.query<QualityReviewRecord>(
      'SELECT * FROM quality_reviews WHERE tenant_id = ?;',
      [tenantId]
    );

    if (reviews.length === 0) {
      return {
        totalReviews: 0,
        approvedCount: 0,
        revisedCount: 0,
        rejectedCount: 0,
        approvalRatePct: 100,
        avgFaithfulness: 1.0,
        avgOverallScore: 1.0,
      };
    }

    const totalReviews = reviews.length;
    const approvedCount = reviews.filter((r) => r.verdict === 'approved').length;
    const revisedCount = reviews.filter((r) => r.verdict === 'revise').length;
    const rejectedCount = reviews.filter((r) => r.verdict === 'reject_escalate').length;

    const totalFaithfulness = reviews.reduce((sum, r) => sum + r.faithfulness_score, 0);
    const totalOverall = reviews.reduce((sum, r) => sum + r.overall_score, 0);

    return {
      totalReviews,
      approvedCount,
      revisedCount,
      rejectedCount,
      approvalRatePct: Math.round((approvedCount / totalReviews) * 1000) / 10,
      avgFaithfulness: Math.round((totalFaithfulness / totalReviews) * 100) / 100,
      avgOverallScore: Math.round((totalOverall / totalReviews) * 100) / 100,
    };
  }
}
