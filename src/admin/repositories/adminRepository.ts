/**
 * Xylarc AI — Platform Administration Repository
 * Persistence for operator audit logs, fleet heartbeats, system announcements, and maintenance state.
 */

import { BaseRepository } from '../../storage/repositories/baseRepository.js';
import { DatabaseClient } from '../../storage/db.js';
import {
  OperatorAuditLog,
  NodeFleetRecord,
  SystemAnnouncement,
  PlatformMaintenanceState,
  OperatorActionType,
  NodeStatus,
  AnnouncementSeverity,
} from '../types/adminTypes.js';

export class AdminRepository extends BaseRepository<any> {
  protected readonly tableName = 'operator_audit_logs';

  constructor(client?: DatabaseClient) {
    super(client);
  }

  public async logOperatorAction(log: OperatorAuditLog): Promise<void> {
    await this.client.execute(
      `INSERT INTO operator_audit_logs
       (id, operator_id, target_tenant_id, action_type, reason, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?);`,
      [
        log.id,
        log.operatorId,
        log.targetTenantId || null,
        log.actionType,
        log.reason,
        JSON.stringify(log.metadata),
        log.createdAt,
      ]
    );
  }

  public async listOperatorLogs(limit = 100): Promise<OperatorAuditLog[]> {
    const rows = await this.client.query<any>(
      `SELECT id, operator_id, target_tenant_id, action_type, reason, metadata_json, created_at
       FROM operator_audit_logs
       ORDER BY created_at DESC
       LIMIT ?;`,
      [limit]
    );

    return rows.map((r) => ({
      id: r.id,
      operatorId: r.operator_id,
      targetTenantId: r.target_tenant_id || undefined,
      actionType: r.action_type as OperatorActionType,
      reason: r.reason,
      metadata: JSON.parse(r.metadata_json),
      createdAt: r.created_at,
    }));
  }

  public async upsertNodeHeartbeat(record: NodeFleetRecord): Promise<void> {
    await this.client.execute(
      `INSERT OR REPLACE INTO node_fleet_heartbeats
       (id, node_id, cluster_region, status, cpu_usage_pct, memory_usage_pct, active_worker_threads, active_agent_executions, last_heartbeat_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        record.id,
        record.nodeId,
        record.clusterRegion,
        record.status,
        record.cpuUsagePct,
        record.memoryUsagePct,
        record.activeWorkerThreads,
        record.activeAgentExecutions,
        record.lastHeartbeatAt,
        record.createdAt,
        record.updatedAt,
      ]
    );
  }

  public async listNodeHeartbeats(): Promise<NodeFleetRecord[]> {
    const rows = await this.client.query<any>(
      `SELECT id, node_id, cluster_region, status, cpu_usage_pct, memory_usage_pct, active_worker_threads, active_agent_executions, last_heartbeat_at, created_at, updated_at
       FROM node_fleet_heartbeats
       ORDER BY node_id ASC;`
    );

    return rows.map((r) => ({
      id: r.id,
      nodeId: r.node_id,
      clusterRegion: r.cluster_region,
      status: r.status as NodeStatus,
      cpuUsagePct: Number(r.cpu_usage_pct),
      memoryUsagePct: Number(r.memory_usage_pct),
      activeWorkerThreads: Number(r.active_worker_threads),
      activeAgentExecutions: Number(r.active_agent_executions),
      lastHeartbeatAt: r.last_heartbeat_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  public async createAnnouncement(announcement: SystemAnnouncement): Promise<void> {
    await this.client.execute(
      `INSERT INTO system_announcements
       (id, title, message, severity, is_active, target_tenant_ids_json, starts_at, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        announcement.id,
        announcement.title,
        announcement.message,
        announcement.severity,
        announcement.isActive ? 1 : 0,
        JSON.stringify(announcement.targetTenantIds),
        announcement.startsAt,
        announcement.expiresAt || null,
        announcement.createdAt,
      ]
    );
  }

  public async listAnnouncements(): Promise<SystemAnnouncement[]> {
    const rows = await this.client.query<any>(
      `SELECT id, title, message, severity, is_active, target_tenant_ids_json, starts_at, expires_at, created_at
       FROM system_announcements
       ORDER BY created_at DESC;`
    );

    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      message: r.message,
      severity: r.severity as AnnouncementSeverity,
      isActive: Boolean(r.is_active),
      targetTenantIds: JSON.parse(r.target_tenant_ids_json),
      startsAt: r.starts_at,
      expiresAt: r.expires_at || undefined,
      createdAt: r.created_at,
    }));
  }

  public async getMaintenanceState(): Promise<PlatformMaintenanceState | null> {
    const rows = await this.client.query<any>(
      `SELECT id, is_maintenance_active, maintenance_message, read_only_mode, emergency_kill_active, activated_by, activated_at, updated_at
       FROM platform_maintenance_state
       WHERE id = 'global_maintenance_state';`
    );

    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      id: r.id,
      isMaintenanceActive: Boolean(r.is_maintenance_active),
      maintenanceMessage: r.maintenance_message || undefined,
      readOnlyMode: Boolean(r.read_only_mode),
      emergencyKillActive: Boolean(r.emergency_kill_active),
      activatedBy: r.activated_by || undefined,
      activatedAt: r.activated_at || undefined,
      updatedAt: r.updated_at,
    };
  }

  public async updateMaintenanceState(state: PlatformMaintenanceState): Promise<void> {
    await this.client.execute(
      `INSERT OR REPLACE INTO platform_maintenance_state
       (id, is_maintenance_active, maintenance_message, read_only_mode, emergency_kill_active, activated_by, activated_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        'global_maintenance_state',
        state.isMaintenanceActive ? 1 : 0,
        state.maintenanceMessage || null,
        state.readOnlyMode ? 1 : 0,
        state.emergencyKillActive ? 1 : 0,
        state.activatedBy || null,
        state.activatedAt || null,
        state.updatedAt,
      ]
    );
  }

  public async listAllTenants(): Promise<any[]> {
    return this.client.query<any>(
      `SELECT id, name, slug, status, plan_tier, channel_plan, created_at, updated_at
       FROM tenants
       ORDER BY created_at DESC;`
    );
  }

  public async provisionTenant(tenant: any): Promise<void> {
    await this.client.execute(
      `INSERT INTO tenants
       (id, name, slug, status, plan_tier, channel_plan, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        tenant.id,
        tenant.name,
        tenant.slug,
        tenant.status,
        tenant.planTier,
        tenant.channelPlan,
        tenant.createdAt,
        tenant.updatedAt,
      ]
    );
  }

  public async updateTenantStatus(tenantId: string, status: string): Promise<void> {
    await this.client.execute(
      `UPDATE tenants
       SET status = ?, updated_at = ?
       WHERE id = ?;`,
      [status, new Date().toISOString(), tenantId]
    );
  }
}
