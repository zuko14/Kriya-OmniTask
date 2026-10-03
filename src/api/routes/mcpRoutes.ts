/**
 * Kriya Omnitask — MCP Fastify HTTP Routes
 * Exposes Model Context Protocol (MCP) endpoints via HTTP JSON-RPC 2.0.
 * Gated by Mandate, verified via read-back, and backed by Ed25519 Proof receipts.
 * (docs/kriya WP-5.7, 02 §8).
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { McpActionServer } from '../../interop/mcp/service/mcpActionServer.js';
import { McpClientContext, McpErrorCodes, JsonRpcResponse } from '../../interop/mcp/types/mcpTypes.js';
import { JwtService } from '../../security/auth/jwt.js';
import { TenantRepository } from '../../storage/repositories/tenantRepository.js';
import { UnauthorizedError } from '../../core/errors/errors.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';

const tenantRepo = new TenantRepository();
const mcpServer = new McpActionServer();

/**
 * Resolves authentication and tenant context for MCP HTTP requests.
 * Supports Bearer JWT tokens and x-kriya-api-key headers.
 */
async function resolveMcpContext(request: FastifyRequest): Promise<McpClientContext> {
  const authHeader = request.headers.authorization;
  const apiKeyHeader = (request.headers['x-kriya-api-key'] || request.headers['x-api-key']) as string | undefined;

  let tenantId: string | undefined;
  let principalId: string | undefined;
  let clientName = (request.headers['x-client-name'] as string) || 'http-mcp-client';

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    const payload = JwtService.verify(token);
    tenantId = payload.tenantId;
    principalId = payload.userId;
  } else if (apiKeyHeader) {
    // API key based machine authentication
    const tenantIdHeader = request.headers['x-tenant-id'] as string | undefined;
    if (tenantIdHeader) {
      tenantId = tenantIdHeader;
      principalId = `api-key-client`;
    }
  }

  // Fallback to active TenantContext if request was executed inside a context runner
  if (!tenantId) {
    const activeCtx = TenantContextManager.get();
    if (activeCtx) {
      tenantId = activeCtx.tenantId;
      principalId = activeCtx.userId;
    }
  }

  if (!tenantId) {
    throw new UnauthorizedError('Authentication required. Supply Authorization Bearer token or valid API key.');
  }

  const tenant = await tenantRepo.findById(tenantId);
  if (!tenant || tenant.status !== 'active') {
    throw new UnauthorizedError('Tenant account is disabled, suspended, or does not exist');
  }

  return {
    tenantId,
    principalId,
    clientName,
    agentSlug: (request.headers['x-agent-slug'] as string) || 'mcp-agent',
    correlationId: (request.headers['x-correlation-id'] as string) || undefined,
  };
}

export async function mcpRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * Main MCP JSON-RPC 2.0 endpoint (supports single and batch requests)
   */
  fastify.post('/api/v1/mcp', async (request: FastifyRequest, reply: FastifyReply) => {
    let context: McpClientContext;
    try {
      context = await resolveMcpContext(request);
    } catch (err: any) {
      const errorResponse: JsonRpcResponse = {
        jsonrpc: '2.0',
        id: null,
        error: {
          code: McpErrorCodes.UNAUTHORIZED,
          message: err.message || 'Unauthorized',
        },
      };
      return reply.status(401).send(errorResponse);
    }

    const body = request.body;

    // Handle batch JSON-RPC request
    if (Array.isArray(body)) {
      const responses: JsonRpcResponse[] = [];
      for (const item of body) {
        const res = await mcpServer.handleMessage(item, context);
        if (res !== null) {
          responses.push(res);
        }
      }
      return reply.status(200).send(responses);
    }

    // Handle single JSON-RPC request
    const response = await mcpServer.handleMessage(body, context);
    if (response === null) {
      // Notification handled with 204 No Content
      return reply.status(204).send();
    }

    return reply.status(200).send(response);
  });

  /**
   * Tool Discovery Inspection Endpoint
   */
  fastify.get('/api/v1/mcp/tools', async (request: FastifyRequest, reply: FastifyReply) => {
    const context = await resolveMcpContext(request);
    const listReq = {
      jsonrpc: '2.0',
      id: 'discovery',
      method: 'tools/list',
    };

    const res = await mcpServer.handleMessage(listReq, context);
    if (res?.result) {
      return reply.send(res.result);
    }
    return reply.status(500).send(res?.error || { error: 'Failed to enumerate tools' });
  });

  /**
   * MCP Server Metadata & Protocol Info
   */
  fastify.get('/api/v1/mcp/info', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({
      name: 'kriya-omnitask-mcp',
      version: '1.0.0',
      protocolVersion: '2024-11-05',
      governance: {
        mandateGated: true,
        proofReceipts: true,
        riskTiers: ['T0', 'T1', 'T2', 'T3'],
      },
    });
  });
}
