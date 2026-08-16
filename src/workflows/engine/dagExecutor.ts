/**
 * Xylarc AI — Workflow DAG Executor Engine
 * Executes multi-step DAG pipelines, handles conditional branching, and suspends/resumes on human approval steps (§13, §15 of CLAUDE.md).
 */

import {
  DAGDefinition,
  DAGStep,
  StepExecutionResult,
  WorkflowExecutionRecord,
  ExecutionStatus,
} from '../types/workflowTypes.js';
import { DataInterpolator, InterpolationScope } from '../interpolator/dataInterpolator.js';
import {
  WorkflowExecutionRepository,
  WorkflowApprovalRequestRepository,
} from '../repositories/workflowRepository.js';
import { ToolGateway } from '../../tools/gateway/toolGateway.js';
import { PolicyEngine } from '../../policy/engine/policyEngine.js';
import { ConditionEvaluator } from '../../policy/evaluator/conditionEvaluator.js';
import { HierarchicalOrchestrator } from '../../orchestration/orchestrator/hierarchicalOrchestrator.js';
import { ValidationError, BusinessLogicError } from '../../core/errors/errors.js';
import { logger } from '../../core/logger/logger.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';

export class DAGExecutor {
  private executionRepo: WorkflowExecutionRepository;
  private approvalRepo: WorkflowApprovalRequestRepository;
  private toolGateway: ToolGateway;
  private policyEngine: PolicyEngine;
  private orchestrator: HierarchicalOrchestrator;

  constructor(
    executionRepo?: WorkflowExecutionRepository,
    approvalRepo?: WorkflowApprovalRequestRepository,
    toolGateway?: ToolGateway,
    policyEngine?: PolicyEngine,
    orchestrator?: HierarchicalOrchestrator
  ) {
    this.executionRepo = executionRepo || new WorkflowExecutionRepository();
    this.approvalRepo = approvalRepo || new WorkflowApprovalRequestRepository();
    this.toolGateway = toolGateway || new ToolGateway();
    this.policyEngine = policyEngine || new PolicyEngine();
    this.orchestrator = orchestrator || new HierarchicalOrchestrator();
  }

  /**
   * Validates a DAG definition for cycle detection and valid dependency references.
   */
  public static validateDAG(dag: DAGDefinition): void {
    const stepIds = new Set(dag.steps.map((s) => s.id));
    if (stepIds.size !== dag.steps.length) {
      throw new ValidationError('DAG contains duplicate step IDs.');
    }

    // Verify all dependencies exist
    for (const step of dag.steps) {
      for (const dep of step.dependsOn) {
        if (!stepIds.has(dep)) {
          throw new ValidationError(
            `Step '${step.id}' depends on non-existent step '${dep}'.`
          );
        }
      }
    }

    // Cycle detection using Kahn's topological sort
    const inDegree: Record<string, number> = {};
    const adj: Record<string, string[]> = {};

    for (const step of dag.steps) {
      inDegree[step.id] = step.dependsOn.length;
      adj[step.id] = [];
    }

    for (const step of dag.steps) {
      for (const dep of step.dependsOn) {
        adj[dep].push(step.id);
      }
    }

    const queue: string[] = dag.steps
      .filter((s) => s.dependsOn.length === 0)
      .map((s) => s.id);

    let visitedCount = 0;
    while (queue.length > 0) {
      const u = queue.shift()!;
      visitedCount++;

      for (const v of adj[u]) {
        inDegree[v]--;
        if (inDegree[v] === 0) {
          queue.push(v);
        }
      }
    }

    if (visitedCount !== dag.steps.length) {
      throw new ValidationError('DAG contains a circular dependency (cycle detected).');
    }
  }

