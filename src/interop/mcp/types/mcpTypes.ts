/**
 * Kriya Omnitask — Model Context Protocol (MCP) Types & Contracts
 * Exposes Kriya actions as MCP tools, gated by Mandate and recorded in Proof (docs/kriya WP-5.7, 02 §8).
 * Complies with MCP specification 2024-11-05 and JSON-RPC 2.0.
 */

import { SignedReceipt } from '../../../trust/proof/proofService.js';
import { ToolVerification } from '../../../tools/registry/toolRegistry.js';

export const MCP_PROTOCOL_VERSION = '2024-11-05';
export const KRIYA_MCP_SERVER_NAME = 'kriya-omnitask-mcp';
export const KRIYA_MCP_SERVER_VERSION = '1.0.0';

export type JsonRpcId = string | number | null;

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result?: unknown;
  error?: JsonRpcError;
}

/** Standard JSON-RPC 2.0 & Kriya MCP error codes */
export const McpErrorCodes = {
  // Standard JSON-RPC 2.0
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,

  // Kriya Governance & Security Errors (-32000 to -32099)
  UNAUTHORIZED: -32000,
  MANDATE_DENIED: -32001,
  MANDATE_OVER_LIMIT: -32002,
  VERIFICATION_FAILED: -32003,
  TENANT_INACTIVE: -32004,
  TOOL_EXECUTION_FAILED: -32005,
} as const;

export interface McpClientInfo {
  name: string;
  version: string;
}

export interface McpClientCapabilities {
  roots?: { listChanged?: boolean };
  sampling?: Record<string, unknown>;
  experimental?: Record<string, unknown>;
}

export interface InitializeParams {
  protocolVersion: string;
  capabilities: McpClientCapabilities;
  clientInfo: McpClientInfo;
}

export interface McpServerCapabilities {
  tools?: {
    listChanged?: boolean;
  };
  resources?: {
    subscribe?: boolean;
    listChanged?: boolean;
  };
  prompts?: {
    listChanged?: boolean;
  };
}

export interface InitializeResult {
  protocolVersion: string;
  capabilities: McpServerCapabilities;
  serverInfo: {
    name: string;
    version: string;
  };
  instructions?: string;
}

export interface McpJsonSchema {
  type: string;
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
  description?: string;
  [key: string]: unknown;
}

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: McpJsonSchema;
  /** Kriya Governance extensions */
  riskTier?: string;
  requiresMandate?: boolean;
  category?: string;
}

export interface ListToolsResult {
  tools: McpToolDefinition[];
  nextCursor?: string;
}

export interface CallToolParams {
  name: string;
  arguments?: Record<string, unknown>;
}

export interface McpTextContent {
  type: 'text';
  text: string;
}

export type McpContent = McpTextContent;

export interface CallToolResult {
  content: McpContent[];
  isError?: boolean;
  /** Kriya Proof linkage: every consequential action produces an Ed25519-signed proof receipt */
  proofReceipt?: SignedReceipt;
  /** Kriya read-back verification state */
  verification?: ToolVerification;
  /** Mandate authorization reference */
  mandate?: {
    mandateId?: string;
    mandateVersion?: number;
    decision: string;
  };
}

export interface McpClientContext {
  tenantId: string;
  agentSlug?: string;
  principalId?: string;
  clientName?: string;
  clientVersion?: string;
  correlationId?: string;
}
