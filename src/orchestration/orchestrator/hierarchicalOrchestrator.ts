/**
 * Kriya AI — Hierarchical Multi-Agent Orchestrator
 * Coordinates multi-agent execution, task decomposition, recursion depth limits,
 * disagreement resolution, and evidence validation (§12, §13, §16 of CLAUDE.md).
 */

import { AgentRepository, AgentExecutionRepository } from '../../agents/repositories/agentRepository.js';
import { TimelineRepository } from '../../customer360/repositories/timelineRepository.js';
import { AgentSafetyFirewall } from '../firewall/agentSafetyFirewall.js';
import { z } from 'zod';
import {
  ModelGateway,
  StructuredOutputError,
  GatewayEscalationError,
  GatewayRefusedError,
} from '../../model/gateway/modelGateway.js';
import {
  AgentRecord,
  StructuredAgentOutput,
  StructuredAgentOutputSchema,
  AgentConfig,
} from '../../agents/types/agentTypes.js';
import { config } from '../../core/config/config.js';
import { CryptoUtils } from '../../core/utils/crypto.js';
import { PolicyViolationError, NotFoundError } from '../../core/errors/errors.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';
import { logger } from '../../core/logger/logger.js';

/** Appended to every agent system prompt so the model knows the exact reply contract. */
export const STRUCTURED_OUTPUT_CONTRACT = `Reply with ONE JSON object only, no prose, matching:
{"taskId": string, "status": "completed"|"failed"|"escalated"|"needs_approval",
 "facts": string[], "evidence": [{"source": string, "timestamp"?: string}],
 "confidence": number between 0 and 1, "recommendedAction": string,
 "risks": string[], "policyFlags": string[], "requiresApproval": boolean, "details": object}
Rules: only state facts supported by the provided context; if the information needed is not in the
context, say so in "risks", lower "confidence", and set "status" to "escalated". Never invent prices,
availability, balances, or customer data.`;

export interface DispatchObjectiveRequest {
  objective: string;
  customerId?: string;
  entryAgentSlug?: string;
  contextData?: Record<string, unknown>;
  delegationDepth?: number;
  correlationId?: string;
}

export interface OrchestrationStepResult {
  agentSlug: string;
  agentName: string;
  category: string;
  taskId: string;
  output: StructuredAgentOutput;
  costUsd: number;
  durationMs: number;
  isFallback: boolean;
}

export interface OrchestrationExecutionResult {
  executionId: string;
  correlationId: string;
  status: 'completed' | 'failed' | 'escalated' | 'needs_approval' | 'blocked_by_firewall';
  primaryOutcome: StructuredAgentOutput;
  steps: OrchestrationStepResult[];
  totalCostUsd: number;
  totalDurationMs: number;
  firewallPassed: boolean;
  blockReason?: string;
}

export class HierarchicalOrchestrator {
  private agentRepo: AgentRepository;
  private executionRepo: AgentExecutionRepository;
  private timelineRepo: TimelineRepository;
  private gateway: ModelGateway;

  constructor(
    agentRepo?: AgentRepository,
    executionRepo?: AgentExecutionRepository,
    timelineRepo?: TimelineRepository,
    gateway?: ModelGateway
  ) {
    this.agentRepo = agentRepo || new AgentRepository();
    this.executionRepo = executionRepo || new AgentExecutionRepository();
    this.timelineRepo = timelineRepo || new TimelineRepository();
    this.gateway = gateway || new ModelGateway();
  }

