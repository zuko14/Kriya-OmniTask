/**
 * Xylarc AI — Mediated Scoped Tool Gateway & Execution Engine
 * Enforces tenant isolation, per-tool permissions, risk gating, circuit breakers, idempotency, and audit logging (§8.4, §15, §18 of CLAUDE.md).
 */

import { ToolRegistryService, RegisteredTool } from '../registry/toolRegistry.js';
import { CredentialVault } from '../vault/credentialVault.js';
import { ToolCircuitBreaker } from '../circuit/circuitBreaker.js';
import {
  ToolExecutionRepository,
  ToolPermissionRepository,
  ToolDefinitionRepository,
} from '../repositories/toolRepository.js';
import { AgentRepository } from '../../agents/repositories/agentRepository.js';
import {
  ExecuteToolRequest,
  ExecuteToolResponse,
  ToolDefinition,
} from '../types/toolTypes.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';
import {
  NotFoundError,
  PolicyViolationError,
  ValidationError,
  ConflictError,
} from '../../core/errors/errors.js';
import { logger } from '../../core/logger/logger.js';
import { CryptoUtils } from '../../core/utils/crypto.js';

export class ToolGateway {
  private toolRegistry: ToolRegistryService;
  private credentialVault: CredentialVault;
  private circuitBreaker: ToolCircuitBreaker;
  private executionRepo: ToolExecutionRepository;
  private permissionRepo: ToolPermissionRepository;
  private toolDefRepo: ToolDefinitionRepository;
  private agentRepo: AgentRepository;

  constructor(dependencies?: {
    toolRegistry?: ToolRegistryService;
    credentialVault?: CredentialVault;
    circuitBreaker?: ToolCircuitBreaker;
    executionRepo?: ToolExecutionRepository;
    permissionRepo?: ToolPermissionRepository;
    toolDefRepo?: ToolDefinitionRepository;
    agentRepo?: AgentRepository;
  }) {
    this.toolRegistry = dependencies?.toolRegistry || new ToolRegistryService();
    this.credentialVault = dependencies?.credentialVault || new CredentialVault();
    this.circuitBreaker = dependencies?.circuitBreaker || new ToolCircuitBreaker();
    this.executionRepo = dependencies?.executionRepo || new ToolExecutionRepository();
    this.permissionRepo = dependencies?.permissionRepo || new ToolPermissionRepository();
    this.toolDefRepo = dependencies?.toolDefRepo || new ToolDefinitionRepository();
    this.agentRepo = dependencies?.agentRepo || new AgentRepository();
  }

