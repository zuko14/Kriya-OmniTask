/**
 * Xylarc AI — Maintenance & Announcement Manager
 * Manages global maintenance mode, read-only gating, emergency kill switch, and targeted announcements.
 */

import {
  SystemAnnouncement,
  PlatformMaintenanceState,
} from '../types/adminTypes.js';

export class MaintenanceManager {
  /**
   * Filters active, unexpired announcements targeted at a specific tenant.
   */
  public static filterAnnouncementsForTenant(
    announcements: SystemAnnouncement[],
    tenantId: string,
    now = new Date()
  ): SystemAnnouncement[] {
    const nowIso = now.toISOString();

    return announcements.filter((announcement) => {
      if (!announcement.isActive) return false;
      if (announcement.startsAt > nowIso) return false;
      if (announcement.expiresAt && announcement.expiresAt < nowIso) return false;

      // Check tenant targeting
      if (announcement.targetTenantIds.includes('*')) return true;
      return announcement.targetTenantIds.includes(tenantId);
    });
  }

  /**
   * Evaluates if incoming operational mutations are permitted under current maintenance state.
   */
  public static evaluateMaintenanceGating(
    state: PlatformMaintenanceState | null,
    isMutation = true
  ): { allowed: boolean; reason?: string } {
    if (!state) return { allowed: true };

    if (state.emergencyKillActive) {
      return {
        allowed: false,
        reason: 'Emergency kill switch is currently active across the platform. All operations halted.',
      };
    }

    if (state.isMaintenanceActive && isMutation) {
      return {
        allowed: false,
        reason: state.maintenanceMessage || 'Platform is under scheduled maintenance. Write operations are temporarily suspended.',
      };
    }

    if (state.readOnlyMode && isMutation) {
      return {
        allowed: false,
        reason: 'Platform is currently in read-only mode. No state changes allowed.',
      };
    }

    return { allowed: true };
  }
}