  /**
   * Dispatches a business objective through the hierarchical multi-agent orchestrator.
   */
  public async dispatch(req: DispatchObjectiveRequest): Promise<OrchestrationExecutionResult> {
    const tenantId = TenantContextManager.getTenantId();
    const correlationId = req.correlationId || TenantContextManager.getCorrelationId();
    const currentDepth = req.delegationDepth || 0;
    const maxDepth = config.get('MAX_AGENT_DELEGATION_DEPTH');

    // 1. Recursion Depth Guardrail (§6 of CLAUDE.md)
    if (currentDepth >= maxDepth) {
      throw new PolicyViolationError(
        `Agent delegation depth limit exceeded (${currentDepth} >= max ${maxDepth}). Preventing runaway execution loop.`,
        { currentDepth, maxDepth, correlationId }
      );
    }

    const steps: OrchestrationStepResult[] = [];
    let totalCostUsd = 0;
    const startTime = Date.now();

    // 2. Inbound Agent Safety Firewall Scan
    const firewallResult = AgentSafetyFirewall.scan({
      tenantId,
      inputContent: req.objective,
    });

    if (!firewallResult.allowed) {
      logger.warn(`Orchestration blocked by Safety Firewall: ${firewallResult.blockReason}`, {
        tenantId,
        correlationId,
      });

      const fallbackOutput: StructuredAgentOutput = {
        taskId: `task-${CryptoUtils.generateId()}`,
        status: 'failed',
        facts: ['Request intercepted and blocked by Agent Safety Firewall'],
        evidence: [],
        confidence: 0.0,
        recommendedAction: 'Review security alert in Human Attention Center',
        risks: ['Prompt injection or prohibited content pattern detected'],
        policyFlags: ['FIREWALL_BLOCKED'],
        requiresApproval: true,
        details: { violations: firewallResult.violations },
      };

      return {
        executionId: CryptoUtils.generateId(),
        correlationId,
        status: 'blocked_by_firewall',
        primaryOutcome: fallbackOutput,
        steps: [],
        totalCostUsd: 0,
        totalDurationMs: Date.now() - startTime,
        firewallPassed: false,
        blockReason: firewallResult.blockReason,
      };
    }

    // 3. Resolve Target Entry Agent
    const targetSlug = req.entryAgentSlug || this.classifyTargetAgentSlug(req.objective);
    const agent = await this.agentRepo.findBySlug(targetSlug);

    if (!agent) {
      throw new NotFoundError(`Agent with slug '${targetSlug}' not found in active tenant.`);
    }

    // 4. Execute Primary Specialist Agent
    const stepResult = await this.executeAgentTask({
      agent,
      prompt: req.objective,
      contextData: req.contextData,
      correlationId,
    });

    steps.push(stepResult);
    totalCostUsd += stepResult.costUsd;

    let finalOutcome = stepResult.output;

    // 5. If verifier is requested or required by risk policy, execute Verifier Agent
    if (agent.category !== 'verifier' && (agent.risk_tier === 'HIGH' || agent.risk_tier === 'CRITICAL' || finalOutcome.requiresApproval)) {
      const verifierAgent = await this.agentRepo.findBySlug('quality_review_verifier');
      if (verifierAgent) {
        const verifierStep = await this.executeAgentTask({
          agent: verifierAgent,
          prompt: `Verify outcome: ${JSON.stringify(finalOutcome)}`,
          contextData: { originalObjective: req.objective, primaryOutcome: finalOutcome },
          correlationId,
        });

        steps.push(verifierStep);
        totalCostUsd += verifierStep.costUsd;

        // The verifier's verdict must count: anything short of a confident pass needs a human.
        const verdict = verifierStep.output;
        if (verdict.status !== 'completed' || verdict.requiresApproval) {
          finalOutcome = {
            ...finalOutcome,
            requiresApproval: true,
            risks: [...finalOutcome.risks, `Verifier did not confirm outcome (status: ${verdict.status})`],
            policyFlags: [...finalOutcome.policyFlags, 'VERIFIER_NOT_CONFIRMED'],
          };
        }
      }
    }

    // 6. Record interaction in Customer Timeline if customer ID provided
    if (req.customerId) {
      await this.timelineRepo.appendEvent({
        customerId: req.customerId,
        channel: 'system',
        eventType: 'agent.orchestration_completed',
        summary: `Agent [${agent.name}] executed: ${finalOutcome.recommendedAction}`,
        details: {
          taskId: finalOutcome.taskId,
          status: finalOutcome.status,
          confidence: finalOutcome.confidence,
          stepsCount: steps.length,
          totalCostUsd,
        },
        actorType: 'agent',
        actorId: agent.id,
      });
    }

    // 7. Calculate Status (including escalation triggers)
    let executionStatus: OrchestrationExecutionResult['status'] = 'completed';
    if (finalOutcome.requiresApproval || firewallResult.requiresHumanApproval) {
      executionStatus = 'needs_approval';
    } else if (finalOutcome.status === 'escalated') {
      executionStatus = 'escalated';
    } else if (finalOutcome.status === 'failed') {
      executionStatus = 'failed';
    }

    return {
      executionId: CryptoUtils.generateId(),
      correlationId,
      status: executionStatus,
      primaryOutcome: finalOutcome,
      steps,
      totalCostUsd,
      totalDurationMs: Date.now() - startTime,
      firewallPassed: true,
    };
  }

