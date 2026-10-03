import {
  StructuredFailureRecord,
  CreateStructuredFailureInput,
  StructuredFailureRecordSchema,
  EscalationTraceRecord,
  RemediationResult,
  EscalationLevel,
} from './types/escalationTypes.js';
import { EscalationRepository } from './repositories/escalationRepository.js';
import { SupervisorRemediationService } from './services/supervisorRemediationService.js';
import { OrchestratorReassessmentEngine } from './services/orchestratorReassessmentEngine.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';
import { logger } from '../../core/logger/logger.js';

export interface ProcessFailureResult {
  trace: EscalationTraceRecord;
  remediation: RemediationResult;
  finalLevel: EscalationLevel;
  resolved: boolean;
}

export class FailureEscalationChain {
  private static instance: FailureEscalationChain;
  private repo: EscalationRepository;
  private supervisor: SupervisorRemediationService;
  private orchestrator: OrchestratorReassessmentEngine;

  constructor(
    repo: EscalationRepository = new EscalationRepository(),
    supervisor: SupervisorRemediationService = new SupervisorRemediationService(),
    orchestrator: OrchestratorReassessmentEngine = new OrchestratorReassessmentEngine()
  ) {
    this.repo = repo;
    this.supervisor = supervisor;
    this.orchestrator = orchestrator;
  }

  public static getInstance(): FailureEscalationChain {
    if (!FailureEscalationChain.instance) {
      FailureEscalationChain.instance = new FailureEscalationChain();
    }
    return FailureEscalationChain.instance;
  }

