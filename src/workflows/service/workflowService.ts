/**
 * Xylarc AI — Workflow Orchestration Service
 * Top-level management for DAG definitions, execution dispatching, and human approval resolutions (§13, §15 of CLAUDE.md).
 */

import {
  WorkflowDefinitionRepository,
  WorkflowExecutionRepository,
  WorkflowApprovalRequestRepository,
} from '../repositories/workflowRepository.js';
import { DAGExecutor } from '../engine/dagExecutor.js';
import {
  WorkflowDefinitionInput,
  WorkflowDefinitionRecord,
  WorkflowExecutionRecord,
  WorkflowApprovalRequestRecord,
  WorkflowDefinitionSchema,
} from '../types/workflowTypes.js';
import { NotFoundError, BusinessLogicError } from '../../core/errors/errors.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';
import { logger } from '../../core/logger/logger.js';

export class WorkflowService {
  private defRepo: WorkflowDefinitionRepository;
  private execRepo: WorkflowExecutionRepository;
  private approvalRepo: WorkflowApprovalRequestRepository;
  private executor: DAGExecutor;

  constructor(
    defRepo?: WorkflowDefinitionRepository,
    execRepo?: WorkflowExecutionRepository,
    approvalRepo?: WorkflowApprovalRequestRepository,
    executor?: DAGExecutor
  ) {
    this.defRepo = defRepo || new WorkflowDefinitionRepository();
    this.execRepo = execRepo || new WorkflowExecutionRepository();
    this.approvalRepo = approvalRepo || new WorkflowApprovalRequestRepository();
    this.executor = executor || new DAGExecutor(this.execRepo, this.approvalRepo);
  }

  public async createWorkflow(input: WorkflowDefinitionInput): Promise<WorkflowDefinitionRecord> {
    const parsed = WorkflowDefinitionSchema.parse(input);
    DAGExecutor.validateDAG(parsed.dag);
    return this.defRepo.saveDefinition(parsed);
  }

  public async getWorkflowBySlug(slug: string): Promise<WorkflowDefinitionRecord> {
    const wf = await this.defRepo.findBySlug(slug);
    if (!wf) {
      throw new NotFoundError(`Workflow '${slug}' not found in active tenant.`);
    }
    return wf;
  }

  public async listWorkflows(): Promise<WorkflowDefinitionRecord[]> {
    return this.defRepo.listActive();
  }

  public async deleteWorkflow(slug: string): Promise<boolean> {
    return this.defRepo.deleteBySlug(slug);
  }

  public async triggerWorkflow(
    slug: string,
    contextData: Record<string, unknown> = {},
    correlationId?: string
  ): Promise<WorkflowExecutionRecord> {
    const wf = await this.getWorkflowBySlug(slug);
    const dag = JSON.parse(wf.dag_json);

    const execution = await this.execRepo.createExecution({
      workflowId: wf.id,
      correlationId,
      contextData,
    });

    logger.info(`Workflow triggered: ${wf.name} (${slug}) - Execution ID: ${execution.id}`);

    // Execute DAG synchronously or until suspended for approval
    return this.executor.executeDAG(execution, dag);
  }

  public async getExecution(executionId: string): Promise<WorkflowExecutionRecord> {
    const exec = await this.execRepo.findById(executionId);
    if (!exec) {
      throw new NotFoundError(`Workflow execution '${executionId}' not found.`);
    }
    return exec;
  }

  public async listExecutions(limit: number = 50, statusFilter?: string): Promise<WorkflowExecutionRecord[]> {
    return this.execRepo.listRecent(limit, statusFilter);
  }

  public async listPendingApprovals(limit: number = 50): Promise<WorkflowApprovalRequestRecord[]> {
    return this.approvalRepo.listPending(limit);
  }

  public async decideApproval(params: {
    executionId: string;
    stepId: string;
    decision: 'approved' | 'rejected';
    notes?: string;
  }): Promise<WorkflowExecutionRecord> {
    const user = TenantContextManager.getUser();
    const decisionBy = user?.userId || 'authorized_user';

    logger.info(
      `Recording human approval decision '${params.decision}' for execution ${params.executionId} step ${params.stepId}`
    );

    return this.executor.resumeAfterApproval(
      params.executionId,
      params.stepId,
      params.decision,
      decisionBy,
      params.notes
    );
  }

  /**
   * Bootstraps standard enterprise workflow definitions.
   */
  public async bootstrapDefaultWorkflows(): Promise<void> {
    const defaultFlow: WorkflowDefinitionInput = {
      slug: 'lead_qualification_and_booking_pipeline',
      name: 'Inbound Lead Qualification & Calendar Booking Pipeline',
      description: 'End-to-end automated customer lifecycle flow from WhatsApp inquiry to confirmed calendar booking (§13).',
      triggerType: 'event',
      isActive: true,
      version: '1.0.0',
      dag: {
        steps: [
          {
            id: 'step_policy_compliance',
            name: 'Policy & Consent Verification',
            type: 'policy_check',
            dependsOn: [],
            config: {
              category: 'privacy',
              context: {
                hasActiveConsent: '${context.hasOptInConsent}',
                isQuietHours: '${context.isQuietHours}',
              },
            },
          },
          {
            id: 'step_calendar_availability',
            name: 'Check Calendar Availability',
            type: 'tool_execution',
            dependsOn: ['step_policy_compliance'],
            config: {
              toolName: 'calendar_check_availability',
              params: {
                date: '${context.requestedDate}',
              },
            },
          },
          {
            id: 'step_customer_lookup',
            name: 'CRM Customer Lookup',
            type: 'tool_execution',
            dependsOn: ['step_policy_compliance'],
            config: {
              toolName: 'crm_customer_lookup',
              params: {
                phone: '${context.customerPhone}',
              },
            },
          },
        ],
      },
    };

    await this.defRepo.saveDefinition(defaultFlow);
  }
}
