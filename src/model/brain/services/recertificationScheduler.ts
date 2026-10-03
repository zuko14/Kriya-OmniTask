import { BrainSupplyRepository } from '../repositories/brainSupplyRepository.js';
import { ModelCertificationRepository } from '../../certification/modelCertificationRepository.js';
import { AlignmentStreamService } from './alignmentStreamService.js';
import { TenantBrainRecord } from '../types/brainSupplyTypes.js';
import { auditLogger } from '../../../security/audit/auditLogger.js';
import { logger } from '../../../core/logger/logger.js';

export class RecertificationScheduler {
  private brainRepo: BrainSupplyRepository;
  private certRepo: ModelCertificationRepository;
  private alignmentService: AlignmentStreamService;

  constructor(
    brainRepo: BrainSupplyRepository = new BrainSupplyRepository(),
    certRepo: ModelCertificationRepository = new ModelCertificationRepository(),
    alignmentService: AlignmentStreamService = new AlignmentStreamService(brainRepo, certRepo)
  ) {
    this.brainRepo = brainRepo;
    this.certRepo = certRepo;
    this.alignmentService = alignmentService;
  }

  /**
   * Scans all brains for scheduled expiry (30-day window) (§9.9).
   * Brains past expiry are marked 'stale' and continue serving only last-passed tiers.
   */
  public async checkScheduledExpirations(tenantId: string): Promise<TenantBrainRecord[]> {
    const brains = await this.brainRepo.listTenantBrains(tenantId);
    const now = new Date();
    const staleBrains: TenantBrainRecord[] = [];

    for (const brain of brains) {
      if (brain.status === 'certified' && brain.expiresAt) {
        const expiryDate = new Date(brain.expiresAt);
        if (now > expiryDate) {
          logger.warn(`[RECERTIFICATION] Brain '${brain.id}' (${brain.modelId}) has expired. Marking as 'stale'.`, {
            tenantId,
            brainId: brain.id,
            expiresAt: brain.expiresAt,
          });

          const updated: TenantBrainRecord = {
            ...brain,
            status: 'stale',
            healthStatus: 'degraded',
            updatedAt: now.toISOString(),
          };

          await this.brainRepo.saveTenantBrain(updated);
          staleBrains.push(updated);

          await auditLogger.logEvent({
            action: 'brain.marked_stale_expired',
            resourceType: 'tenant_brain',
            resourceId: brain.id,
            details: {
              tenantId,
              modelId: brain.modelId,
              expiresAt: brain.expiresAt,
            },
          });
        }
      }
    }

    return staleBrains;
  }

  /**
   * Triggers re-certification on version change, router upstream change, key rotation, or drift (§9.9).
   */
  public async triggerRecertification(
    tenantId: string,
    brainId: string,
    reason: 'version_change' | 'upstream_change' | 'key_rotation' | 'drift_detected' | 'manual_schedule'
  ): Promise<{ runId: string; status: string }> {
    const brain = await this.brainRepo.getTenantBrain(brainId, tenantId);
    if (!brain) {
      throw new Error(`Brain '${brainId}' not found for tenant '${tenantId}'`);
    }

    logger.info(`[RECERTIFICATION] Triggering re-certification for brain '${brainId}' due to: ${reason}`, {
      tenantId,
      modelId: brain.modelId,
      reason,
    });

    // Invalidate prior certification records if version/upstream changed
    if (reason === 'version_change' || reason === 'upstream_change') {
      await this.certRepo.invalidateOnVersionOrUpstreamChange(brain.modelId, brain.modelVersion);
    }

    const run = await this.alignmentService.startAlignmentCheck(
      tenantId,
      brain.modelId,
      brain.modelVersion,
      brain.provider,
      brain.certifiedTiers.length > 0 ? brain.certifiedTiers : ['T1', 'T2', 'T3', 'T4'],
      brain.certifiedLanguages.length > 0 ? brain.certifiedLanguages : ['en', 'hi', 'te']
    );

    await auditLogger.logEvent({
      action: 'brain.recertification_triggered',
      resourceType: 'tenant_brain',
      resourceId: brainId,
      details: {
        tenantId,
        modelId: brain.modelId,
        reason,
        runId: run.id,
      },
    });

    return {
      runId: run.id,
      status: 'running',
    };
  }
}
