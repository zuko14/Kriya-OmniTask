/**
 * Xylarc AI — Structured JSON Logger with Tenant & Trace Attribution
 * Automatically attaches correlation IDs, tenant scopes, timestamps, and error stacks
 * with zero PII/secret leakage.
 */

import { TenantContextManager } from '../context/tenantContext.js';
import { config } from '../config/config.js';

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

const SENSITIVE_KEYS = new Set([
  'password',
  'secret',
  'token',
  'jwt',
  'apikey',
  'api_key',
  'authorization',
  'credit_card',
  'card_number',
  'cvv',
  'ssn',
]);

export class Logger {
  private service: string;

  constructor(service = 'xylarc-core') {
    this.service = service;
  }

  public trace(message: string, context?: Record<string, unknown>): void {
    this.log('trace', message, context);
  }

  public debug(message: string, context?: Record<string, unknown>): void {
    this.log('debug', message, context);
  }

  public info(message: string, context?: Record<string, unknown>): void {
    this.log('info', message, context);
  }

  public warn(message: string, context?: Record<string, unknown>): void {
    this.log('warn', message, context);
  }

  public error(message: string, error?: Error | unknown, context?: Record<string, unknown>): void {
    let errorDetails: Record<string, unknown> | undefined;
    if (error instanceof Error) {
      errorDetails = {
        name: error.name,
        message: error.message,
        stack: error.stack,
        ...(error as unknown as Record<string, unknown>),
      };
    } else if (error) {
      errorDetails = { raw: String(error) };
    }

    this.log('error', message, { ...context, error: errorDetails });
  }

  public fatal(message: string, error?: Error | unknown, context?: Record<string, unknown>): void {
    let errorDetails: Record<string, unknown> | undefined;
    if (error instanceof Error) {
      errorDetails = {
        name: error.name,
        message: error.message,
        stack: error.stack,
        ...(error as unknown as Record<string, unknown>),
      };
    } else if (error) {
      errorDetails = { raw: String(error) };
    }

    this.log('fatal', message, { ...context, error: errorDetails });
  }

  private log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    const configuredLevel = config.get('LOG_LEVEL') as LogLevel;
    if (LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[configuredLevel]) {
      return;
    }

    const tenantCtx = TenantContextManager.get();
    const timestamp = new Date().toISOString();

    const logEntry = {
      timestamp,
      level,
      service: this.service,
      message,
      correlationId: tenantCtx?.correlationId,
      tenantId: tenantCtx?.tenantId,
      organizationId: tenantCtx?.organizationId,
      workspaceId: tenantCtx?.workspaceId,
      userId: tenantCtx?.userId,
      context: context ? this.sanitize(context) : undefined,
    };

    if (config.get('NODE_ENV') === 'development' && process.env.PRETTY_LOGS === 'true') {
      const color = this.getColor(level);
      const ctxStr = context ? ` | ${JSON.stringify(this.sanitize(context))}` : '';
      const tenantStr = tenantCtx?.tenantId ? ` [Tenant:${tenantCtx.tenantId}]` : '';
      console.log(`${color}[${timestamp}] [${level.toUpperCase()}] [${this.service}]${tenantStr} ${message}${ctxStr}\x1b[0m`);
    } else {
      console.log(JSON.stringify(logEntry));
    }
  }

  private sanitize(obj: unknown, depth = 0): unknown {
    if (depth > 5) return '[Truncated]';
    if (!obj || typeof obj !== 'object') return obj;

    if (Array.isArray(obj)) {
      return obj.map((item) => this.sanitize(item, depth + 1));
    }

    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(key.toLowerCase())) {
        cleaned[key] = '[REDACTED]';
      } else if (typeof value === 'object' && value !== null) {
        cleaned[key] = this.sanitize(value, depth + 1);
      } else {
        cleaned[key] = value;
      }
    }
    return cleaned;
  }

  private getColor(level: LogLevel): string {
    switch (level) {
      case 'trace': return '\x1b[90m';
      case 'debug': return '\x1b[36m';
      case 'info': return '\x1b[32m';
      case 'warn': return '\x1b[33m';
      case 'error': return '\x1b[31m';
      case 'fatal': return '\x1b[35m';
    }
  }
}

export const logger = new Logger('xylarc-core');
