/**
 * Kriya AI — State Recovery & Lifecycle Checkpoint Engine
 * Comprehensive multi-step transaction checkpointing, state validation, and compensation rollbacks.
 */

import { OperationLifecycleState, OperationRecoveryCheckpoint } from '../types/reliabilityTypes.js';

export class StateRecoveryEngine {
  /**
   * Validates whether a requested lifecycle state transition is legal.
   */
  public static isValidTransition(
    currentState: OperationLifecycleState,
    nextState: OperationLifecycleState
  ): boolean {
    if (currentState === nextState) return true;

    // Terminal states cannot be changed except by explicit recovery/retry
    if (currentState === 'completed' || currentState === 'cancelled') {
      return false;
    }

    if (currentState === 'failed_permanently' && nextState !== 'retrying' && nextState !== 'escalated') {
      return false;
    }

    return true;
  }

  /**
   * Formulates a recovery plan from a recorded checkpoint.
   */
  public static planRecovery(checkpoint: OperationRecoveryCheckpoint): {
    canRecover: boolean;
    recoveryAction: 'retry' | 'compensate' | 'escalate' | 'none';
    instructions: string;
  } {
    switch (checkpoint.lifecycleState) {
      case 'failed':
      case 'timed_out':
        return {
          canRecover: true,
          recoveryAction: 'retry',
          instructions: 'Operation failed or timed out during execution. Re-attempting from last verified checkpoint.',
        };

      case 'partially_completed':
        return {
          canRecover: true,
          recoveryAction: checkpoint.compensationAction ? 'compensate' : 'escalate',
          instructions: checkpoint.compensationAction
            ? 'Executing registered compensation action to roll back partial mutations.'
            : 'No automated compensation registered. Escalating to Human Attention Center.',
        };

      case 'blocked':
      case 'requires_approval':
        return {
          canRecover: true,
          recoveryAction: 'escalate',
          instructions: 'Operation blocked by safety policy or pending human approval.',
        };

      default:
        return {
          canRecover: false,
          recoveryAction: 'none',
          instructions: `No recovery required for state '${checkpoint.lifecycleState}'.`,
        };
    }
  }
}
