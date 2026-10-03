/**
 * Kriya AI — Verification & Quality Review Controller Service
 * High-level service managing pre-flight assertions, LLM-judge quality evaluations, and review persistence (§14, §15 of CLAUDE.md).
 */

import {
  QualityReviewRequest,
  QualityReviewRecord,
  QualityVerdict,
  VerificationMetricsOverview,
} from '../types/verificationTypes.js';
import { QualityReviewRepository } from '../repositories/qualityReviewRepository.js';
import { QualityReviewer } from '../reviewer/qualityReviewer.js';
import { NotFoundError } from '../../core/errors/errors.js';
import { logger } from '../../core/logger/logger.js';

export class VerificationService {
  private reviewRepo: QualityReviewRepository;

  constructor(reviewRepo?: QualityReviewRepository) {
    this.reviewRepo = reviewRepo || new QualityReviewRepository();
  }

  /**
   * Reviews target content against deterministic pre-flight checks and dual-pass quality evaluation.
   */
  public async reviewContent(request: QualityReviewRequest): Promise<QualityReviewRecord> {
    const result = QualityReviewer.evaluate(request);

    if (result.verdict === 'reject_escalate') {
      logger.warn(
        `Verification rejected agent '${request.agentId}' content: ${result.flaggedIssues.join(', ')}`
      );
    }

    return this.reviewRepo.createReview(request, result);
  }

  /**
   * Retrieves an individual quality review record by ID.
   */
  public async getReview(id: string): Promise<QualityReviewRecord> {
    const review = await this.reviewRepo.findById(id);
    if (!review) throw new NotFoundError(`Quality review '${id}' not found.`);
    return review;
  }

  /**
   * Lists reviews matching query filters.
   */
  public async listReviews(filter?: {
    agentId?: string;
    verdict?: QualityVerdict;
    limit?: number;
  }): Promise<QualityReviewRecord[]> {
    return this.reviewRepo.listReviews(filter);
  }

  /**
   * Aggregates quality review metrics overview.
   */
  public async getMetricsOverview(): Promise<VerificationMetricsOverview> {
    return this.reviewRepo.getMetricsOverview();
  }
}
