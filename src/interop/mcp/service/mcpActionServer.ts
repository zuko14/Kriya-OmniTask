/**
 * Kriya Omnitask — MCP Action Server Engine
 * Exposes Kriya actions as Model Context Protocol (MCP) tools.
 * Gated by Kriya Mandates and recorded in Ed25519-signed Kriya Proof receipts.
 * (docs/kriya WP-5.7, 02 §8).
 */

import {
  MCP_PROTOCOL_VERSION,
  KRIYA_MCP_SERVER_NAME,
  KRIYA_MCP_SERVER_VERSION,
  JsonRpcId,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcError,
  McpErrorCodes,
  McpClientContext,
  InitializeParams,
  InitializeResult,
  ListToolsResult,
  McpToolDefinition,
  CallToolParams,
  CallToolResult,
} from '../types/mcpTypes.js';
import { ToolRegistryService, RegisteredTool, ToolVerification } from '../../../tools/registry/toolRegistry.js';
import { ToolGateway } from '../../../tools/gateway/toolGateway.js';
import { CredentialVault } from '../../../tools/vault/credentialVault.js';
import { MandateService, MandateDecision } from '../../../trust/mandate/mandateService.js';
import { ProofService, SignedReceipt } from '../../../trust/proof/proofService.js';
import { toActionTier, requiresMandate, requiresHumanApproval } from '../../../trust/riskTiers.js';
import { McpSchemaConverter } from './mcpSchemaConverter.js';
import { TenantContextManager } from '../../../core/context/tenantContext.js';
import { DatabaseClient } from '../../../storage/db.js';
import { reachTools } from '../../../reach/service/reachTools.js';
import { logger } from '../../../core/logger/logger.js';
import { CryptoUtils } from '../../../core/utils/crypto.js';

export interface McpActionServerOptions {
  toolRegistry?: ToolRegistryService;
  toolGateway?: ToolGateway;
  mandateService?: MandateService;
  proofService?: ProofService;
  dbClient?: DatabaseClient;
}

export class McpActionServer {
  private toolRegistry: ToolRegistryService;
  private toolGateway: ToolGateway;
  private mandateService: MandateService;
  private proofService: ProofService;
  private credentialVault: CredentialVault;

  constructor(options?: McpActionServerOptions) {
    const client = options?.dbClient;
    this.toolRegistry = options?.toolRegistry || new ToolRegistryService();
    this.credentialVault = new CredentialVault();
    this.toolGateway = options?.toolGateway || new ToolGateway({
      toolRegistry: this.toolRegistry,
      credentialVault: this.credentialVault,
      dbClient: client,
    });
    this.mandateService = options?.mandateService || new MandateService(client);
    this.proofService = options?.proofService || new ProofService(client);

    // Register Reach browser tools if not already present
    this.ensureReachToolsRegistered();
  }

  private ensureReachToolsRegistered(): void {
    try {
      for (const tool of reachTools()) {
        if (!this.toolRegistry.getTool(tool.definition.slug)) {
          this.toolRegistry.registerTool(tool);
        }
      }
    } catch {
      // Best effort in environments where reach tools are optional
    }
  }

  /**
   * Main entry point for processing incoming JSON-RPC 2.0 messages from MCP clients.
   * Ensures execution is properly wrapped in tenant context.
   */
  public async handleMessage(raw: unknown, context: McpClientContext): Promise<JsonRpcResponse | null> {
    if (!raw || typeof raw !== 'object') {
      return this.formatError(null, McpErrorCodes.PARSE_ERROR, 'Invalid JSON-RPC request body');
    }

    const req = raw as JsonRpcRequest;
    if (req.jsonrpc !== '2.0' || typeof req.method !== 'string') {
      return this.formatError(req.id ?? null, McpErrorCodes.INVALID_REQUEST, 'Invalid JSON-RPC 2.0 request structure');
    }

    // Wrap in tenant context so downstream queries and proof chains are tenant-scoped
    return TenantContextManager.withTenant(
      context.tenantId,
      'default',
      async () => this.dispatchMethod(req, context),
      {
        userId: context.principalId || 'mcp-user',
        roles: ['tenant_operator'],
      }
    );
  }

