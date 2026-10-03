import {
  StructuredFailureRecord,
  RemediationResult,
  DEFAULT_BUDGET_CEILINGS,
  LevelBudgetLimits,
} from '../types/escalationTypes.js';
import { ModelCertificationRepository } from '../../../model/certification/modelCertificationRepository.js';
import { auditLogger } from '../../../security/audit/auditLogger.js';
import { logger } from '../../../core/logger/logger.js';

export class SupervisorRemediationService {
  private certRepo: ModelCertificationRepository;
  private budgetLimits: LevelBudgetLimits;

  constructor(
    certRepo: ModelCertificationRepository = new ModelCertificationRepository(),
    budgetLimits: LevelBudgetLimits = DEFAULT_BUDGET_CEILINGS.supervisor
  ) {
    this.certRepo = certRepo;
    this.budgetLimits = budgetLimits;
  }

  /**
   * Evaluates a structured failure record and executes targeted remediation per §5.
   */
  public async remediate(failure: StructuredFailureRecord, currentTraceCostUsd = 0.0, currentTraceDurationMs = 0): Promise<RemediationResult> {
    const startTime = Date.now();

    // =========================================================================
    // Hard Rule 1 (§5): A policy block is NOT a failure to fix.
    // When firewall or a business rule stops an action, STOP and report.
    // NEVER route around it.
    // =========================================================================
    if (failure.failureClass === 'policy_block') {
      logger.warn(`[SUPERVISOR] Policy block for task '${failure.taskId}': ${failure.errorMessage}. Stopping execution.`, {
        tenantId: failure.tenantId,
        taskId: failure.taskId,
        agentSlug: failure.agentSlug,
      });

      await auditLogger.logEvent({
        action: 'escalation.policy_stop',
        resourceType: 'task',
        resourceId: failure.taskId,
        details: { failureClass: 'policy_block', reason: failure.errorMessage },
      });

      return {
        success: false,
        actionTaken: 'policy_stop',
        nextLevel: 'specialist',
        remediationNotes: `Execution stopped by security/governance policy: ${failure.errorMessage}. No retry or bypass allowed.`,
        costUsd: 0.0,
        durationMs: Date.now() - startTime,
      };
    }

    // =========================================================================
    // Hard Rule 2 (§5): No repair of CRITICAL actions.
    // A failed refund, payment, or contract change escalates straight to a human.
    // =========================================================================
    if (failure.failureClass === 'critical_action' || failure.riskTier === 'CRITICAL') {
      logger.warn(`[SUPERVISOR] Critical action failure for task '${failure.taskId}'. Immediate escalation to Attention.`, {
        tenantId: failure.tenantId,
        taskId: failure.taskId,
        riskTier: failure.riskTier,
      });

      await auditLogger.logEvent({
        action: 'escalation.critical_escalate',
        resourceType: 'task',
        resourceId: failure.taskId,
        details: { riskTier: failure.riskTier, reason: failure.errorMessage },
      });

      return {
        success: false,
        actionTaken: 'immediate_escalate',
        nextLevel: 'attention',
        remediationNotes: `Critical action (${failure.riskTier}) failed. Automatic retry prohibited by §5 safety policy.`,
        costUsd: 0.0,
        durationMs: Date.now() - startTime,
      };
    }

    // =========================================================================
    // Hard Rule 3 (§5): Non-idempotent actions cannot be auto-retried.
    // =========================================================================
    if (!failure.isIdempotent) {
      logger.warn(`[SUPERVISOR] Non-idempotent action failed for task '${failure.taskId}'. Auto-retry blocked.`, {
        tenantId: failure.tenantId,
        taskId: failure.taskId,
      });

      return {
        success: false,
        actionTaken: 'immediate_escalate',
        nextLevel: 'attention',
        remediationNotes: 'Non-idempotent action failed. Cannot be auto-retried without risk of duplicate execution.',
        costUsd: 0.0,
        durationMs: Date.now() - startTime,
      };
    }

    // =========================================================================
    // Hard Rule 4 (§5): Bounded attempts, time, and cost per level.
    // =========================================================================
    const supervisorAttempts = failure.escalationLevel === 'supervisor'
      ? failure.attemptsCount
      : Math.max(1, failure.attemptsCount - DEFAULT_BUDGET_CEILINGS.specialist.maxAttempts);

    if (
      supervisorAttempts > this.budgetLimits.maxAttempts ||
      currentTraceDurationMs > this.budgetLimits.maxDurationMs ||
      currentTraceCostUsd > this.budgetLimits.maxCostUsd
    ) {
      logger.warn(`[SUPERVISOR] Budget ceiling exceeded for task '${failure.taskId}'. Escalating to Orchestrator.`, {
        tenantId: failure.tenantId,
        attempts: failure.attemptsCount,
        maxAttempts: this.budgetLimits.maxAttempts,
        durationMs: currentTraceDurationMs,
        costUsd: currentTraceCostUsd,
      });

      return {
        success: false,
        actionTaken: 'immediate_escalate',
        nextLevel: 'orchestrator',
        remediationNotes: `Supervisor budget ceiling reached (attempts=${failure.attemptsCount}/${this.budgetLimits.maxAttempts}, duration=${currentTraceDurationMs}ms, cost=$${currentTraceCostUsd.toFixed(3)}). Escalating to Orchestrator.`,
        costUsd: 0.0,
        durationMs: Date.now() - startTime,
      };
    }

    // =========================================================================
    // Hard Rule 5 (§5): Capability gap is NOT a retry candidate.
    // If the failure was model competence, retrying the same tier will fail the same way.
    // Route up (§9.4) or escalate.
    // =========================================================================
    if (failure.failureClass === 'capability_gap') {
      const language = (failure.metadata?.language as string) || 'en';
      const higherT3 = await this.certRepo.findCertifiedModels('T3', language);
      const higherT4 = await this.certRepo.findCertifiedModels('T4', language);
      const higherModel = higherT4[0] || higherT3[0];

      if (higherModel) {
        logger.info(`[SUPERVISOR] Capability gap on task '${failure.taskId}'. Routing up to certified model '${higherModel.model_id}' (${higherModel.tier}).`, {
          tenantId: failure.tenantId,
          taskId: failure.taskId,
          higherTier: higherModel.tier,
        });

        return {
          success: true,
          actionTaken: 'route_up',
          nextLevel: 'supervisor',
          remediatedOutput: {
            routedUp: true,
            modelId: higherModel.model_id,
            tier: higherModel.tier,
          },
          remediationNotes: `Capability gap remediated by routing up to certified higher tier ${higherModel.tier} (${higherModel.model_id}).`,
          costUsd: 0.005,
          durationMs: Date.now() - startTime,
        };
      } else {
        return {
          success: false,
          actionTaken: 'immediate_escalate',
          nextLevel: 'attention',
          remediationNotes: 'Capability gap detected and no higher certified model is available. Escalating to Human Attention Center.',
          costUsd: 0.0,
          durationMs: Date.now() - startTime,
        };
      }
    }

    // =========================================================================
    // Specific Class Remediations (§5):
    // =========================================================================
    switch (failure.failureClass) {
      case 'transient': {
        if (failure.attemptsCount > DEFAULT_BUDGET_CEILINGS.specialist.maxAttempts) {
          return {
            success: true,
            actionTaken: 'fallback_tool_alternate_agent',
            nextLevel: 'supervisor',
            remediatedOutput: {
              fallbackToolEngaged: true,
              divertedDueToRetryExhaustion: true,
            },
            remediationNotes: `Specialist transient retries exhausted (${failure.attemptsCount} attempts). Supervisor diverted execution to alternate agent/tool.`,
            costUsd: 0.002,
            durationMs: Date.now() - startTime,
          };
        }

        // Retry with exponential backoff
        return {
          success: true,
          actionTaken: 'retry_with_backoff',
          nextLevel: 'specialist',
          remediatedOutput: {
            retryScheduled: true,
            backoffMs: Math.min(1000 * Math.pow(2, failure.attemptsCount - 1), 5000),
          },
          remediationNotes: `Transient failure detected. Scheduled retry #${failure.attemptsCount + 1} with exponential backoff.`,
          costUsd: 0.001,
          durationMs: Date.now() - startTime,
        };
      }

      case 'bad_input': {
        // Re-request or re-extract parameters
        return {
          success: true,
          actionTaken: 're_request_re_extract',
          nextLevel: 'specialist',
          remediatedOutput: {
            reExtractionTriggered: true,
            missingFields: failure.metadata?.missingFields || ['required_param'],
          },
          remediationNotes: 'Input validation failure. Triggered deterministic parameter re-extraction and normalized schema re-dispatch.',
          costUsd: 0.001,
          durationMs: Date.now() - startTime,
        };
      }

      case 'tool_failure': {
        // Fallback tool or alternate agent
        return {
          success: true,
          actionTaken: 'fallback_tool_alternate_agent',
          nextLevel: 'supervisor',
          remediatedOutput: {
            fallbackToolEngaged: true,
            originalTool: failure.metadata?.toolSlug || 'primary_tool',
            fallbackTool: failure.metadata?.fallbackToolSlug || 'secondary_tool',
          },
          remediationNotes: `Tool execution failed. Diverted invocation to registered fallback tool (${failure.metadata?.fallbackToolSlug || 'secondary_tool'}).`,
          costUsd: 0.002,
          durationMs: Date.now() - startTime,
        };
      }

      case 'model_failure': {
        // Fallback certified model in same or higher tier
        const language = (failure.metadata?.language as string) || 'en';
        const currentTier = (failure.metadata?.tier as any) || 'T2';
        const candidates = await this.certRepo.findCertifiedModels(currentTier, language);
        const fallbackCandidate = candidates.find((m) => m.model_id !== failure.metadata?.modelId) || candidates[0];

        if (fallbackCandidate) {
          return {
            success: true,
            actionTaken: 'fallback_certified_model',
            nextLevel: 'supervisor',
            remediatedOutput: {
              fallbackModelId: fallbackCandidate.model_id,
              tier: fallbackCandidate.tier,
            },
            remediationNotes: `Primary model failed. Failover to certified alternative model '${fallbackCandidate.model_id}' in tier ${fallbackCandidate.tier}.`,
            costUsd: 0.003,
            durationMs: Date.now() - startTime,
          };
        } else {
          return {
            success: false,
            actionTaken: 'immediate_escalate',
            nextLevel: 'orchestrator',
            remediationNotes: 'Model failure detected and no alternative certified model available in current tier. Escalating to Orchestrator.',
            costUsd: 0.0,
            durationMs: Date.now() - startTime,
          };
        }
      }

      case 'scope_mismatch': {
        // Re-dispatch to correct specialist agent
        const targetAgent = (failure.metadata?.recommendedAgentSlug as string) || 'customer_support_specialist';
        return {
          success: true,
          actionTaken: 'redispatch_specialist',
          nextLevel: 'supervisor',
          remediatedOutput: {
            redispatched: true,
            sourceAgent: failure.agentSlug,
            targetAgentSlug: targetAgent,
          },
          remediationNotes: `Scope mismatch on agent '${failure.agentSlug}'. Re-dispatching task to appropriate specialist agent '${targetAgent}'.`,
          costUsd: 0.001,
          durationMs: Date.now() - startTime,
        };
      }

      default: {
        return {
          success: false,
          actionTaken: 'immediate_escalate',
          nextLevel: 'orchestrator',
          remediationNotes: `Unclassified failure class '${failure.failureClass}'. Escalating to Orchestrator.`,
          costUsd: 0.0,
          durationMs: Date.now() - startTime,
        };
      }
    }
  }
}
