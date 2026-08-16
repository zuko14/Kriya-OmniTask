import { describe, it, expect } from 'vitest';
import { MaintenanceManager } from '../../src/admin/maintenance/maintenanceManager.js';
import { SystemAnnouncement, PlatformMaintenanceState } from '../../src/admin/types/adminTypes.js';

describe('MaintenanceManager Unit Tests', () => {
  const now = new Date('2026-03-01T12:00:00.000Z');

  const announcements: SystemAnnouncement[] = [
    {
      id: 'anc_global',
      title: 'Scheduled Upgrade',
      message: 'Platform maintenance tonight',
      severity: 'info',
      isActive: true,
      targetTenantIds: ['*'], // Global
      startsAt: '2026-03-01T10:00:00.000Z',
      expiresAt: '2026-03-01T18:00:00.000Z',
      createdAt: '2026-03-01T10:00:00.000Z',
    },
    {
      id: 'anc_tenant_a',
      title: 'Custom Feature Beta',
      message: 'New agents available',
      severity: 'info',
      isActive: true,
      targetTenantIds: ['tenant_alpha'],
      startsAt: '2026-03-01T10:00:00.000Z',
      createdAt: '2026-03-01T10:00:00.000Z',
    },
    {
      id: 'anc_expired',
      title: 'Old Notice',
      message: 'Expired notice',
      severity: 'info',
      isActive: true,
      targetTenantIds: ['*'],
      startsAt: '2026-02-01T00:00:00.000Z',
      expiresAt: '2026-02-15T00:00:00.000Z', // Expired
      createdAt: '2026-02-01T00:00:00.000Z',
    },
  ];

  it('should filter active announcements specifically targeted for a tenant', () => {
    const listAlpha = MaintenanceManager.filterAnnouncementsForTenant(announcements, 'tenant_alpha', now);
    expect(listAlpha.length).toBe(2); // Global + Alpha

    const listBeta = MaintenanceManager.filterAnnouncementsForTenant(announcements, 'tenant_beta', now);
    expect(listBeta.length).toBe(1); // Global only
    expect(listBeta[0].id).toBe('anc_global');
  });

  it('should enforce maintenance and emergency kill gating on mutations', () => {
    const normalState: PlatformMaintenanceState = {
      id: 'global_maintenance_state',
      isMaintenanceActive: false,
      readOnlyMode: false,
      emergencyKillActive: false,
      updatedAt: '2026-03-01T00:00:00Z',
    };
    expect(MaintenanceManager.evaluateMaintenanceGating(normalState, true).allowed).toBe(true);

    const maintState: PlatformMaintenanceState = {
      ...normalState,
      isMaintenanceActive: true,
      maintenanceMessage: 'System upgrading to v2.5',
    };
    const maintRes = MaintenanceManager.evaluateMaintenanceGating(maintState, true);
    expect(maintRes.allowed).toBe(false);
    expect(maintRes.reason).toContain('System upgrading');

    const killState: PlatformMaintenanceState = {
      ...normalState,
      emergencyKillActive: true,
    };
    const killRes = MaintenanceManager.evaluateMaintenanceGating(killState, false);
    expect(killRes.allowed).toBe(false);
    expect(killRes.reason).toContain('Emergency kill switch is currently active');
  });
});