  /**
   * Executes a tool with full policy gating, idempotency, circuit breaking, and audit logging.
   */
  public async executeTool(req: ExecuteToolRequest): Promise<ExecuteToolResponse> {
    const tenantId = TenantContextManager.getTenantId();
    const correlationId = req.correlationId || TenantContextManager.getCorrelationId();
    const startTime = Date.now();

    // 1. Resolve Tool Definition & Handler
    const tool = this.toolRegistry.getTool(req.toolSlug);
    if (!tool) {
      throw new NotFoundError(`Tool '${req.toolSlug}' is not registered in system.`);
    }

    // 2. Verify Tenant/Agent Tool Permissions (§18 of CLAUDE.md)
    await this.verifyToolPermissions(tenantId, req.toolSlug, req.agentId);

    // 3. Idempotency Check (§18)
    if (req.idempotencyKey) {
      const existingExecution = await this.executionRepo.findByIdempotencyKey(req.idempotencyKey);
      if (existingExecution) {
        if (existingExecution.status === 'completed') {
          return {
            executionId: existingExecution.id,
            toolSlug: req.toolSlug,
            status: 'completed',
            result: existingExecution.output_json ? JSON.parse(existingExecution.output_json) : undefined,
            durationMs: existingExecution.duration_ms,
            isIdempotentReplay: true,
            requiresHumanApproval: false,
          };
        }
        if (existingExecution.status === 'executing' || existingExecution.status === 'pending') {
          throw new ConflictError(`Tool execution for idempotency key '${req.idempotencyKey}' is already in progress.`);
        }
      }
    }

    // 4. Risk Gating & Human Approval Requirement (§15 & §18)
    if (tool.definition.riskTier === 'CRITICAL' || tool.definition.requiresApproval) {
      if (!req.bypassApproval) {
        const approvalRecord = await this.executionRepo.recordExecutionStart({
          toolSlug: req.toolSlug,
          agentId: req.agentId,
          idempotencyKey: req.idempotencyKey,
          riskTier: tool.definition.riskTier,
          input: req.input,
          callerIp: req.callerIp,
          correlationId,
        });

        await this.executionRepo.recordExecutionComplete({
          executionId: approvalRecord.id,
          status: 'needs_approval',
          errorMessage: 'Execution paused: CRITICAL risk tool requires explicit human authorization.',
          durationMs: Date.now() - startTime,
        });

        logger.warn(`Tool '${req.toolSlug}' requires human approval before execution.`, {
          tenantId,
          toolSlug: req.toolSlug,
          riskTier: tool.definition.riskTier,
        });

        return {
          executionId: approvalRecord.id,
          toolSlug: req.toolSlug,
          status: 'needs_approval',
          durationMs: Date.now() - startTime,
          isIdempotentReplay: false,
          requiresHumanApproval: true,
        };
      }
    }

    // 5. Circuit Breaker Check (§18)
    this.circuitBreaker.assertCanExecute(tenantId, req.toolSlug);

    // 6. Validate Input Schema
    let validatedInput: Record<string, unknown>;
    try {
      validatedInput = tool.inputValidator.parse(req.input);
    } catch (err: any) {
      throw new ValidationError(`Tool '${req.toolSlug}' input validation failed: ${err.message}`);
    }

    // 7. Record Execution Start
    const execution = await this.executionRepo.recordExecutionStart({
      toolSlug: req.toolSlug,
      agentId: req.agentId,
      idempotencyKey: req.idempotencyKey,
      riskTier: tool.definition.riskTier,
      input: validatedInput,
      callerIp: req.callerIp,
      correlationId,
    });

    // 8. Execute Tool in Mediated Runtime Context
    try {
      const output = await tool.handler(validatedInput, {
        tenantId,
        agentId: req.agentId,
        correlationId,
        vault: this.credentialVault,
      });

      const durationMs = Date.now() - startTime;

      // Record success
      await this.executionRepo.recordExecutionComplete({
        executionId: execution.id,
        status: 'completed',
        output,
        durationMs,
      });

      this.circuitBreaker.recordSuccess(tenantId, req.toolSlug);

      return {
        executionId: execution.id,
        toolSlug: req.toolSlug,
        status: 'completed',
        result: output,
        durationMs,
        isIdempotentReplay: false,
        requiresHumanApproval: false,
      };
    } catch (err: any) {
      const durationMs = Date.now() - startTime;

      // Record failure
      await this.executionRepo.recordExecutionComplete({
        executionId: execution.id,
        status: 'failed',
        errorMessage: err.message,
        durationMs,
      });

      this.circuitBreaker.recordFailure(tenantId, req.toolSlug);

      logger.error(`Tool execution failed for '${req.toolSlug}': ${err.message}`, {
        tenantId,
        toolSlug: req.toolSlug,
        executionId: execution.id,
      });

      throw err;
    }
  }

  /**
   * Verifies agent and tenant-level tool authorization rules.
   */
  private async verifyToolPermissions(tenantId: string, toolSlug: string, agentId?: string): Promise<void> {
    // 1. If agent ID is provided, check agent's configured tools list
    if (agentId) {
      const agent = await this.agentRepo.findById(agentId);
      if (!agent) {
        throw new NotFoundError(`Agent '${agentId}' not found in active tenant.`);
      }

      const config = JSON.parse(agent.config_json);
      const configuredTools: string[] = config.tools || [];

      // Check if tool is allowed on agent config (or wildcard '*')
      if (!configuredTools.includes('*') && !configuredTools.includes(toolSlug)) {
        throw new PolicyViolationError(
          `Agent '${agent.slug}' is not authorized to invoke tool '${toolSlug}'. Configured tools: [${configuredTools.join(', ')}]`,
          { agentId, toolSlug, configuredTools }
        );
      }
    }

    // 2. Check relational permission table override
    const permission = await this.permissionRepo.findPermission(toolSlug, agentId);
    if (permission && permission.is_enabled === 0) {
      throw new PolicyViolationError(
        `Tool '${toolSlug}' has been disabled by tenant security policy.`,
        { tenantId, toolSlug }
      );
    }
  }
}
