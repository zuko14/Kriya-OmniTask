/**
 * Kriya AI — Expand-Migrate-Contract Zero-Downtime Schema Transition Manager
 * Enforces phased database evolution state machines to guarantee continuous uptime during migrations.
 */

import { SchemaTransitionPhase } from '../types/deploymentTypes.js';

export interface TransitionStepPlan {
  phase: SchemaTransitionPhase;
  instructions: string[];
  safetyGuarantees: string[];
}

export class SchemaTransitionManager {
  /**
   * Validates if a proposed phase progression is legal within the Expand-Migrate-Contract lifecycle.
   */
  public static validateProgression(
    currentPhase: SchemaTransitionPhase | null,
    nextPhase: SchemaTransitionPhase
  ): boolean {
    if (!currentPhase) {
      return nextPhase === 'expand';
    }

    if (currentPhase === 'expand' && nextPhase === 'migrate') {
      return true;
    }

    if (currentPhase === 'migrate' && nextPhase === 'contract') {
      return true;
    }

    return false;
  }

  /**
   * Generates step plans and safety checks for a given transition phase.
   */
  public static getStepPlan(tableName: string, targetVersion: string, phase: SchemaTransitionPhase): TransitionStepPlan {
    switch (phase) {
      case 'expand':
        return {
          phase: 'expand',
          instructions: [
            `Apply non-destructive additions to table '${tableName}' for version '${targetVersion}'.`,
            'Ensure all new columns have default values or allow NULL to maintain backwards compatibility with legacy application nodes.',
            'Do NOT modify or drop existing columns during this step.',
          ],
          safetyGuarantees: [
            'Zero table locking for legacy reads and writes.',
            'Full backwards compatibility with running N-1 application instances.',
          ],
        };

      case 'migrate':
        return {
          phase: 'migrate',
          instructions: [
            `Enable dual-writing in application services for table '${tableName}'.`,
            'Execute background asynchronous backfill job in throttled batches to populate new schema structures.',
            'Validate data parity and checksums between legacy and expanded columns.',
          ],
          safetyGuarantees: [
            'Throttled batch processing prevents database CPU saturation.',
            'Idempotent backfill ensures resumeability on transient failures.',
          ],
        };

      case 'contract':
        return {
          phase: 'contract',
          instructions: [
            `Confirm 100% of application traffic is running on version '${targetVersion}'.`,
            `Deprecate and remove legacy columns and temporary constraints from table '${tableName}'.`,
            'Finalize schema transition and update migration ledger.',
          ],
          safetyGuarantees: [
            'Only executed after complete fleet promotion.',
            'Reclaims unused storage and eliminates dual-write compute overhead.',
          ],
        };
    }
  }
}
