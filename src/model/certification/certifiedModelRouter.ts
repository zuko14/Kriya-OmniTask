import { CapabilityTier, DegradationResolution } from './certificationTypes.js';
import { ModelCertificationRepository } from './modelCertificationRepository.js';
import { AttentionRepository } from '../../attention/repositories/attentionRepository.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';
import { auditLogger } from '../../security/audit/auditLogger.js';
import { logger } from '../../core/logger/logger.js';

export interface RouteModelRequest {
  tenantId: string;
  requiredTier: CapabilityTier;
  language: string;
  taskId: string;
  taskDescription: string;
  degradationPolicy?: 'route_up' | 'decompose' | 'reduce_autonomy' | 'escalate';
  forceProviderOutage?: boolean;
}

export interface RouteModelResponse {
  success: boolean;
  modelId?: string;
  tierUsed?: CapabilityTier;
  degraded: boolean;
  degradationResolution?: DegradationResolution;
  error?: string;
}

export class CertifiedModelRouter {
  private certRepo: ModelCertificationRepository;
  private attentionRepo: AttentionRepository;

  constructor(
    certRepo: ModelCertificationRepository = new ModelCertificationRepository(),
    attentionRepo: AttentionRepository = new AttentionRepository()
  ) {
    this.certRepo = certRepo;
    this.attentionRepo = attentionRepo;
  }

  /**
   * Routes a task to a certified model matching the required tier and language.
   * If uncertified or unavailable, executes the strict 4-step degradation order (§9.4, §23):
   * 1. ROUTE UP
   * 2. DECOMPOSE
   * 3. REDUCE AUTONOMY
   * 4. ESCALATE
   */
  public async routeTask(request: RouteModelRequest): Promise<RouteModelResponse> {
    const { tenantId, requiredTier, language, taskId, taskDescription, forceProviderOutage } = request;

    // Check if total provider outage is simulated/occurring
    if (forceProviderOutage) {
      logger.warn(`Total provider outage detected for task '${taskId}'. Executing immediate escalation.`, {
        tenantId,
        taskId,
      });
      return this.executeStep4Escalate(
        tenantId,
        taskId,
        requiredTier,
        taskDescription,
        'Total model provider outage: All upstream inference providers unavailable'
      );
    }

    // Step 0: Try exact tier + language certified model
    const exactCertified = await this.certRepo.findCertifiedModels(requiredTier, language);
    if (exactCertified.length > 0) {
      const selected = exactCertified[0];
      return {
        success: true,
        modelId: selected.model_id,
        tierUsed: requiredTier,
        degraded: false,
      };
    }

    // No certified model for exact tier. Begin 4-step degradation order!
    logger.warn(`No certified model found for tier '${requiredTier}' and language '${language}'. Starting degradation ladder.`, {
      tenantId,
      requiredTier,
      language,
      taskId,
    });

    // =========================================================================
    // 1. ROUTE UP: Try a certified higher-tier model
    // =========================================================================
    const higherTiers = this.getHigherTiers(requiredTier);
    for (const higherTier of higherTiers) {
      const higherCertified = await this.certRepo.findCertifiedModels(higherTier, language);
      if (higherCertified.length > 0) {
        const selectedHigher = higherCertified[0];
        logger.info(`Degradation Step 1 (ROUTE UP): Upgraded task '${taskId}' from ${requiredTier} to ${higherTier} on model '${selectedHigher.model_id}'`, {
          tenantId,
          taskId,
          originalTier: requiredTier,
          higherTier,
        });

        await auditLogger.logEvent({
          action: 'model.degradation.route_up',
          resourceType: 'task',
          resourceId: taskId,
          details: { originalTier: requiredTier, upgradedTier: higherTier, modelId: selectedHigher.model_id },
        });

        return {
          success: true,
          modelId: selectedHigher.model_id,
          tierUsed: higherTier,
          degraded: true,
          degradationResolution: {
            actionTaken: 'route_up',
            originalTier: requiredTier,
            resolvedTier: higherTier,
            resolvedModelId: selectedHigher.model_id,
            reason: `No certified model for ${requiredTier}/${language}. Routed up to certified ${higherTier} model.`,
          },
        };
      }
    }

    // =========================================================================
    // 2. DECOMPOSE: Break task into smaller T1/T2 sub-steps
    // =========================================================================
    const lowerT1 = await this.certRepo.findCertifiedModels('T1', language);
    const lowerT2 = await this.certRepo.findCertifiedModels('T2', language);

    if (lowerT1.length > 0 || lowerT2.length > 0) {
      const subTasks = [
        { id: `${taskId}_sub_1`, tier: 'T1' as CapabilityTier, description: 'Extract structured parameters & intent' },
        { id: `${taskId}_sub_2`, tier: 'T2' as CapabilityTier, description: 'Draft segmented response in target language' },
      ];

      logger.info(`Degradation Step 2 (DECOMPOSE): Decomposed task '${taskId}' into T1/T2 sub-steps.`, {
        tenantId,
        taskId,
        subTasks,
      });

      await auditLogger.logEvent({
        action: 'model.degradation.decompose',
        resourceType: 'task',
        resourceId: taskId,
        details: { originalTier: requiredTier, subTasks },
      });

      return {
        success: true,
        modelId: (lowerT2[0] || lowerT1[0]).model_id,
        tierUsed: 'T2',
        degraded: true,
        degradationResolution: {
          actionTaken: 'decompose',
          originalTier: requiredTier,
          subTasks,
          reason: `No certified high-tier model. Decomposed task into T1/T2 composite procedures.`,
        },
      };
    }

    // =========================================================================
    // 3. REDUCE AUTONOMY: Produce draft for human approval instead of executing
    // =========================================================================
    const fallbackT1 = await this.certRepo.findCertifiedModels('T1', 'en');
    const fallbackT2 = await this.certRepo.findCertifiedModels('T2', 'en');
    const fallbackT3 = await this.certRepo.findCertifiedModels('T3', 'en');
    const fallbackT4 = await this.certRepo.findCertifiedModels('T4', 'en');
    const fallbackAnyTier = fallbackT1[0] || fallbackT2[0] || fallbackT3[0] || fallbackT4[0];

    if (fallbackAnyTier) {
      logger.info(`Degradation Step 3 (REDUCE AUTONOMY): Reduced autonomy for task '${taskId}' to draft_for_approval.`, {
        tenantId,
        taskId,
      });

      await auditLogger.logEvent({
        action: 'model.degradation.reduce_autonomy',
        resourceType: 'task',
        resourceId: taskId,
        details: { originalTier: requiredTier, newAutonomy: 'draft_for_approval' },
      });

      return {
        success: true,
        modelId: fallbackAnyTier.model_id,
        tierUsed: fallbackAnyTier.tier,
        degraded: true,
        degradationResolution: {
          actionTaken: 'reduce_autonomy',
          originalTier: requiredTier,
          autonomyReducedTo: 'draft_for_approval',
          reason: `Reduced autonomy level: generated draft pending operator approval.`,
        },
      };
    }

    // =========================================================================
    // 4. ESCALATE: Escalate to human operator with full context
    // =========================================================================
    return this.executeStep4Escalate(
      tenantId,
      taskId,
      requiredTier,
      taskDescription,
      `No certified model available for tier '${requiredTier}' and language '${language}'.`
    );
  }

