/**
 * Xylarc AI — Granular ABAC Policy Evaluator
 * Attribute-Based Access Control enforcing data classifications, department boundaries, and clearance levels.
 */

import {
  AbacEvaluationRequest,
  AbacEvaluationResult,
  DataClassification,
} from '../types/governanceTypes.js';

export class AbacPolicyEvaluator {
  private static readonly CLASSIFICATION_LEVELS: Record<DataClassification, number> = {
    public: 1,
    internal: 2,
    confidential: 3,
    restricted: 4,
  };

  /**
   * Evaluates if a subject is authorized to perform an action on a target resource.
   */
  public static evaluate(
    request: AbacEvaluationRequest,
    accessibleUnitIds?: string[]
  ): AbacEvaluationResult {
    const now = new Date().toISOString();
    const { subject, resource, action } = request;

    const subjectClearance = this.CLASSIFICATION_LEVELS[subject.clearanceLevel || 'internal'] || 1;
    const resourceClassification = this.CLASSIFICATION_LEVELS[resource.classification || 'internal'] || 1;

    // 1. Data Classification Clearance Check
    if (subjectClearance < resourceClassification) {
      return {
        decision: 'deny',
        reason: `Subject clearance level '${subject.clearanceLevel}' is insufficient for resource classification '${resource.classification}'.`,
        evaluatedAt: now,
      };
    }

    // 2. Admin Universal Permission Override (Subject to Clearance already verified)
    const isAdmin = subject.roles.includes('admin');
    if (isAdmin) {
      return {
        decision: 'allow',
        reason: 'Authorized via Administrator role with validated clearance.',
        evaluatedAt: now,
      };
    }

    // 3. Organization Unit Boundary Check
    if (resource.unitId && subject.unitId) {
      const allowedUnits = accessibleUnitIds || [subject.unitId];
      if (!allowedUnits.includes(resource.unitId)) {
        return {
          decision: 'deny',
          reason: `Resource belongs to unit '${resource.unitId}', which is outside subject unit boundary.`,
          evaluatedAt: now,
        };
      }
    }

    // 4. Action Specific Restrictions
    if (action === 'delete' || action === 'export') {
      const hasPrivilegedRole = subject.roles.some((r) =>
        ['operations_manager', 'compliance_officer', 'finance_manager'].includes(r)
      );
      if (!hasPrivilegedRole) {
        return {
          decision: 'deny',
          reason: `Action '${action}' requires elevated compliance or operational managerial privilege.`,
          evaluatedAt: now,
        };
      }
    }

    // 5. Read-only role cannot write or execute
    if (subject.roles.includes('read_only') && (action === 'write' || action === 'execute')) {
      return {
        decision: 'deny',
        reason: "Subject has 'read_only' role and cannot perform mutation or execution.",
        evaluatedAt: now,
      };
    }

    return {
      decision: 'allow',
      reason: 'Access permitted under dynamic ABAC policy rules.',
      evaluatedAt: now,
    };
  }
}