  /**
   * Starts or resumes a workflow execution DAG.
   */
  public async executeDAG(
    execution: WorkflowExecutionRecord,
    dag: DAGDefinition
  ): Promise<WorkflowExecutionRecord> {
    DAGExecutor.validateDAG(dag);

    let stepResults: Record<string, StepExecutionResult> = {};
    try {
      stepResults = JSON.parse(execution.step_results_json || '{}');
    } catch {
      stepResults = {};
    }

    let contextData: Record<string, unknown> = {};
    try {
      contextData = JSON.parse(execution.context_data_json || '{}');
    } catch {
      contextData = {};
    }

    const startedAt = execution.started_at || new Date().toISOString();
    await this.executionRepo.updateExecutionProgress({
      executionId: execution.id,
      status: 'running',
      startedAt,
    });

    const stepsById = new Map<string, DAGStep>(dag.steps.map((s) => [s.id, s]));
    const skippedSteps = new Set<string>();

    // Identify already skipped steps from previous runs
    for (const [sId, sRes] of Object.entries(stepResults)) {
      if (sRes.status === 'skipped') {
        skippedSteps.add(sId);
      }
    }

    let hasSuspendedForApproval = false;

    // Iteratively execute ready steps
    while (true) {
      const readySteps: DAGStep[] = [];

      for (const step of dag.steps) {
        if (stepResults[step.id]) continue; // Already executed
        if (skippedSteps.has(step.id)) continue;

        // Check if all dependencies are completed or skipped
        const allDepsSatisfied = step.dependsOn.every((depId) => {
          const depResult = stepResults[depId];
          return (
            depResult &&
            (depResult.status === 'completed' || depResult.status === 'skipped')
          );
        });

        if (allDepsSatisfied) {
          readySteps.push(step);
        }
      }

      if (readySteps.length === 0) {
        break; // No more steps ready to execute
      }

      // Execute ready steps sequentially
      for (const step of readySteps) {
        const scope: InterpolationScope = {
          context: contextData,
          steps: stepResults,
        };

        const startTime = Date.now();
        const interpolatedConfig = DataInterpolator.interpolate(
          step.config,
          scope
        ) as Record<string, unknown>;

        await this.executionRepo.updateExecutionProgress({
          executionId: execution.id,
          status: 'running',
          currentStepId: step.id,
          stepResults,
        });

        try {
          // 1. Human Approval Step (§15 & §37)
          if (step.type === 'human_approval') {
            const pendingReq = await this.approvalRepo.findPending(
              execution.id,
              step.id
            );

            if (!pendingReq) {
              await this.approvalRepo.createRequest({
                executionId: execution.id,
                stepId: step.id,
                requiredRole: (interpolatedConfig.requiredRole as string) || 'admin',
                payload: interpolatedConfig,
              });
            }

            // Suspend workflow execution
            await this.executionRepo.updateExecutionProgress({
              executionId: execution.id,
              status: 'waiting_for_approval',
              currentStepId: step.id,
              stepResults,
            });

            hasSuspendedForApproval = true;
            break;
          }

          // 2. Execute other step types
          const output = await this.executeStepLogic(
            step,
            interpolatedConfig,
            scope
          );
          const durationMs = Date.now() - startTime;

          // Check if conditional branch disables alternative branch
          if (step.type === 'conditional_branch') {
            const branchResult = output as { conditionMatched: boolean; nextStepId?: string; alternativeStepId?: string };
            if (branchResult.alternativeStepId && stepsById.has(branchResult.alternativeStepId)) {
              this.markSubtreeSkipped(branchResult.alternativeStepId, dag, skippedSteps, stepResults);
            }
          }

          stepResults[step.id] = {
            stepId: step.id,
            stepName: step.name,
            type: step.type,
            status: 'completed',
            output,
            durationMs,
            executedAt: new Date().toISOString(),
          };
        } catch (err: any) {
          const durationMs = Date.now() - startTime;
          stepResults[step.id] = {
            stepId: step.id,
            stepName: step.name,
            type: step.type,
            status: 'failed',
            error: err.message,
            durationMs,
            executedAt: new Date().toISOString(),
          };

          await this.executionRepo.updateExecutionProgress({
            executionId: execution.id,
            status: 'failed',
            currentStepId: step.id,
            stepResults,
            errorMessage: `Step '${step.name}' failed: ${err.message}`,
            completedAt: new Date().toISOString(),
          });

          return (await this.executionRepo.findById(execution.id))!;
        }
      }

      if (hasSuspendedForApproval) {
        return (await this.executionRepo.findById(execution.id))!;
      }
    }

    // Check if all non-skipped steps are completed
    const allCompleted = dag.steps.every(
      (s) =>
        skippedSteps.has(s.id) ||
        (stepResults[s.id] && stepResults[s.id].status === 'completed')
    );

    const finalStatus: ExecutionStatus = allCompleted ? 'completed' : 'failed';
    const completedAt = new Date().toISOString();

    await this.executionRepo.updateExecutionProgress({
      executionId: execution.id,
      status: finalStatus,
      currentStepId: null,
      stepResults,
      completedAt,
    });

    return (await this.executionRepo.findById(execution.id))!;
  }

