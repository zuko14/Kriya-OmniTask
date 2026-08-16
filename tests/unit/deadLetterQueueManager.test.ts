import { describe, it, expect } from 'vitest';
import { DeadLetterQueueManager } from '../../src/reliability/dlq/deadLetterQueueManager.js';

describe('DeadLetterQueueManager Unit Tests', () => {
  it('should evaluate retry eligibility and track retry counts', () => {
    const eval1 = DeadLetterQueueManager.evaluateRetry(0, 3);
    expect(eval1.canRetry).toBe(true);
    expect(eval1.nextRetryCount).toBe(1);
    expect(eval1.nextStatus).toBe('retrying');

    const evalMax = DeadLetterQueueManager.evaluateRetry(3, 3);
    expect(evalMax.canRetry).toBe(false);
    expect(evalMax.nextRetryCount).toBe(3);
    expect(evalMax.nextStatus).toBe('pending_review');
  });

  it('should format job record with error messages and stacks', () => {
    const record = DeadLetterQueueManager.createJobRecord({
      tenantId: 'tenant_123',
      organizationId: 'org_123',
      jobType: 'DISPATCH_WHATSAPP_CONFIRMATION',
      payload: { messageId: 'msg_999', recipient: '+1234567890' },
      error: new Error('Meta API 500: Service Unavailable'),
      maxRetries: 5,
    });

    expect(record.tenantId).toBe('tenant_123');
    expect(record.jobType).toBe('DISPATCH_WHATSAPP_CONFIRMATION');
    expect(record.failureReason).toBe('Meta API 500: Service Unavailable');
    expect(record.errorStack).toBeDefined();
    expect(record.status).toBe('pending_review');
    expect(record.retryCount).toBe(0);
    expect(record.maxRetries).toBe(5);
  });
});
