/**
 * Xylarc AI — Structured Error Hierarchy
 * Strictly categorized domain errors with error codes, HTTP status mappings,
 * operational classification, and correlation ID support.
 */

export abstract class AppError extends Error {
  public abstract readonly code: string;
  public abstract readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly details?: Record<string, unknown>;
  public correlationId?: string;

  constructor(message: string, details?: Record<string, unknown>, isOperational = true) {
    super(message);
    this.name = this.constructor.name;
    this.details = details;
    this.isOperational = isOperational;
    Error.captureStackTrace(this, this.constructor);
  }

  public toJSON() {
    return {
      error: {
        name: this.name,
        code: this.code,
        message: this.message,
        statusCode: this.statusCode,
        correlationId: this.correlationId,
        details: this.details,
      },
    };
  }
}

export class TenantIsolationError extends AppError {
  public readonly code = 'TENANT_ISOLATION_VIOLATION';
  public readonly statusCode = 403;

  constructor(message = 'Access across tenant boundaries is strictly prohibited', details?: Record<string, unknown>) {
    super(message, details, true);
  }
}

export class UnauthorizedError extends AppError {
  public readonly code = 'UNAUTHORIZED';
  public readonly statusCode = 401;

  constructor(message = 'Authentication required or invalid credentials', details?: Record<string, unknown>) {
    super(message, details, true);
  }
}

export class ForbiddenError extends AppError {
  public readonly code = 'FORBIDDEN';
  public readonly statusCode = 403;

  constructor(message = 'Insufficient permissions to perform this action', details?: Record<string, unknown>) {
    super(message, details, true);
  }
}

export class ValidationError extends AppError {
  public readonly code = 'VALIDATION_ERROR';
  public readonly statusCode = 400;

  constructor(message = 'Request validation failed', details?: Record<string, unknown>) {
    super(message, details, true);
  }
}

export class NotFoundError extends AppError {
  public readonly code = 'NOT_FOUND';
  public readonly statusCode = 404;

  constructor(message = 'Requested resource was not found', details?: Record<string, unknown>) {
    super(message, details, true);
  }
}

export class ConflictError extends AppError {
  public readonly code = 'CONFLICT';
  public readonly statusCode = 409;

  constructor(message = 'Resource conflict or duplicate state detected', details?: Record<string, unknown>) {
    super(message, details, true);
  }
}

export class PolicyViolationError extends AppError {
  public readonly code = 'POLICY_VIOLATION';
  public readonly statusCode = 422;

  constructor(message = 'Action violates agent safety or tenant operational policy', details?: Record<string, unknown>) {
    super(message, details, true);
  }
}

export class ToolExecutionError extends AppError {
  public readonly code = 'TOOL_EXECUTION_ERROR';
  public readonly statusCode = 502;

  constructor(message = 'Tool execution failed or timed out', details?: Record<string, unknown>) {
    super(message, details, true);
  }
}

export class AgentExecutionError extends AppError {
  public readonly code = 'AGENT_EXECUTION_ERROR';
  public readonly statusCode = 500;

  constructor(message = 'Agent execution encountered an unrecoverable failure', details?: Record<string, unknown>) {
    super(message, details, true);
  }
}

export class BusinessLogicError extends AppError {
  public readonly code = 'BUSINESS_LOGIC_ERROR';
  public readonly statusCode = 400;

  constructor(message = 'Business logic validation or state transition failed', details?: Record<string, unknown>) {
    super(message, details, true);
  }
}
