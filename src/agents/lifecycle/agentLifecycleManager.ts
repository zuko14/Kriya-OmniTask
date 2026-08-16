/**
 * Xylarc AI — Agent Lifecycle State Machine
 * Enforces valid state transitions and audit logging across draft, idle, active, paused, and error states (§17 of CLAUDE.md).
 */

import { AgentRepository, AgentLifecycleEventRepository } from '../repositories/agentRepository.js';
import {
  AgentRecord,
  AgentLifecycleState,
  AgentTransitionAction,
  AgentLifecycleEventRecord,
  AgentConfigSchema,
} from '../types/agentTypes.js';
import { NotFoundError, ConflictError, ValidationError } from '../../core/errors/errors.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';
import { logger } from '../../core/logger/logger.js';

export interface TransitionRequest {
  agentId: string;
  action: AgentTransitionAction;
  reason: string;
  actorType?: 'human_operator' | 'agent' | 'system' | 'circuit_breaker';
  actorId?: string;
  metadata?: Record<string, unknown>;
}

export class AgentLifecycleManager {
  private agentRepo: AgentRepository;
  private eventRepo: AgentLifecycleEventRepository;

  constructor(agentRepo?: AgentRepository, eventRepo?: AgentLifecycleEventRepository) {
    this.agentRepo = agentRepo || new AgentRepository();
    this.eventRepo = eventRepo || new AgentLifecycleEventRepository();
  }

  /**
   * Evaluates and applies a state transition to an agent.
   */
  public async transition(req: TransitionRequest): Promise<{
    agent: AgentRecord;
    event: AgentLifecycleEventRecord;
  }> {
    const agent = await this.agentRepo.findById(req.agentId);
    if (!agent) {
      throw new NotFoundError(`Agent with ID ${req.agentId} not found.`);
    }

    const fromState = agent.status;
    const toState = this.determineNextState(fromState, req.action);

    // Pre-transition validation gates
    if (req.action === 'publish') {
      this.validatePrePublishRequirements(agent);
    }

    // Apply state change in database
    const updatedAgent = await this.agentRepo.updateStatus(agent.id, toState);

    // Record lifecycle transition event for traceability
    const event = await this.eventRepo.logTransition({
      agentId: agent.id,
      fromState,
      toState,
      transition: req.action,
      reason: req.reason,
      actorType: req.actorType || 'system',
      actorId: req.actorId || TenantContextManager.get()?.userId,
      metadata: req.metadata,
    });

    logger.info(`Agent state transition succeeded: [${agent.slug}] ${fromState} -> ${toState} via '${req.action}'`, {
      agentId: agent.id,
      slug: agent.slug,
      fromState,
      toState,
      action: req.action,
      reason: req.reason,
    });

    return { agent: updatedAgent, event };
  }

  /**
   * Deterministic State Machine mapping.
   */
  private determineNextState(currentState: AgentLifecycleState, action: AgentTransitionAction): AgentLifecycleState {
    switch (action) {
      case 'publish':
        if (currentState !== 'draft') {
          throw new ConflictError(
            `Cannot publish agent: Expected state 'draft', but current state is '${currentState}'.`
          );
        }
        return 'idle';

      case 'activate':
        if (currentState !== 'idle') {
          throw new ConflictError(
            `Cannot activate agent: Expected state 'idle', but current state is '${currentState}'.`
          );
        }
        return 'active';

      case 'complete_task':
        if (currentState !== 'active') {
          throw new ConflictError(
            `Cannot complete task: Expected state 'active', but current state is '${currentState}'.`
          );
        }
        return 'idle';

      case 'pause':
        if (currentState !== 'active' && currentState !== 'idle') {
          throw new ConflictError(
            `Cannot pause agent: Expected state 'active' or 'idle', but current state is '${currentState}'.`
          );
        }
        return 'paused';

      case 'resume':
        if (currentState !== 'paused') {
          throw new ConflictError(
            `Cannot resume agent: Expected state 'paused', but current state is '${currentState}'.`
          );
        }
        return 'idle';

      case 'trip_error':
        return 'error';

      case 'recover':
        if (currentState !== 'error') {
          throw new ConflictError(
            `Cannot recover agent: Expected state 'error', but current state is '${currentState}'.`
          );
        }
        return 'idle';

      default:
        throw new ValidationError(`Unsupported lifecycle transition action: ${action}`);
    }
  }

  /**
   * Validates pre-publish criteria (§17 & §39 of CLAUDE.md).
   */
  private validatePrePublishRequirements(agent: AgentRecord): void {
    try {
      const config = JSON.parse(agent.config_json);
      AgentConfigSchema.parse(config);

      if (!config.systemPrompt || config.systemPrompt.trim().length < 10) {
        throw new ValidationError('Agent system prompt must be at least 10 characters.');
      }
    } catch (err) {
      if (err instanceof Error) {
        throw new ValidationError(`Pre-publish validation failed for agent '${agent.slug}': ${err.message}`);
      }
      throw err;
    }
  }

  /**
   * Retrieves lifecycle transition history for an agent.
   */
  public async getLifecycleHistory(agentId: string): Promise<AgentLifecycleEventRecord[]> {
    const agent = await this.agentRepo.findById(agentId);
    if (!agent) {
      throw new NotFoundError(`Agent with ID ${agentId} not found.`);
    }
    return this.eventRepo.getHistory(agentId);
  }
}