  private async executeStep4Escalate(
    tenantId: string,
    taskId: string,
    requiredTier: CapabilityTier,
    taskDescription: string,
    reason: string
  ): Promise<RouteModelResponse> {
    let escalationItemId = `att_degrade_${taskId}_${Date.now()}`;

    await TenantContextManager.withTenant(tenantId, 'default', async () => {
      const slaExpiresAt = new Date(Date.now() + 1800 * 1000).toISOString();
      const createdItem = await this.attentionRepo.createItem(
        {
          correlationId: TenantContextManager.getCorrelationId(),
          title: `Model Degradation Escalation: ${requiredTier} Task Unfulfilled`,
          description: `Task '${taskId}' cannot be executed safely: ${reason}. Escalated to human operator with full context.`,
          reasonCategory: 'workflow_suspended',
          sourceAgentId: 'model_router',
          channel: 'web',
          contextData: { taskId, taskDescription, requiredTier, reason },
          recommendedAction: 'Assign operator to handle inquiry or review Model Registry certifications',
        },
        'P0_CRITICAL',
        slaExpiresAt
      );
      escalationItemId = createdItem.id;

      await auditLogger.logEvent({
        action: 'model.degradation.escalate',
        resourceType: 'task',
        resourceId: taskId,
        details: { requiredTier, reason, escalationItemId },
      });
    }, { userId: 'model_router', roles: ['system', 'operator'] });

    return {
      success: false,
      degraded: true,
      error: reason,
      degradationResolution: {
        actionTaken: 'escalate',
        originalTier: requiredTier,
        escalationAttentionItemId: escalationItemId,
        reason,
      },
    };
  }

  private getHigherTiers(tier: CapabilityTier): CapabilityTier[] {
    if (tier === 'T1') return ['T2', 'T3', 'T4'];
    if (tier === 'T2') return ['T3', 'T4'];
    if (tier === 'T3') return ['T4'];
    return [];
  }
}