  /**
   * Resumes a suspended workflow execution after an approval decision is recorded.
   */
  public async resumeAfterApproval(
    executionId: string,
    stepId: string,
    decision: 'approved' | 'rejected',
    decisionBy: string,
    notes?: string
  ): Promise<WorkflowExecutionRecord> {
    const execution = await this.executionRepo.findById(executionId);
    if (!execution) {
      throw new BusinessLogicError(`Workflow execution '${executionId}' not found.`);
    }

    if (execution.status !== 'waiting_for_approval') {
      throw new BusinessLogicError(
        `Workflow execution is not waiting for approval (Current status: ${execution.status}).`
      );
    }

    const pendingReq = await this.approvalRepo.findPending(executionId, stepId);
    if (!pendingReq) {
      throw new BusinessLogicError(
        `Pending approval request for step '${stepId}' not found.`
      );
    }

    await this.approvalRepo.recordDecision({
      requestId: pendingReq.id,
      decision,
      decisionBy,
      notes,
    });

    let stepResults: Record<string, StepExecutionResult> = {};
    try {
      stepResults = JSON.parse(execution.step_results_json || '{}');
    } catch {
      stepResults = {};
    }

    if (decision === 'rejected') {
      stepResults[stepId] = {
        stepId,
        stepName: stepId,
        type: 'human_approval',
        status: 'failed',
        error: `Rejected by ${decisionBy}: ${notes || 'No reason provided'}`,
        durationMs: 0,
        executedAt: new Date().toISOString(),
      };

      await this.executionRepo.updateExecutionProgress({
        executionId: execution.id,
        status: 'rejected',
        stepResults,
        errorMessage: `Human approval rejected by ${decisionBy}`,
        completedAt: new Date().toISOString(),
      });

      return (await this.executionRepo.findById(execution.id))!;
    }

    // Step was approved! Mark completed and resume execution
    stepResults[stepId] = {
      stepId,
      stepName: stepId,
      type: 'human_approval',
      status: 'completed',
      output: { approved: true, decisionBy, notes },
      durationMs: 0,
      executedAt: new Date().toISOString(),
    };

    // Load DAG definition from workflow_definitions
    const sql = `SELECT dag_json FROM workflow_definitions WHERE id = ? LIMIT 1;`;
    const rows = await this.executionRepo['client'].query<{ dag_json: string }>(sql, [
      execution.workflow_id,
    ]);

    if (rows.length === 0) {
      throw new BusinessLogicError('Workflow definition associated with execution not found.');
    }

    const dag: DAGDefinition = JSON.parse(rows[0].dag_json);
    return this.executeDAG(
      { ...execution, step_results_json: JSON.stringify(stepResults) },
      dag
    );
  }

  private async executeStepLogic(
    step: DAGStep,
    config: Record<string, unknown>,
    scope: InterpolationScope
  ): Promise<any> {
    switch (step.type) {
      case 'tool_execution': {
        const toolName = config.toolName as string;
        const params = (config.params as Record<string, unknown>) || {};
        const res = await this.toolGateway.executeTool({
          toolSlug: toolName,
          input: params,
          idempotencyKey: `wf-step-${step.id}-${Date.now()}`,
          bypassApproval: true, // Internal workflow execution authorization
        });

        if (res.status === 'failed') {
          throw new BusinessLogicError(`Tool execution '${toolName}' failed: ${res.error || 'Unknown error'}`);
        }
        return res.result !== undefined ? res.result : res;
      }

      case 'policy_check': {
        const category = config.category as any;
        const context = (config.context as Record<string, unknown>) || {};
        const evalResult = await this.policyEngine.evaluate({
          actionType: 'custom',
          context,
          category,
        });

        if (!evalResult.allowed) {
          throw new BusinessLogicError(
            `Policy check failed: ${evalResult.violations.map((v) => v.message).join('; ')}`
          );
        }
        return evalResult;
      }

      case 'agent_task': {
        const agentSlug = config.agentSlug as string;
        const objective = config.objective as string;
        return this.orchestrator.dispatch({
          entryAgentSlug: agentSlug,
          objective,
          contextData: config.inputData as Record<string, unknown>,
        });
      }

      case 'conditional_branch': {
        const condition = config.condition as any;
        const matched = ConditionEvaluator.evaluate(condition, scope.context);
        const nextStepId = matched ? (config.ifTrueNextStepId as string) : (config.ifFalseNextStepId as string);
        const alternativeStepId = matched ? (config.ifFalseNextStepId as string) : (config.ifTrueNextStepId as string);

        return {
          conditionMatched: matched,
          nextStepId,
          alternativeStepId,
        };
      }

      case 'delay': {
        const delayMs = typeof config.delayMs === 'number' ? config.delayMs : 10;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        return { delayedMs: delayMs };
      }

      default:
        throw new ValidationError(`Unsupported workflow step type: ${step.type}`);
    }
  }

  private markSubtreeSkipped(
    startStepId: string,
    dag: DAGDefinition,
    skippedSet: Set<string>,
    stepResults: Record<string, StepExecutionResult>
  ): void {
    skippedSet.add(startStepId);
    stepResults[startStepId] = {
      stepId: startStepId,
      stepName: startStepId,
      type: 'conditional_branch',
      status: 'skipped',
      durationMs: 0,
      executedAt: new Date().toISOString(),
    };

    // Recursively skip steps depending exclusively on this skipped step
    for (const s of dag.steps) {
      if (s.dependsOn.includes(startStepId) && !skippedSet.has(s.id)) {
        this.markSubtreeSkipped(s.id, dag, skippedSet, stepResults);
      }
    }
  }
}
