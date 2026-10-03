/**
 * Kriya AI — Tenant Lifecycle Engine
 * State transition validation, operational gating, and tenant provisioning logic.
 */

import { TenantLifecycleStatus } from '../types/adminTypes.js';

export class TenantLifecycleEngine {
  private static readonly ALLOWED_TRANSITIONS: Record<TenantLifecycleStatus, TenantLifecycleStatus[]> = {
    trial: ['active', 'suspended', 'pending_deletion', 'degraded', 'disabled'],
    active: ['suspended', 'pending_deletion', 'degraded', 'disabled'],
    degraded: ['active', 'suspended', 'pending_deletion', 'disabled'],
    suspended: ['active', 'pending_deletion', 'disabled'],
    disabled: ['active', 'suspended', 'pending_deletion'],
    pending_deletion: ['suspended', 'active'], // Can abort deletion within grace period
  };

  /**
   * Validates whether a requested tenant status transition is permissible.
   */
  public static validateTransition(
    currentStatus: TenantLifecycleStatus,
    targetStatus: TenantLifecycleStatus
  ): boolean {
    if (currentStatus === targetStatus) return true;
    const allowed = this.ALLOWED_TRANSITIONS[currentStatus] || [];
    return allowed.includes(targetStatus);
  }

  /**
   * Evaluates if a tenant is in an operational state that permits agent task execution.
   */
  public static isExecutionPermitted(status: TenantLifecycleStatus): { permitted: boolean; reason?: string } {
    if (status === 'active' || status === 'trial') {
      return { permitted: true };
    }

    if (status === 'suspended') {
      return {
        permitted: false,
        reason: 'Tenant account is currently suspended due to administrative or billing hold.',
      };
    }

    if (status === 'pending_deletion') {
      return {
        permitted: false,
        reason: 'Tenant account is in pending deletion state and cannot execute new operations.',
      };
    }

    return {
      permitted: false,
      reason: `Tenant status '${status}' does not permit execution.`,
    };
  }
}