  /**
   * Executes a single agent step with Model Router, cost attribution, and schema validation.
   */
  private async executeAgentTask(params: {
    agent: AgentRecord;
    prompt: string;
    contextData?: Record<string, unknown>;
    correlationId: string;
  }): Promise<OrchestrationStepResult> {
    const config: AgentConfig = JSON.parse(params.agent.config_json);
    const taskId = `task-${CryptoUtils.generateId()}`;

    // Record execution start
    const execution = await this.executionRepo.recordExecutionStart({
      agentId: params.agent.id,
      correlationId: params.correlationId,
      taskId,
      input: { prompt: params.prompt, context: params.contextData },
    });

    // Every model call goes through the Model Gateway: a certified model for the agent's tier ×
    // language (owner's chosen brain first), refusal when the brain supply is paused, and exactly one
    // schema repair attempt (docs/kriya WP-1.1, WP-1.3). Failures become honest step results.
    const agentOutputSchema = StructuredAgentOutputSchema.extend({ taskId: z.string().optional() });
    const startedAt = Date.now();
    let parsedOutput: StructuredAgentOutput;
    let costUsd = 0;
    let durationMs = 0;
    let isFallback = false;
    try {
      const completion = await this.gateway.complete({
        tenantId: params.agent.tenant_id,
        taskId,
        tier: config.capabilityTier ?? 'T2',
        language: typeof params.contextData?.language === 'string' ? params.contextData.language : undefined,
        agentSlug: params.agent.slug,
        systemPrompt: `${config.systemPrompt}

${STRUCTURED_OUTPUT_CONTRACT}`,
        userPrompt: params.prompt,
        contextData: params.contextData,
        schema: agentOutputSchema,
        temperature: config.modelPolicy?.temperature,
        maxTokens: config.modelPolicy?.maxTokens,
        sandboxModelHint: config.modelPolicy?.primaryModel,
      });
      costUsd = completion.costUsd;
      durationMs = completion.durationMs;
      isFallback = completion.modelUsed !== completion.selection.candidates[0]?.modelId;
      const parsed = completion.parsed!;
      parsedOutput = { ...parsed, taskId: parsed.taskId || taskId };
      parsedOutput.details = {
        ...parsedOutput.details,
        model: {
          id: completion.modelUsed,
          source: completion.selection.source,
          tierUsed: completion.selection.tierUsed,
          repairAttempted: completion.repairAttempted,
          costSource: completion.costSource,
        },
      };
      if (completion.selection.requiresApproval) {
        parsedOutput.requiresApproval = true;
        parsedOutput.policyFlags.push('REDUCED_AUTONOMY_DRAFT');
      }
      if (completion.selection.source === 'sandbox_uncertified') {
        parsedOutput.policyFlags.push('SANDBOX_UNCERTIFIED_MODEL');
      }
    } catch (err) {
      durationMs = Date.now() - startedAt;
      parsedOutput = gatewayFailureOutput(taskId, err);
    }

    // Check escalation triggers based on confidence threshold (§16)
    const minConfidence = config.escalationRules?.minConfidenceThreshold ?? 0.75;
    if (parsedOutput.status !== 'failed' && parsedOutput.confidence < minConfidence) {
      parsedOutput.status = 'escalated';
      parsedOutput.risks.push(`Confidence score (${parsedOutput.confidence}) fell below threshold (${minConfidence})`);
      parsedOutput.requiresApproval = true;
    }

    // Outbound Firewall Scan for sensitive data leakage
    const outboundScan = AgentSafetyFirewall.scan({
      tenantId: params.agent.tenant_id,
      agentId: params.agent.id,
      agentSlug: params.agent.slug,
      outputContent: JSON.stringify(parsedOutput),
      actionRiskTier: params.agent.risk_tier,
      agentAutonomyLevel: params.agent.autonomy_level,
      allowedDataScopes: config.dataAccessScope,
    });

    if (outboundScan.requiresHumanApproval) {
      parsedOutput.requiresApproval = true;
    }

    // Record execution completion
    await this.executionRepo.recordExecutionComplete({
      executionId: execution.id,
      status: parsedOutput.status === 'needs_approval' ? 'completed' : parsedOutput.status,
      output: parsedOutput as any,
      confidenceScore: parsedOutput.confidence,
      costUsd,
      durationMs,
    });

    return {
      agentSlug: params.agent.slug,
      agentName: params.agent.name,
      category: params.agent.category,
      taskId,
      output: parsedOutput,
      costUsd,
      durationMs,
      isFallback,
    };
  }

