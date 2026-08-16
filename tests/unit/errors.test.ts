import { describe, it, expect } from 'vitest';
import {
  TenantIsolationError,
  UnauthorizedError,
  ForbiddenError,
  ValidationError,
  NotFoundError,
  PolicyViolationError,
  ToolExecutionError,
} from '../../src/core/errors/errors.js';

describe('Structured Error Hierarchy', () => {
  it('should construct TenantIsolationError with correct status and code', () => {
    const err = new TenantIsolationError('Cross-tenant leak detected', { tenantId: 't-123' });
    expect(err.statusCode).toBe(403);
    expect(err.code).toBe('TENANT_ISOLATION_VIOLATION');
    expect(err.isOperational).toBe(true);
    expect(err.toJSON().error.details).toEqual({ tenantId: 't-123' });
  });

  it('should construct UnauthorizedError and ForbiddenError appropriately', () => {
    const unauth = new UnauthorizedError();
    expect(unauth.statusCode).toBe(401);
    expect(unauth.code).toBe('UNAUTHORIZED');

    const forbidden = new ForbiddenError();
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.code).toBe('FORBIDDEN');
  });

  it('should serialize error with correlationId', () => {
    const valErr = new ValidationError('Invalid email format');
    valErr.correlationId = 'corr-uuid-456';

    const json = valErr.toJSON();
    expect(json.error.name).toBe('ValidationError');
    expect(json.error.code).toBe('VALIDATION_ERROR');
    expect(json.error.correlationId).toBe('corr-uuid-456');
    expect(json.error.statusCode).toBe(400);
  });
});