  /**
   * Main entry point: Processes a specialist failure through the structured escalation chain (§5).
   */
  public async handleFailure(failureInput: CreateStructuredFailureInput | StructuredFailureRecord): Promise<ProcessFailureResult> {
    const failure = StructuredFailureRecordSchema.parse(failureInput);
    return TenantContextManager.withTenant(
      failure.tenantId,
      'default',
      async () => {
        const now = new Date().toISOString();

        // 1. Persist initial failure record
        await this.repo.saveFailureRecord(failure);

        // 2. Initialize or fetch unified trace for this task
        let trace = await this.repo.getOrCreateTrace(
          failure.tenantId,
          failure.taskId,
          failure.correlationId,
          'specialist'
        );

        // 3. Append Step 1: Specialist Failure Emission
        trace = await this.repo.appendTraceStep(
          failure.tenantId,
          failure.taskId,
          {
            timestamp: now,
            level: 'specialist',
            actor: failure.agentSlug,
            action: `specialist_failure_${failure.failureClass}`,
            failureClass: failure.failureClass,
            outcome: 'failure',
            evidence: {
              error: failure.errorMessage,
              stage: failure.stage,
              confidence: failure.confidence,
              riskTier: failure.riskTier,
              isIdempotent: failure.isIdempotent,
              inputsHash: failure.inputsHash,
              correlationId: failure.correlationId,
            },
            reason: failure.errorMessage,
            durationMs: 50,
            costUsd: 0.001,
          },
          { currentLevel: 'specialist' }
        );

        // 4. Level 2: Supervisor Remediation Evaluation (§5)
        logger.info(`[ESCALATION CHAIN] Escalating task '${failure.taskId}' to Supervisor level.`, {
          tenantId: failure.tenantId,
          failureClass: failure.failureClass,
        });

        const initialCostUsd = Math.max(trace.totalCostUsd, (failure.metadata?.costUsd as number) || 0);
        const initialDurationMs = Math.max(trace.totalDurationMs, (failure.metadata?.durationMs as number) || 0);

        const supervisorResult = await this.supervisor.remediate(
          failure,
          initialCostUsd,
          initialDurationMs
        );

        // Append Step 2: Supervisor Action
        trace = await this.repo.appendTraceStep(
          failure.tenantId,
          failure.taskId,
          {
            timestamp: new Date().toISOString(),
            level: 'supervisor',
            actor: 'workforce_supervisor_agent',
            action: `supervisor_remediation_${supervisorResult.actionTaken}`,
            failureClass: failure.failureClass,
            remediationAttempted: supervisorResult.actionTaken,
            outcome: supervisorResult.success
              ? 'success'
              : supervisorResult.actionTaken === 'policy_stop'
              ? 'stopped'
              : 'escalated',
            evidence: {
              notes: supervisorResult.remediationNotes,
              output: supervisorResult.remediatedOutput || {},
              nextLevel: supervisorResult.nextLevel,
              correlationId: failure.correlationId,
            },
            reason: supervisorResult.remediationNotes,
            durationMs: supervisorResult.durationMs,
            costUsd: supervisorResult.costUsd,
          },
          {
            currentLevel: supervisorResult.nextLevel,
            status: supervisorResult.success
              ? 'resolved'
              : supervisorResult.actionTaken === 'policy_stop'
              ? 'stopped_by_policy'
              : 'in_progress',
          }
        );

        // If supervisor resolved it or policy stopped it, conclude
        if (supervisorResult.success || supervisorResult.actionTaken === 'policy_stop') {
          await this.repo.saveFailureRecord({
            ...failure,
            remediationStatus: supervisorResult.success ? 'remediated' : 'stopped_by_policy',
            escalationLevel: supervisorResult.nextLevel,
            updatedAt: new Date().toISOString(),
          });

          return {
            trace,
            remediation: supervisorResult,
            finalLevel: supervisorResult.nextLevel,
            resolved: supervisorResult.success,
          };
        }

        // If supervisor escalated to Attention or Orchestrator
        if (supervisorResult.nextLevel === 'attention' || supervisorResult.nextLevel === 'orchestrator') {
          const orchestratorResult = await this.orchestrator.reassess(
            failure,
            supervisorResult.remediationNotes,
            trace.totalCostUsd,
            trace.totalDurationMs
          );

          trace = await this.repo.appendTraceStep(
            failure.tenantId,
            failure.taskId,
            {
              timestamp: new Date().toISOString(),
              level: orchestratorResult.nextLevel,
              actor: orchestratorResult.nextLevel === 'attention' ? 'human_attention_center' : 'hierarchical_orchestrator',
              action: orchestratorResult.nextLevel === 'attention' ? 'escalated_to_attention_queue' : 'orchestrator_decomposition_fallback',
              failureClass: failure.failureClass,
              outcome: orchestratorResult.success ? 'success' : 'escalated',
              evidence: {
                attentionItemId: orchestratorResult.attentionItemId,
                notes: orchestratorResult.remediationNotes,
                correlationId: failure.correlationId,
              },
              reason: orchestratorResult.remediationNotes,
              durationMs: orchestratorResult.durationMs,
              costUsd: orchestratorResult.costUsd,
            },
            {
              currentLevel: orchestratorResult.nextLevel,
              status: orchestratorResult.success
                ? 'resolved'
                : orchestratorResult.nextLevel === 'attention'
                ? 'escalated_to_attention'
                : 'in_progress',
              attentionItemId: orchestratorResult.attentionItemId || null,
            }
          );

          await this.repo.saveFailureRecord({
            ...failure,
            remediationStatus: orchestratorResult.success
              ? 'remediated'
              : 'escalated_to_attention',
            escalationLevel: orchestratorResult.nextLevel,
            updatedAt: new Date().toISOString(),
          });

          return {
            trace,
            remediation: orchestratorResult,
            finalLevel: orchestratorResult.nextLevel,
            resolved: orchestratorResult.success,
          };
        }

        return {
          trace,
          remediation: supervisorResult,
          finalLevel: supervisorResult.nextLevel,
          resolved: supervisorResult.success,
        };
      }
    );
  }

  /**
   * Retrieves the unified decision trace for a task.
   */
  public async getTrace(taskId: string, tenantId?: string): Promise<EscalationTraceRecord | null> {
    return this.repo.getTraceByTaskId(taskId, tenantId);
  }
}
