import { describe, it, expect } from 'vitest';
import { IdempotencyManager } from '../../src/reliability/idempotency/idempotencyManager.js';
import { IdempotencyRecord } from '../../src/reliability/types/reliabilityTypes.js';

describe('IdempotencyManager Unit Tests', () => {
  it('should compute deterministic hashes regardless of payload key insertion order', () => {
    const payloadA = { amount: 100, currency: 'USD', customerId: 'cust_123' };
    const payloadB = { customerId: 'cust_123', currency: 'USD', amount: 100 };

    const hashA = IdempotencyManager.computePayloadHash(payloadA);
    const hashB = IdempotencyManager.computePayloadHash(payloadB);

    expect(hashA).toBe(hashB);
    expect(hashA.length).toBe(64);
  });

  it('should allow fresh execution when key is null or expired', () => {
    const evalNew = IdempotencyManager.evaluateExistingKey(null, 'hash_123');
    expect(evalNew.canExecute).toBe(true);

    const expiredRecord: IdempotencyRecord = {
      id: 'idem_1',
      tenantId: 'tenant_1',
      organizationId: 'default',
      idempotencyKey: 'key_1',
      resourceType: 'booking',
      requestHash: 'hash_123',
      responsePayload: '{"status":"ok"}',
      status: 'completed',
      createdAt: '2026-01-01T00:00:00Z',
      expiresAt: '2026-01-02T00:00:00Z', // Expired
    };

    const evalExpired = IdempotencyManager.evaluateExistingKey(expiredRecord, 'hash_123');
    expect(evalExpired.canExecute).toBe(true);
  });

  it('should return cached response for completed key and throw on concurrent in_progress key', () => {
    const futureDate = new Date(Date.now() + 3600000).toISOString();
    const completedRecord: IdempotencyRecord = {
      id: 'idem_2',
      tenantId: 'tenant_1',
      organizationId: 'default',
      idempotencyKey: 'key_2',
      resourceType: 'payment',
      requestHash: 'hash_abc',
      responsePayload: JSON.stringify({ paymentId: 'pay_999', status: 'PAID' }),
      status: 'completed',
      createdAt: new Date().toISOString(),
      expiresAt: futureDate,
    };

    const evalCompleted = IdempotencyManager.evaluateExistingKey(completedRecord, 'hash_abc');
    expect(evalCompleted.canExecute).toBe(false);
    expect(evalCompleted.cachedResponse).toEqual({ paymentId: 'pay_999', status: 'PAID' });

    const inProgressRecord: IdempotencyRecord = {
      ...completedRecord,
      status: 'in_progress',
      responsePayload: null,
    };

    expect(() => IdempotencyManager.evaluateExistingKey(inProgressRecord, 'hash_abc')).toThrow();
  });
});