  /**
   * Deterministic heuristic classifier to route requests to the most appropriate agent template.
   */
  private classifyTargetAgentSlug(prompt: string): string {
    const lower = prompt.toLowerCase();

    if (lower.includes('book') || lower.includes('appoint') || lower.includes('schedul') || lower.includes('slot') || lower.includes('reserv')) {
      return 'appointment_booking_specialist';
    }
    if (lower.includes('pric') || lower.includes('quote') || lower.includes('lead') || lower.includes('demo') || lower.includes('sales') || lower.includes('deal') || lower.includes('cost')) {
      return 'sales_lead_qualifier';
    }
    if (lower.includes('help') || lower.includes('issue') || lower.includes('problem') || lower.includes('support') || lower.includes('refund') || lower.includes('ticket')) {
      return 'customer_support_specialist';
    }

    // Default to Business Orchestrator
    return 'business_orchestrator';
  }
}

/** Maps a gateway failure to an honest, human-routed step result (never a success). */
function gatewayFailureOutput(taskId: string, err: unknown): StructuredAgentOutput {
  const message = err instanceof Error ? err.message : String(err);
  const base = { taskId, facts: [], evidence: [], confidence: 0, requiresApproval: true };
  if (err instanceof StructuredOutputError) {
    return {
      ...base,
      status: 'failed',
      recommendedAction: 'Model output did not match the structured contract after one repair attempt; route to human review.',
      risks: ['Unparseable or schema-invalid model output'],
      policyFlags: ['UNPARSEABLE_MODEL_OUTPUT'],
      details: { rawContent: err.rawContent.slice(0, 2000), parseError: err.issues.slice(0, 500) },
    };
  }
  if (err instanceof GatewayEscalationError || err instanceof GatewayRefusedError) {
    return {
      ...base,
      status: 'escalated',
      recommendedAction: 'No certified model can run this task right now; a human must handle it or certify a brain.',
      risks: [message],
      policyFlags: [err instanceof GatewayRefusedError ? 'BRAIN_SUPPLY_PAUSED' : 'NO_CERTIFIED_MODEL'],
      details: { degradation: err instanceof GatewayEscalationError ? err.degradation : undefined },
    };
  }
  return {
    ...base,
    status: 'failed',
    recommendedAction: 'The model call failed; route to human review.',
    risks: [message.slice(0, 500)],
    policyFlags: ['MODEL_CALL_FAILED'],
    details: {},
  };
}
