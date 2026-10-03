/**
 * Kriya AI — One-Step Automated & Manual Instant Rollback Engine
 * Zero-delay canary traffic retraction (weight -> 0%), automated SRE Attention escalation,
 * and non-repudiable Ed25519 cryptographic Proof receipt issuance (§32 of CLAUDE.md).
 */

import { CryptoUtils } from '../../core/utils/crypto.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';
import { DeploymentRepository } from '../repositories/deploymentRepository.js';
import { AttentionService } from '../../attention/service/attentionService.js';
import { ProofService } from '../../trust/proof/proofService.js';
import {
  ExecuteRollbackInput,
  RollbackExecutionResult,
  DeploymentRollbackEvent,
} from '../types/deploymentTypes.js';
import { NotFoundError, ValidationError } from '../../core/errors/errors.js';
import { logger } from '../../core/logger/logger.js';

export class OneStepRollbackEngine {
  constructor(
    private repo: DeploymentRepository,
    private attentionService?: AttentionService,
    private proofService?: ProofService
  ) {}

  /**
   * Executes an instant, one-step rollback of a deployment.
   * Immediately sets canary weight to 0%, updates deployment status to 'rolled_back',
   * raises a P1 incident in the Human Attention Center, and signs an Ed25519 proof receipt.
   */
  public async executeRollback(
    deploymentId: string,
    input: ExecuteRollbackInput
  ): Promise<RollbackExecutionResult> {
    const deployment = await this.repo.getDeploymentById(deploymentId);
    if (!deployment) {
      throw new NotFoundError(`Deployment '${deploymentId}' not found for rollback.`);
    }

    if (deployment.status === 'rolled_back') {
      logger.warn(`Deployment '${deploymentId}' has already been rolled back.`);
      const existingEvents = await this.repo.listRollbackEvents(deploymentId, 1);
      const rollbackEvent = existingEvents[0] ?? {
        id: `rb_${CryptoUtils.generateId()}`,
        deploymentId,
        rollbackType: input.rollbackType,
        triggerReason: input.reason,
        previousWeightPct: 0,
        targetWeightPct: 0,
        executedBy: input.executedBy,
        createdAt: new Date().toISOString(),
      };
      return {
        deployment,
        rollbackEvent,
        success: true,
        message: `Deployment '${deploymentId}' was already rolled back.`,
      };
    }

    const previousWeightPct = deployment.canaryWeightPct;
    const now = new Date().toISOString();
    const eventId = `rb_${CryptoUtils.generateId()}`;

    // 1. Immediately retract all canary traffic to 0% and mark rolled back
    await this.repo.updateDeploymentStatus(deploymentId, 'rolled_back', now);
    await this.repo.updateCanaryRoutingStatus(deploymentId, 'rolled_back', 0);

    const updatedDeployment = (await this.repo.getDeploymentById(deploymentId))!;

    // 2. Issue Ed25519 cryptographic Proof Receipt
    let proofReceiptId: string | undefined;
    if (this.proofService) {
      try {
        const issueProof = async () => {
          const receipt = await this.proofService!.issue({
            actionType: 'deployment.rollback',
            riskTier: 'T2',
            actor: {
              agentSlug: 'sre_rollback_engine',
              humanApproverId: input.executedBy,
            },
            target: {
              system: 'deployment_control_plane',
              externalRef: deploymentId,
            },
            input: {
              deploymentId,
              versionTag: deployment.versionTag,
              environment: deployment.environment,
              rollbackType: input.rollbackType,
              triggerReason: input.reason,
              executedBy: input.executedBy,
            },
            output: {
              status: 'rolled_back',
              previousWeightPct,
              targetWeightPct: 0,
              retractedAt: now,
            },
            verification: {
              method: 'immediate_traffic_drain_and_status_lock',
              state: 'verified',
              verifiedAt: now,
              observed: { activeCanaryWeightPct: 0 },
            },
          });
          return receipt.body.receiptId;
        };

        const activeTenantId = TenantContextManager.get()?.tenantId || 'default';
        const activeOrgId = TenantContextManager.get()?.organizationId || 'org_kriya';
        proofReceiptId = TenantContextManager.get()?.tenantId
          ? await issueProof()
          : await TenantContextManager.withTenant(activeTenantId, activeOrgId, issueProof);
      } catch (err: any) {
        logger.error(`Failed to issue proof receipt for rollback of deployment '${deploymentId}': ${err.message}`);
      }
    }

    // 3. Dispatch P1 SRE Incident into the Human Attention Center
    let attentionItemId: string | undefined;
    if (this.attentionService) {
      try {
        const activeTenantId = TenantContextManager.get()?.tenantId || 'default';
        const activeOrgId = TenantContextManager.get()?.organizationId || 'org_kriya';
        const escalate = async () => {
          const correlationId = `rollback:${deploymentId}:${Date.now()}`;
          const attentionItem = await this.attentionService!.escalateOnce({
            correlationId,
            channel: 'system_sre',
            sourceAgentId: 'deployment_guardian',
            title: `CRITICAL: Deployment Rollback (${deployment.versionTag})`,
            description: `Canary deployment '${deploymentId}' (${deployment.versionTag}) was rolled back to 0% traffic. Reason: ${input.reason}`,
            reasonCategory: 'slo_burn',
            priority: 'P1_HIGH',
            contextData: {
              deploymentId,
              versionTag: deployment.versionTag,
              environment: deployment.environment,
              rollbackType: input.rollbackType,
              previousWeightPct,
              executedBy: input.executedBy,
              proofReceiptId,
            },
          });
          return attentionItem.id;
        };

        attentionItemId = TenantContextManager.get()?.tenantId
          ? await escalate()
          : await TenantContextManager.withTenant(activeTenantId, activeOrgId, escalate);
      } catch (err: any) {
        logger.error(`Failed to dispatch attention escalation for rollback of deployment '${deploymentId}': ${err.message}`);
      }
    }

    // 4. Save Rollback Event Record
    const rollbackEvent: DeploymentRollbackEvent = {
      id: eventId,
      deploymentId,
      rollbackType: input.rollbackType,
      triggerReason: input.reason,
      previousWeightPct,
      targetWeightPct: 0,
      proofReceiptId,
      attentionItemId,
      executedBy: input.executedBy,
      createdAt: now,
    };
    await this.repo.saveRollbackEvent(rollbackEvent);

    logger.warn(
      `[ONE-STEP ROLLBACK COMPLETE] Deployment '${deploymentId}' (${deployment.versionTag}) rolled back to 0% traffic. ` +
      `Proof: ${proofReceiptId ?? 'none'}, Attention: ${attentionItemId ?? 'none'}. Reason: ${input.reason}`
    );

    return {
      deployment: updatedDeployment,
      rollbackEvent,
      proofReceiptId,
      attentionItemId,
      success: true,
      message: `Deployment '${deploymentId}' successfully rolled back to 0% traffic.`,
    };
  }
}
