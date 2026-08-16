import { describe, it, expect } from 'vitest';
import { StateRecoveryEngine } from '../../src/reliability/recovery/stateRecoveryEngine.js';
import { OperationRecoveryCheckpoint } from '../../src/reliability/types/reliabilityTypes.js';

describe('StateRecoveryEngine Unit Tests', () => {
  it('should validate lifecycle state transitions and protect terminal states', () => {
    expect(StateRecoveryEngine.isValidTransition('pending', 'running')).toBe(true);
    expect(StateRecoveryEngine.isValidTransition('running', 'completed')).toBe(true);
    expect(StateRecoveryEngine.isValidTransition('completed', 'running')).toBe(false); // Terminal
    expect(StateRecoveryEngine.isValidTransition('cancelled', 'pending')).toBe(false); // Terminal
    expect(StateRecoveryEngine.isValidTransition('failed_permanently', 'retrying')).toBe(true);
  });

  it('should formulate appropriate recovery plans based on failure states and compensation actions', () => {
    const failedCheckpoint: OperationRecoveryCheckpoint = {
      id: 'rec_1',
      tenantId: 'tenant_1',
      organizationId: 'default',
      operationId: 'op_1',
      operationType: 'PAYMENT_CAPTURE',
      lifecycleState: 'failed',
      checkpointState: { attempt: 1 },
      createdAt: '2026-08-15T00:00:00Z',
      updatedAt: '2026-08-15T00:00:00Z',
    };

    const planRetry = StateRecoveryEngine.planRecovery(failedCheckpoint);
    expect(planRetry.canRecover).toBe(true);
    expect(planRetry.recoveryAction).toBe('retry');

    const partialCheckpoint: OperationRecoveryCheckpoint = {
      ...failedCheckpoint,
      lifecycleState: 'partially_completed',
      compensationAction: { action: 'REFUND_STRIPE_HOLD', chargeId: 'ch_123' },
    };

    const planCompensate = StateRecoveryEngine.planRecovery(partialCheckpoint);
    expect(planCompensate.canRecover).toBe(true);
    expect(planCompensate.recoveryAction).toBe('compensate');
    expect(planCompensate.instructions).toContain('Executing registered compensation action');
  });
});
