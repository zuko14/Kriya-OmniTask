/**
 * Xylarc AI — Tool Gateway & Credential Vault REST Routes
 * Fastify routes for tool discovery, credential management, permissions, and mediated execution.
 */

import { FastifyInstance } from 'fastify';
import { ToolGateway } from '../../tools/gateway/toolGateway.js';
import { ToolRegistryService } from '../../tools/registry/toolRegistry.js';
import { CredentialVault } from '../../tools/vault/credentialVault.js';
import {
  ToolExecutionRepository,
  ToolPermissionRepository,
} from '../../tools/repositories/toolRepository.js';
import { authenticate } from '../middleware/authMiddleware.js';
import { requirePermission } from '../middleware/rbacMiddleware.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';
import { z } from 'zod';

const ExecuteToolBodySchema = z.object({
  toolSlug: z.string().min(2),
  agentId: z.string().optional(),
  input: z.record(z.unknown()),
  idempotencyKey: z.string().optional(),
  bypassApproval: z.boolean().optional(),
});

const StoreCredentialBodySchema = z.object({
  serviceSlug: z.string().min(2),
  name: z.string().min(2),
  secretData: z.record(z.unknown()),
  metadata: z.record(z.unknown()).optional(),
});

const SetPermissionBodySchema = z.object({
  toolSlug: z.string().min(2),
  agentId: z.string().optional(),
  isEnabled: z.boolean(),
  dailyQuotaLimit: z.number().int().positive().optional(),
});

export async function toolRoutes(fastify: FastifyInstance): Promise<void> {
  const gateway = new ToolGateway();
  const registry = new ToolRegistryService();
  const vault = new CredentialVault();
  const executionRepo = new ToolExecutionRepository();
  const permissionRepo = new ToolPermissionRepository();

  // 1. List Available Tools
  fastify.get(
    '/api/v1/tools',
    { preHandler: [authenticate, requirePermission('agent:read')] },
    async (request, reply) => {
      const tools = registry.listRegisteredTools();
      return reply.status(200).send({
        total: tools.length,
        tools,
      });
    }
  );

  // 2. Execute Mediated Tool
  fastify.post(
    '/api/v1/tools/execute',
    { preHandler: [authenticate, requirePermission('tool:execute')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const body = ExecuteToolBodySchema.parse(request.body);

        const result = await gateway.executeTool({
          toolSlug: body.toolSlug,
          agentId: body.agentId,
          input: body.input,
          idempotencyKey: body.idempotencyKey,
          bypassApproval: body.bypassApproval,
          callerIp: request.ip,
          correlationId: request.headers['x-correlation-id'] as string,
        });

        return reply.status(200).send(result);
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 3. List Execution Audit Ledger
  fastify.get(
    '/api/v1/tools/executions',
    { preHandler: [authenticate, requirePermission('audit:read')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const executions = await executionRepo.listRecent(50);
        return reply.status(200).send({
          total: executions.length,
          executions,
        });
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 4. Store Credential in Vault
  fastify.post(
    '/api/v1/tools/credentials',
    { preHandler: [authenticate, requirePermission('tenant:write')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const body = StoreCredentialBodySchema.parse(request.body);
        const result = await vault.storeSecret({
          serviceSlug: body.serviceSlug,
          name: body.name,
          secretData: body.secretData,
          metadata: body.metadata || {},
        });
        return reply.status(201).send(result);
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 5. List Vault Credentials (Secrets Redacted)
  fastify.get(
    '/api/v1/tools/credentials',
    { preHandler: [authenticate, requirePermission('tenant:read')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const services = await vault.listServices();
        return reply.status(200).send({
          total: services.length,
          services,
        });
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 6. Delete Credential from Vault
  fastify.delete(
    '/api/v1/tools/credentials/:serviceSlug',
    { preHandler: [authenticate, requirePermission('tenant:write')] },
    async (request, reply) => {
      const user = request.user!;
      const { serviceSlug } = request.params as { serviceSlug: string };
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        await vault.deleteSecret(serviceSlug);
        return reply.status(200).send({ success: true, serviceSlug });
      }, { userId: user.userId, roles: user.roles });
    }
  );

  // 7. Update Tool Permissions & Quota
  fastify.put(
    '/api/v1/tools/permissions',
    { preHandler: [authenticate, requirePermission('tool:configure')] },
    async (request, reply) => {
      const user = request.user!;
      return TenantContextManager.withTenant(user.tenantId, user.organizationId || 'default', async () => {
        const body = SetPermissionBodySchema.parse(request.body);
        const permission = await permissionRepo.setPermission({
          toolSlug: body.toolSlug,
          agentId: body.agentId,
          isEnabled: body.isEnabled,
          dailyQuotaLimit: body.dailyQuotaLimit,
        });
        return reply.status(200).send(permission);
      }, { userId: user.userId, roles: user.roles });
    }
  );
}
