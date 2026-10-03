/**
 * Kriya AI — Multi-Tenant Context Manager
 * Enforces AsyncLocalStorage-based tenant boundary isolation on every execution frame.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { CryptoUtils } from '../utils/crypto.js';
import { TenantIsolationError } from '../errors/errors.js';

export interface TenantContext {
  tenantId: string;
  organizationId: string;
  workspaceId?: string;
  userId?: string;
  roles: string[];
  correlationId: string;
  metadata?: Record<string, unknown>;
}

export class TenantContextManager {
  private static readonly storage = new AsyncLocalStorage<TenantContext>();

  /**
   * Executes a callback within a strict tenant context scope.
   */
  public static async run<T>(context: TenantContext, callback: () => Promise<T> | T): Promise<T> {
    // Ensure correlation ID is always set
    const sanitizedContext: TenantContext = {
      ...context,
      correlationId: context.correlationId || CryptoUtils.generateId(),
      roles: context.roles || [],
    };

    return this.storage.run(sanitizedContext, callback);
  }

  /**
   * Retrieves current active tenant context, or undefined if outside scope.
   */
  public static get(): TenantContext | undefined {
    return this.storage.getStore();
  }

  /**
   * Retrieves active tenant context or throws TenantIsolationError if context is missing.
   */
  public static getRequired(): TenantContext {
    const context = this.storage.getStore();
    if (!context || !context.tenantId) {
      throw new TenantIsolationError(
        'Operation rejected: Missing tenant context in execution scope.'
      );
    }
    return context;
  }

  /**
   * Retrieves active tenant ID or throws TenantIsolationError if context is missing.
   */
  public static getTenantId(): string {
    return this.getRequired().tenantId;
  }

  /**
   * Helper to run an action scoped to a given tenant and organization ID.
   */
  public static async withTenant<T>(
    tenantId: string,
    organizationId: string,
    callback: () => Promise<T> | T,
    options: { userId?: string; roles?: string[]; workspaceId?: string; correlationId?: string } = {}
  ): Promise<T> {
    const context: TenantContext = {
      tenantId,
      organizationId,
      workspaceId: options.workspaceId,
      userId: options.userId,
      roles: options.roles || ['system'],
      correlationId: options.correlationId || CryptoUtils.generateId(),
    };

    return this.run(context, callback);
  }

  /**
   * Returns current active correlation ID, or generates a temporary trace ID.
   */
  public static getCorrelationId(): string {
    const ctx = this.get();
    return ctx?.correlationId || CryptoUtils.generateId();
  }

  public static getUser(): { userId?: string; roles: string[] } | undefined {
    const ctx = this.get();
    if (!ctx) return undefined;
    return { userId: ctx.userId, roles: ctx.roles };
  }
}
