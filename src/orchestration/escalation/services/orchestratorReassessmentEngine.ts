import {
  StructuredFailureRecord,
  RemediationResult,
  DEFAULT_BUDGET_CEILINGS,
  LevelBudgetLimits,
} from '../types/escalationTypes.js';
import { AttentionService } from '../../../attention/service/attentionService.js';
import { auditLogger } from '../../../security/audit/auditLogger.js';
import { logger } from '../../../core/logger/logger.js';

export class OrchestratorReassessmentEngine {
  private attentionService: AttentionService;
  private budgetLimits: LevelBudgetLimits;

  constructor(
    attentionService: AttentionService = new AttentionService(),
    budgetLimits: LevelBudgetLimits = DEFAULT_BUDGET_CEILINGS.orchestrator
  ) {
    this.attentionService = attentionService;
    this.budgetLimits = budgetLimits;
  }

  /**
   * Reassesses a task that could not be resolved at Supervisor level (§5).
   */
  public async reassess(
    failure: StructuredFailureRecord,
    traceHistorySummary: string,
    currentTraceCostUsd = 0.0,
    currentTraceDurationMs = 0
  ): Promise<RemediationResult> {
    const startTime = Date.now();

    // Check if task can be decomposed differently
    const canDecompose = Boolean(failure.metadata?.decomposable) && failure.attemptsCount <= this.budgetLimits.maxAttempts;

    if (canDecompose) {
      logger.info(`[ORCHESTRATOR] Reassessing task '${failure.taskId}': Decomposing into parallel sub-agent workflows.`, {
        tenantId: failure.tenantId,
        taskId: failure.taskId,
      });

      return {
        success: true,
        actionTaken: 'route_up',
        nextLevel: 'orchestrator',
        remediatedOutput: {
          strategy: 'decomposed_parallel_execution',
          subTasks: [
            { id: `${failure.taskId}_part1`, description: 'Extract parameters & validate' },
            { id: `${failure.taskId}_part2`, description: 'Execute domain fulfillment' },
          ],
        },
        remediationNotes: 'Orchestrator restructured task into decomposed sub-tasks across specialized agents.',
        costUsd: 0.005,
        durationMs: Date.now() - startTime,
      };
    }

    // Otherwise, declare unfulfillable and escalate to Human Attention Center
    logger.warn(`[ORCHESTRATOR] Task '${failure.taskId}' unfulfillable autonomously. Escalating to Human Attention Center.`, {
      tenantId: failure.tenantId,
      taskId: failure.taskId,
      failureClass: failure.failureClass,
    });

    const attentionItem = await this.attentionService.escalateToHuman({
      correlationId: failure.correlationId,
      sourceAgentId: failure.agentId,
      title: `Task Escalation: ${failure.agentSlug} failed on ${failure.failureClass}`,
      description: `Task '${failure.taskId}' unresolved after supervisor & orchestrator stages: ${failure.errorMessage}. ${traceHistorySummary}`,
      reasonCategory: failure.riskTier === 'CRITICAL' ? 'security_anomaly' : 'low_confidence',
      priority: failure.riskTier === 'CRITICAL' ? 'P0_CRITICAL' : failure.riskTier === 'HIGH' ? 'P1_HIGH' : 'P2_MEDIUM',
      customerId: (failure.metadata?.customerId as string) || undefined,
      channel: (failure.metadata?.channel as any) || 'whatsapp',
      contextData: {
        taskId: failure.taskId,
        correlationId: failure.correlationId,
        failureClass: failure.failureClass,
        stage: failure.stage,
        attemptsCount: failure.attemptsCount,
        riskTier: failure.riskTier,
        isIdempotent: failure.isIdempotent,
        totalCostUsd: currentTraceCostUsd,
        totalDurationMs: currentTraceDurationMs,
      },
      recommendedAction: failure.riskTier === 'CRITICAL' ? 'Review critical action exception and approve/reject manually' : 'Inspect decision trace and guide or complete customer response',
    });

    await auditLogger.logEvent({
      action: 'escalation.attention_escalated',
      resourceType: 'attention_item',
      resourceId: attentionItem.id,
      details: {
        taskId: failure.taskId,
        failureClass: failure.failureClass,
        priority: attentionItem.priority,
      },
    });

    return {
      success: false,
      actionTaken: 'immediate_escalate',
      nextLevel: 'attention',
      attentionItemId: attentionItem.id,
      remediationNotes: `${traceHistorySummary ? traceHistorySummary + ' ' : ''}Task escalated to Human Attention Center (Item ID: ${attentionItem.id}, Priority: ${attentionItem.priority}).`,
      costUsd: 0.0,
      durationMs: Date.now() - startTime,
    };
  }
}