  private async dispatchMethod(req: JsonRpcRequest, context: McpClientContext): Promise<JsonRpcResponse | null> {
    const correlationId = context.correlationId || CryptoUtils.generateId();

    try {
      switch (req.method) {
        case 'initialize':
          return this.handleInitialize(req);

        case 'notifications/initialized':
          // Standard MCP notification; no response required
          return null;

        case 'ping':
          return {
            jsonrpc: '2.0',
            id: req.id ?? null,
            result: {},
          };

        case 'tools/list':
          return this.handleListTools(req);

        case 'tools/call':
          return await this.handleCallTool(req, context, correlationId);

        default:
          return this.formatError(
            req.id ?? null,
            McpErrorCodes.METHOD_NOT_FOUND,
            `Unknown or unsupported MCP method: '${req.method}'`
          );
      }
    } catch (err: any) {
      logger.error(`Unhandled error processing MCP method '${req.method}': ${err.message}`, {
        correlationId,
        tenantId: context.tenantId,
        method: req.method,
      });

      return this.formatError(
        req.id ?? null,
        McpErrorCodes.INTERNAL_ERROR,
        err.message || 'An unexpected internal error occurred during MCP request processing'
      );
    }
  }

  /**
   * MCP initialize handler
   */
  private handleInitialize(req: JsonRpcRequest): JsonRpcResponse {
    const params = (req.params || {}) as unknown as InitializeParams;
    const clientName = params.clientInfo?.name || 'unknown-client';
    const clientVersion = params.clientInfo?.version || '1.0.0';

    logger.info(`MCP client initialized: ${clientName} v${clientVersion}`, {
      protocolVersion: params.protocolVersion,
      clientName,
      clientVersion,
    });

    const result: InitializeResult = {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {
        tools: {
          listChanged: false,
        },
      },
      serverInfo: {
        name: KRIYA_MCP_SERVER_NAME,
        version: KRIYA_MCP_SERVER_VERSION,
      },
      instructions:
        'Kriya Omnitask MCP Server: Verified action execution engine. Actions are gated by Kriya Mandates and recorded in Ed25519 signed Proof receipts.',
    };

    return {
      jsonrpc: '2.0',
      id: req.id ?? null,
      result,
    };
  }

  /**
   * MCP tools/list handler
   */
  private handleListTools(req: JsonRpcRequest): JsonRpcResponse {
    const registeredTools = this.toolRegistry.listRegisteredTools();
    const mcpTools: McpToolDefinition[] = [];

    for (const def of registeredTools) {
      const toolInstance = this.toolRegistry.getTool(def.slug);
      if (!toolInstance) continue;

      const inputSchema = McpSchemaConverter.toJsonSchema(toolInstance);
      const actionTier = toActionTier(def.riskTier);
      const requiresMandateFlag = requiresMandate(actionTier) || def.category === 'payment';

      mcpTools.push({
        name: def.slug,
        description: `${def.description} [Kriya Risk Tier: ${actionTier}]`,
        inputSchema,
        riskTier: actionTier,
        requiresMandate: requiresMandateFlag,
        category: def.category,
      });
    }

    const result: ListToolsResult = {
      tools: mcpTools,
    };

    return {
      jsonrpc: '2.0',
      id: req.id ?? null,
      result,
    };
  }

