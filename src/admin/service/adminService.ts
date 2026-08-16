/**
 * Xylarc AI — Platform Administration Service
 * High-level orchestration for operator control plane, tenant lifecycles, fleet diagnostics, and maintenance controls.
 */

import { AdminRepository } from '../repositories/adminRepository.js';
import { TenantLifecycleEngine } from '../lifecycle/tenantLifecycleEngine.js';
import { FleetHealthDiagnostics } from '../fleet/fleetHealthDiagnostics.js';
import { MaintenanceManager } from '../maintenance/maintenanceManager.js';
import {
  ProvisionTenantRequest,
  UpdateTenantStatusRequest,
  NodeHeartbeatRequest,
  NodeFleetRecord,
  FleetDiagnosticsSummary,
  CreateAnnouncementRequest,
  SystemAnnouncement,
  UpdateMaintenanceStateRequest,
  PlatformMaintenanceState,
  OperatorAuditLog,
  TenantLifecycleStatus,
} from '../types/adminTypes.js';
import { CryptoUtils } from '../../core/utils/crypto.js';

export class AdminService {
  private repo = new AdminRepository();

  public async provisionTenant(request: ProvisionTenantRequest, operatorId: string): Promise<any> {
    const now = new Date().toISOString();
    const tenant = {
      id: request.id,
      name: request.name,
      slug: request.slug,
      status: 'active',
      planTier: request.planTier,
      channelPlan: request.channelPlan,
      createdAt: now,
      updatedAt: now,
    };

    await this.repo.provisionTenant(tenant);

    await this.repo.logOperatorAction({
      id: `opl_${CryptoUtils.generateId()}`,
      operatorId,
      targetTenantId: request.id,
      actionType: 'tenant_provision',
      reason: `Provisioned tenant '${request.name}' with plan '${request.planTier}'.`,
      metadata: { adminEmail: request.adminEmail, maxAgents: request.maxAgents },
      createdAt: now,
    });

    return tenant;
  }

  public async updateTenantStatus(
    tenantId: string,
    request: UpdateTenantStatusRequest,
    operatorId: string
  ): Promise<void> {
    const tenants = await this.repo.listAllTenants();
    const target = tenants.find((t) => t.id === tenantId);
    if (!target) {
      throw new Error(`Tenant '${tenantId}' not found.`);
    }

    const currentStatus = target.status as TenantLifecycleStatus;
    const isValid = TenantLifecycleEngine.validateTransition(currentStatus, request.status);
    if (!isValid) {
      throw new Error(`Invalid tenant status transition from '${currentStatus}' to '${request.status}'.`);
    }

    await this.repo.updateTenantStatus(tenantId, request.status);

    const now = new Date().toISOString();
    let actionType: any = 'tenant_suspend';
    if (request.status === 'active') actionType = 'tenant_reactivate';
    if (request.status === 'pending_deletion') actionType = 'tenant_delete';

    await this.repo.logOperatorAction({
      id: `opl_${CryptoUtils.generateId()}`,
      operatorId,
      targetTenantId: tenantId,
      actionType,
      reason: request.reason,
      metadata: { previousStatus: currentStatus, newStatus: request.status },
      createdAt: now,
    });
  }

  public async listAllTenants(): Promise<any[]> {
    return this.repo.listAllTenants();
  }

  public async recordNodeHeartbeat(request: NodeHeartbeatRequest): Promise<NodeFleetRecord> {
    const now = new Date().toISOString();
    const record: NodeFleetRecord = {
      id: `node_${request.nodeId}`,
      nodeId: request.nodeId,
      clusterRegion: request.clusterRegion,
      status: request.status,
      cpuUsagePct: request.cpuUsagePct,
      memoryUsagePct: request.memoryUsagePct,
      activeWorkerThreads: request.activeWorkerThreads,
      activeAgentExecutions: request.activeAgentExecutions,
      lastHeartbeatAt: now,
      createdAt: now,
      updatedAt: now,
    };

    await this.repo.upsertNodeHeartbeat(record);
    return record;
  }

  public async getFleetDiagnostics(): Promise<FleetDiagnosticsSummary> {
    const nodes = await this.repo.listNodeHeartbeats();
    return FleetHealthDiagnostics.evaluateDiagnostics(nodes);
  }

  public async createAnnouncement(
    request: CreateAnnouncementRequest,
    operatorId: string
  ): Promise<SystemAnnouncement> {
    const now = new Date().toISOString();
    const announcement: SystemAnnouncement = {
      id: `anc_${CryptoUtils.generateId()}`,
      title: request.title,
      message: request.message,
      severity: request.severity,
      isActive: true,
      targetTenantIds: request.targetTenantIds,
      startsAt: request.startsAt || now,
      expiresAt: request.expiresAt,
      createdAt: now,
    };

    await this.repo.createAnnouncement(announcement);

    await this.repo.logOperatorAction({
      id: `opl_${CryptoUtils.generateId()}`,
      operatorId,
      actionType: 'global_announcement_broadcast',
      reason: `Broadcasted announcement '${request.title}' (severity: ${request.severity}).`,
      metadata: { targetTenantIds: request.targetTenantIds },
      createdAt: now,
    });

    return announcement;
  }

  public async listAnnouncementsForTenant(tenantId: string): Promise<SystemAnnouncement[]> {
    const announcements = await this.repo.listAnnouncements();
    return MaintenanceManager.filterAnnouncementsForTenant(announcements, tenantId);
  }

  public async updateMaintenanceState(
    request: UpdateMaintenanceStateRequest,
    operatorId: string
  ): Promise<PlatformMaintenanceState> {
    const now = new Date().toISOString();
    const state: PlatformMaintenanceState = {
      id: 'global_maintenance_state',
      isMaintenanceActive: request.isMaintenanceActive,
      maintenanceMessage: request.maintenanceMessage,
      readOnlyMode: request.readOnlyMode,
      emergencyKillActive: request.emergencyKillActive,
      activatedBy: operatorId,
      activatedAt: now,
      updatedAt: now,
    };

    await this.repo.updateMaintenanceState(state);

    let actionType: any = 'maintenance_mode_toggle';
    if (request.emergencyKillActive) actionType = 'emergency_kill_switch';

    await this.repo.logOperatorAction({
      id: `opl_${CryptoUtils.generateId()}`,
      operatorId,
      actionType,
      reason: request.reason,
      metadata: {
        isMaintenanceActive: request.isMaintenanceActive,
        readOnlyMode: request.readOnlyMode,
        emergencyKillActive: request.emergencyKillActive,
      },
      createdAt: now,
    });

    return state;
  }

  public async getMaintenanceState(): Promise<PlatformMaintenanceState> {
    const state = await this.repo.getMaintenanceState();
    return (
      state || {
        id: 'global_maintenance_state',
        isMaintenanceActive: false,
        readOnlyMode: false,
        emergencyKillActive: false,
        updatedAt: new Date().toISOString(),
      }
    );
  }

  public async listOperatorLogs(limit = 100): Promise<OperatorAuditLog[]> {
    return this.repo.listOperatorLogs(limit);
  }
}