  /**
   * MCP tools/call handler
   * Implements full Mandate Gating, mediated ToolGateway execution, read-back verification, and Ed25519 Proof Receipts.
   */
  private async handleCallTool(
    req: JsonRpcRequest,
    context: McpClientContext,
    correlationId: string
  ): Promise<JsonRpcResponse> {
    const params = (req.params || {}) as unknown as CallToolParams;
    const toolName = params.name;
    const args = (params.arguments || {}) as Record<string, unknown>;

    if (!toolName || typeof toolName !== 'string') {
      return this.formatError(req.id ?? null, McpErrorCodes.INVALID_PARAMS, "Missing or invalid 'name' parameter for tool execution.");
    }

    const tool = this.toolRegistry.getTool(toolName);
    if (!tool) {
      return this.formatError(req.id ?? null, McpErrorCodes.METHOD_NOT_FOUND, `Tool '${toolName}' is not registered in Kriya system.`);
    }

    const actionTier = toActionTier(tool.definition.riskTier);
    const agentSlug = context.agentSlug || 'mcp-agent';
    const idempotencyKey = (args.idempotencyKey as string) || `mcp-${CryptoUtils.hashSha256(`${context.tenantId}:${toolName}:${JSON.stringify(args)}:${correlationId}`).slice(0, 32)}`;

    // 1. T3 Human Approval Check: Irreversible actions must never execute autonomously via external MCP call
    if (requiresHumanApproval(actionTier) || tool.definition.requiresApproval) {
      logger.warn(`MCP call rejected: Tool '${toolName}' is T3 Irreversible risk and requires human approval.`, {
        toolName,
        actionTier,
        tenantId: context.tenantId,
      });

      const callResult: CallToolResult = {
        isError: true,
        content: [
          {
            type: 'text',
            text: `[HUMAN GATE REFUSAL] Tool '${toolName}' is classified as ${actionTier} (Irreversible). External autonomous execution via MCP is blocked; action requires explicit human authorization in Kriya Attention Center.`,
          },
        ],
      };

      return {
        jsonrpc: '2.0',
        id: req.id ?? null,
        result: callResult,
      };
    }

    // 2. Mandate Gating (T2 & Consequential actions require delegated authority)
    let mandateDecision: MandateDecision | undefined;
    if (requiresMandate(actionTier) || tool.definition.category === 'payment') {
      const amount = typeof args.amountUsd === 'number' ? args.amountUsd : typeof args.amount === 'number' ? args.amount : undefined;
      const currency = typeof args.currency === 'string' ? args.currency : 'INR';
      const scope: Record<string, string> = {};

      if (args.customerId) scope.customerId = String(args.customerId);
      if (args.bookingId) scope.bookingId = String(args.bookingId);
      if (args.transactionId) scope.transactionId = String(args.transactionId);

      mandateDecision = await this.mandateService.authorize({
        agentSlug,
        actionType: toolName,
        amount,
        currency,
        scope,
      });

      if (mandateDecision.decision === 'denied') {
        logger.warn(`MCP call denied by Mandate policy: ${mandateDecision.reason}`, {
          toolName,
          tenantId: context.tenantId,
          agentSlug,
        });

        const callResult: CallToolResult = {
          isError: true,
          content: [
            {
              type: 'text',
              text: `[MANDATE DENIED] Delegated authority check failed for '${toolName}': ${mandateDecision.reason}. Action was not performed.`,
            },
          ],
          mandate: mandateDecision,
        };

        return {
          jsonrpc: '2.0',
          id: req.id ?? null,
          result: callResult,
        };
      }

      if (mandateDecision.decision === 'over_limit') {
        logger.warn(`MCP call exceeded Mandate limit: ${mandateDecision.reason}`, {
          toolName,
          tenantId: context.tenantId,
          agentSlug,
        });

        const callResult: CallToolResult = {
          isError: true,
          content: [
            {
              type: 'text',
              text: `[MANDATE OVER LIMIT] Action '${toolName}' exceeded delegated mandate limits: ${mandateDecision.reason}. Action requires human elevation.`,
            },
          ],
          mandate: mandateDecision,
        };

        return {
          jsonrpc: '2.0',
          id: req.id ?? null,
          result: callResult,
        };
      }
    }

    // 3. Mediated Tool Execution via ToolGateway
    let execResult;
    try {
      execResult = await this.toolGateway.executeTool({
        toolSlug: toolName,
        input: args,
        agentId: undefined, // External MCP caller
        idempotencyKey,
        correlationId,
      });
    } catch (err: any) {
      logger.error(`MCP tool execution error for '${toolName}': ${err.message}`, {
        toolName,
        tenantId: context.tenantId,
      });

      const callResult: CallToolResult = {
        isError: true,
        content: [
          {
            type: 'text',
            text: `[TOOL EXECUTION ERROR] '${toolName}' failed: ${err.message}`,
          },
        ],
        mandate: mandateDecision,
      };

      return {
        jsonrpc: '2.0',
        id: req.id ?? null,
        result: callResult,
      };
    }

    if (execResult.status !== 'completed') {
      const callResult: CallToolResult = {
        isError: true,
        content: [
          {
            type: 'text',
            text: `[TOOL STATUS NON-COMPLETED] Execution finished with status '${execResult.status}'. Requires human approval: ${execResult.requiresHumanApproval}`,
          },
        ],
        mandate: mandateDecision,
      };

      return {
        jsonrpc: '2.0',
        id: req.id ?? null,
        result: callResult,
      };
    }

    const outputResult = execResult.result || {};

    // 4. Verification Read-Back
    const toolExecCtx = {
      tenantId: context.tenantId,
      agentId: agentSlug,
      correlationId,
      idempotencyKey,
      vault: this.credentialVault,
    };

    let verification: ToolVerification = { state: 'verified' };
    if (tool.verify) {
      try {
        verification = await tool.verify(args, outputResult, toolExecCtx);
      } catch (err: any) {
        verification = {
          state: 'mismatch',
          observed: { error: err.message },
        };
      }

      if (verification.state === 'mismatch') {
        logger.error(`MCP action read-back verification failed for '${toolName}'`, {
          toolName,
          tenantId: context.tenantId,
          observed: verification.observed,
        });

        const callResult: CallToolResult = {
          isError: true,
          content: [
            {
              type: 'text',
              text: `[VERIFICATION FAILED] Tool '${toolName}' executed, but target system read-back verification failed (state: mismatch). Refusing to issue proof receipt.`,
            },
          ],
          verification,
          mandate: mandateDecision,
        };

        return {
          jsonrpc: '2.0',
          id: req.id ?? null,
          result: callResult,
        };
      }
    }

    // 5. Issue Ed25519 Signed Proof Receipt
    let proofReceipt: SignedReceipt | undefined;
    try {
      const externalRef = this.extractExternalRef(outputResult);

      proofReceipt = await this.proofService.issue({
        actionType: toolName,
        riskTier: actionTier,
        actor: {
          agentSlug,
          modelId: context.clientName ? `mcp:${context.clientName}` : 'external-mcp-client',
        },
        mandate: mandateDecision && mandateDecision.decision === 'allow'
          ? {
              id: (mandateDecision as any).mandateId,
              version: (mandateDecision as any).mandateVersion,
              decision: mandateDecision.decision,
            }
          : undefined,
        input: args,
        output: outputResult,
        target: {
          system: toolName,
          externalRef,
        },
        verification: {
          method: tool.verify ? 'readback' : 'execution_status',
          state: verification.state,
          observed: verification.observed,
          verifiedAt: new Date().toISOString(),
        },
      });
    } catch (err: any) {
      logger.error(`Failed to issue proof receipt for MCP tool '${toolName}': ${err.message}`, {
        toolName,
        tenantId: context.tenantId,
      });
      // Do not swallow proof failure in consequential actions
      if (actionTier === 'T2') {
        throw new Error(`Kriya Proof issuance failed for consequential action '${toolName}': ${err.message}`);
      }
    }

    // 6. Return Structured MCP Response
    const responsePayload = {
      status: 'completed',
      result: outputResult,
      verification: verification.state,
      proofReceiptId: proofReceipt?.body?.receiptId,
      receiptHash: proofReceipt?.hash,
      signature: proofReceipt?.signature,
    };

    const callResult: CallToolResult = {
      content: [
        {
          type: 'text',
          text: JSON.stringify(responsePayload, null, 2),
        },
      ],
      isError: false,
      proofReceipt,
      verification,
      mandate: mandateDecision,
    };

    return {
      jsonrpc: '2.0',
      id: req.id ?? null,
      result: callResult,
    };
  }

  private extractExternalRef(output: Record<string, unknown>): string | undefined {
    for (const [key, value] of Object.entries(output)) {
      if (/id$/i.test(key) && typeof value === 'string') {
        return value;
      }
    }
    return undefined;
  }

  private formatError(id: JsonRpcId, code: number, message: string, data?: unknown): JsonRpcResponse {
    const error: JsonRpcError = { code, message };
    if (data !== undefined) {
      error.data = data;
    }
    return {
      jsonrpc: '2.0',
      id: id ?? null,
      error,
    };
  }
}
