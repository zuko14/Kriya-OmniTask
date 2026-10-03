/**
 * Kriya Omnitask — Platform Administration Service
 * High-level orchestration for operator control plane, enterprise tenant provisioning,
 * operator elevation sessions, fleet diagnostics, and maintenance controls (§2, §17.1, §17.2, §17.6).
 */

import { AdminRepository } from '../repositories/adminRepository.js';
import { TenantRepository, TenantRecord, TenantElevationRecord } from '../../storage/repositories/tenantRepository.js';
import { TenantLifecycleEngine } from '../lifecycle/tenantLifecycleEngine.js';
import { FleetHealthDiagnostics } from '../fleet/fleetHealthDiagnostics.js';
import { MaintenanceManager } from '../maintenance/maintenanceManager.js';
import {
  ProvisionTenantRequest,
  UpdateTenantStatusRequest,
  ElevateSessionRequest,
  OrganizationRosterItem,
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
import { JwtService } from '../../security/auth/jwt.js';
import { auditLogger } from '../../security/audit/auditLogger.js';
import { TenantContextManager } from '../../core/context/tenantContext.js';
import { BusinessDnaService } from '../../governance/dna/businessDnaService.js';
import { db } from '../../storage/db.js';
import { ConflictError, NotFoundError } from '../../core/errors/errors.js';
import { isPlatformTenantSlug } from '../../security/auth/platformOperator.js';
import { USD_TO_INR_RATE } from '../../context/types/contextTypes.js';

export class AdminService {
  private repo = new AdminRepository();
  private tenantRepo = new TenantRepository();

  /**
   * Provisions a new enterprise tenant from the Owner Console (§2, §17.2).
   * Writes tenant record, organization, workspace, initial admin user, and cryptographic audit entry.
   */
  public async provisionTenant(
    request: ProvisionTenantRequest,
    operatorId: string
  ): Promise<{ id: string; name: string; slug: string; status: string; tenant: TenantRecord; organizationId: string; workspaceId: string; adminUserId: string; adminEmail: string; generatedAdminPassword?: string; manifest?: any }> {
    const now = new Date().toISOString();
    const tenantId = request.id || `tnt_${CryptoUtils.generateId()}`;
    const orgId = `org_${tenantId}`;
    const wsId = `ws_${tenantId}`;
    const adminUserId = `usr_${CryptoUtils.generateId()}`;

    if (isPlatformTenantSlug(request.slug) || (await this.tenantRepo.findBySlug(request.slug))) {
      throw new ConflictError(`Workspace slug '${request.slug}' is already taken.`);
    }

    // Generated when the operator didn't set one; returned exactly once and never stored in clear.
    const generatedPassword = request.adminPassword ? undefined : CryptoUtils.generateSecureToken(12);
    const rawPassword = request.adminPassword || generatedPassword!;

    // Steps 1-4 commit together so a failure never leaves a half-provisioned client.
    const tenant = await db.getClient().transaction(async (client) => {
    // 1. Create Tenant Record
    const tenant = await this.tenantRepo.create({
      id: tenantId,
      name: request.name,
      slug: request.slug,
      plan_tier: request.planTier,
      channel_plan: request.channelPlan,
      industry: request.industry,
      region: request.region,
      languages: request.languages,
      timezone: request.timezone,
      dna_profile_id: request.dnaProfileId,
      brain_supply_mode: request.brainSupplyMode,
      quotas: request.quotas,
      autonomy_ceiling: request.autonomyCeiling,
    });

    // 2. Create Default Organization & Workspace
    await client.execute(
      `INSERT INTO organizations (id, tenant_id, name, slug, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?);`,
      [orgId, tenantId, `${request.name} Primary Org`, request.slug, now, now]
    );

    await client.execute(
      `INSERT INTO workspaces (id, tenant_id, organization_id, name, slug, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?);`,
      [wsId, tenantId, orgId, 'Default Workspace', 'default', now, now]
    );

    // 3. Create Tenant Admin User
    const passwordHash = CryptoUtils.hashPassword(rawPassword);

    await client.execute(
      `INSERT INTO users (id, tenant_id, email, password_hash, full_name, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?);`,
      [
        adminUserId,
        tenantId,
        request.adminEmail.toLowerCase().trim(),
        passwordHash,
        request.adminFullName || `${request.name} Admin`,
        now,
        now,
      ]
    );

    // 4. Assign Admin Role
    await client.execute(
      `INSERT INTO user_roles (user_id, role_id, tenant_id, created_at)
       VALUES (?, 'role-admin', ?, ?);`,
      [adminUserId, tenantId, now]
    );
    return tenant;
    });

    // 5. Immutable Cryptographic Audit Ledger Entry (Hard Requirement §2 & M2)
    await TenantContextManager.withTenant(tenantId, orgId, async () => {
      await auditLogger.logEvent({
        action: 'tenant.provisioned',
        resourceType: 'tenant',
        resourceId: tenantId,
        details: {
          operatorId,
          businessName: request.name,
          slug: request.slug,
          planTier: request.planTier,
          channelPlan: request.channelPlan,
          dnaProfileId: request.dnaProfileId,
          brainSupplyMode: request.brainSupplyMode,
          industry: request.industry,
          region: request.region,
          languages: request.languages,
          quotas: request.quotas,
          autonomyCeiling: request.autonomyCeiling,
          adminEmail: request.adminEmail,
        },
      });
    }, { userId: operatorId, roles: ['system', 'operator'] });

    // 6. Operator Audit Log
    await this.repo.logOperatorAction({
      id: `opl_${CryptoUtils.generateId()}`,
      operatorId,
      targetTenantId: tenantId,
      actionType: 'tenant_provision',
      reason: `Provisioned tenant '${request.name}' with DNA '${request.dnaProfileId}' and plan '${request.planTier}'.`,
      metadata: {
        adminEmail: request.adminEmail,
        channelPlan: request.channelPlan,
        brainSupplyMode: request.brainSupplyMode,
        quotas: request.quotas,
      },
      createdAt: now,
    });

    // 7. Mould Initial Roster Manifest (§4, §23)
    const dnaService = new BusinessDnaService();
    const manifest = await dnaService.mouldAndSaveManifest(
      tenantId,
      request.dnaProfileId || 'dna_retail_commerce',
      operatorId,
      {
        autonomyCeiling: request.autonomyCeiling,
      }
    );

    return {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      status: tenant.status,
      tenant,
      organizationId: orgId,
      workspaceId: wsId,
      adminUserId,
      adminEmail: request.adminEmail.toLowerCase().trim(),
      generatedAdminPassword: generatedPassword,
      manifest,
    };
  }

  /**
   * Operator Elevation into a Tenant (§2, §17.6).
   * Creates a time-boxed, reason-tagged elevation session and logs to tenant's security audit trail.
   */
  public async elevateIntoTenant(
    tenantId: string,
    request: ElevateSessionRequest,
    operator: { userId: string; email: string; fullName?: string }
  ): Promise<{ token: string; session: TenantElevationRecord; tenant: TenantRecord }> {
    const tenant = await this.tenantRepo.findById(tenantId);
    if (!tenant) {
      throw new Error(`Tenant '${tenantId}' not found.`);
    }

    // 1. Create Elevation Session in Database
    const session = await this.tenantRepo.createElevationSession({
      tenantId,
      operatorId: operator.userId,
      operatorName: operator.fullName || operator.email,
      reason: request.reason,
      durationMinutes: request.durationMinutes,
    });

    // 2. Issue Elevated JWT for Target Tenant
    const token = JwtService.sign({
      userId: operator.userId,
      email: operator.email,
      tenantId,
      organizationId: 'default',
      roles: ['admin', 'operator', 'system'],
      isElevatedOperator: true,
      elevationReason: request.reason,
      elevatedUntil: session.expires_at,
    });

    // 3. Log to Target Tenant's Security Audit Trail (Surfaced in Tenant Security View)
    await TenantContextManager.withTenant(tenantId, 'default', async () => {
      await auditLogger.logEvent({
        action: 'tenant.operator_elevated',
        resourceType: 'tenant',
        resourceId: tenantId,
        details: {
          operatorId: operator.userId,
          operatorEmail: operator.email,
          reason: request.reason,
          durationMinutes: request.durationMinutes,
          startsAt: session.starts_at,
          expiresAt: session.expires_at,
          sessionId: session.id,
        },
      });
    }, { userId: operator.userId, roles: ['system', 'operator'] });

    // 4. Log Operator Audit Log
    await this.repo.logOperatorAction({
      id: `opl_${CryptoUtils.generateId()}`,
      operatorId: operator.userId,
      targetTenantId: tenantId,
      actionType: 'tenant_elevate',
      reason: request.reason,
      metadata: {
        durationMinutes: request.durationMinutes,
        expiresAt: session.expires_at,
        sessionId: session.id,
      },
      createdAt: session.starts_at,
    });

    return { token, session, tenant };
  }

  /**
   * Revokes an active operator elevation session.
   */
  public async revokeElevation(
    tenantId: string,
    sessionId: string,
    operatorId: string
  ): Promise<void> {
    await this.tenantRepo.revokeElevationSession(sessionId);

    const now = new Date().toISOString();
    await TenantContextManager.withTenant(tenantId, 'default', async () => {
      await auditLogger.logEvent({
        action: 'tenant.operator_elevation_revoked',
        resourceType: 'tenant',
        resourceId: tenantId,
        details: { operatorId, sessionId, revokedAt: now },
      });
    }, { userId: operatorId, roles: ['system', 'operator'] });

    await this.repo.logOperatorAction({
      id: `opl_${CryptoUtils.generateId()}`,
      operatorId,
      targetTenantId: tenantId,
      actionType: 'tenant_elevation_revoke',
      reason: `Elevation session '${sessionId}' revoked.`,
      metadata: { sessionId },
      createdAt: now,
    });
  }

  /**
   * Retrieves active elevation session for a tenant if any.
   */
  public async getActiveElevation(tenantId: string): Promise<TenantElevationRecord | null> {
    return this.tenantRepo.getActiveElevationSession(tenantId);
  }

  /**
   * Updates tenant lifecycle status (§2, §17.1).
   */
  public async updateTenantStatus(
    tenantId: string,
    request: UpdateTenantStatusRequest,
    operatorId: string
  ): Promise<void> {
    const target = await this.tenantRepo.findById(tenantId);
    if (!target || isPlatformTenantSlug(target.slug)) {
      throw new NotFoundError(`Tenant '${tenantId}' not found.`);
    }

    const currentStatus = target.status as TenantLifecycleStatus;
    const isValid = TenantLifecycleEngine.validateTransition(currentStatus, request.status as any);
    if (!isValid) {
      throw new ConflictError(`Invalid tenant status transition from '${currentStatus}' to '${request.status}'.`);
    }

    await this.tenantRepo.updateStatus(tenantId, request.status);

    const now = new Date().toISOString();
    let actionType: any = 'tenant_suspend';
    if (request.status === 'active') actionType = 'tenant_reactivate';
    if (request.status === 'disabled') actionType = 'tenant_delete';

    // Log to Cryptographic Audit Ledger
    await TenantContextManager.withTenant(tenantId, 'default', async () => {
      await auditLogger.logEvent({
        action: `tenant.${actionType}`,
        resourceType: 'tenant',
        resourceId: tenantId,
        details: { previousStatus: currentStatus, newStatus: request.status, reason: request.reason, operatorId },
      });
    }, { userId: operatorId, roles: ['system', 'operator'] });

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

  /**
   * Lists Organizations Roster sorted worst-first (§17.1).
   */
  public async listOrganizationsRoster(): Promise<OrganizationRosterItem[]> {
    const tenants = (await this.tenantRepo.listAll()).filter((t) => !isPlatformTenantSlug(t.slug));
    const items: OrganizationRosterItem[] = [];
    // ponytail: a handful of count queries per tenant; switch to grouped queries past a few hundred tenants.
    for (const t of tenants) {
      const stats = await this.tenantStats(t.id);
      const quotaBudgetInr = Number(parseQuotas(t.quotas_json).monthly_budget_inr ?? 0);
      const spendRatioPct = quotaBudgetInr > 0 ? Math.round((stats.spendInrMonth / quotaBudgetInr) * 100) : 0;

      let computedStatus = t.status as OrganizationRosterItem['status'];
      if (t.status === 'active' && ((stats.errorRatePct ?? 0) > 5.0 || stats.attentionCount > 5)) {
        computedStatus = 'degraded';
      }

      const activeElevation = await this.tenantRepo.getActiveElevationSession(t.id);
      items.push({
        id: t.id,
        name: t.name,
        slug: t.slug,
        status: computedStatus,
        planTier: t.plan_tier,
        channelPlan: t.channel_plan,
        brainSupplyMode: (t.brain_supply_mode as any) || 'byo',
        agentCount: stats.agentCount,
        userCount: stats.userCount,
        executions24h: stats.runs24h,
        errorRatePct: stats.errorRatePct,
        spendInr: stats.spendInrMonth,
        quotaBudgetInr,
        spendRatioPct,
        attentionCount: stats.attentionCount,
        lastActivityAt: stats.lastActivityAt,
        activeElevation: activeElevation
          ? {
              operatorId: activeElevation.operator_id,
              operatorName: activeElevation.operator_name,
              reason: activeElevation.reason,
              expiresAt: activeElevation.expires_at,
            }
          : null,
        createdAt: t.created_at,
        updatedAt: t.updated_at,
      });
    }

    // Sort: worst first (§17.1): degraded -> suspended -> live -> deleted (disabled)
    const statusPriority: Record<string, number> = { degraded: 0, suspended: 1, active: 2, disabled: 3 };
    return items.sort((a, b) => {
      const pA = statusPriority[a.status] ?? 2;
      const pB = statusPriority[b.status] ?? 2;
      if (pA !== pB) return pA - pB;
      return b.attentionCount - a.attentionCount;
    });
  }

  /**
   * Measured per-tenant activity. Every figure is a count/sum over the tenant's own rows;
   * errorRatePct is null when there were no runs (no fabricated baseline, S53).
   */
  private async tenantStats(tenantId: string) {
    const client = db.getClient();
    const now = new Date();
    const since24h = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
    const num = async (sql: string, params: unknown[]) =>
      Number((await client.queryOne<{ n: number | string | null }>(sql, params))?.n ?? 0);

    const runs24h = await num('SELECT count(*) AS n FROM graph_runs WHERE tenant_id = ? AND created_at >= ?;', [tenantId, since24h]);
    const failed24h = await num(
      "SELECT count(*) AS n FROM graph_runs WHERE tenant_id = ? AND created_at >= ? AND status = 'failed';",
      [tenantId, since24h]
    );
    const spendUsdMonth = await num(
      'SELECT coalesce(sum(total_cost_usd), 0) AS n FROM cost_attribution_records WHERE tenant_id = ? AND created_at >= ?;',
      [tenantId, monthStart]
    );
    const last = await client.queryOne<{ at: string | null }>(
      'SELECT max(created_at) AS at FROM audit_logs WHERE tenant_id = ?;',
      [tenantId]
    );

    return {
      agentCount: await num('SELECT count(*) AS n FROM agents WHERE tenant_id = ?;', [tenantId]),
      userCount: await num('SELECT count(*) AS n FROM users WHERE tenant_id = ?;', [tenantId]),
      attentionCount: await num(
        "SELECT count(*) AS n FROM attention_items WHERE tenant_id = ? AND status = 'pending';",
        [tenantId]
      ),
      runs24h,
      failed24h,
      errorRatePct: runs24h > 0 ? Math.round((failed24h / runs24h) * 1000) / 10 : null,
      spendUsdMonth,
      spendInrMonth: Math.round(spendUsdMonth * USD_TO_INR_RATE * 100) / 100,
      lastActivityAt: last?.at ?? null,
    };
  }

  /**
   * Owner-console drill-down for one client: profile, users (no credentials), measured stats,
   * recent runs, and the tenant's own audit trail — i.e. "what is this client doing".
   */
  public async getTenantActivity(tenantId: string, limit = 50) {
    const tenant = await this.tenantRepo.findById(tenantId);
    if (!tenant || isPlatformTenantSlug(tenant.slug)) {
      throw new NotFoundError(`Tenant '${tenantId}' not found.`);
    }
    const client = db.getClient();
    const cap = Math.min(Math.max(Number.isFinite(limit) ? limit : 50, 1), 200);

    const users = await client.query<Record<string, unknown>>(
      `SELECT u.id, u.email, u.full_name AS "fullName", u.status, u.created_at AS "createdAt",
              (SELECT max(a.created_at) FROM audit_logs a
                 WHERE a.tenant_id = u.tenant_id AND a.user_id = u.id AND a.action = 'user.login') AS "lastLoginAt"
         FROM users u WHERE u.tenant_id = ? ORDER BY u.created_at ASC;`,
      [tenantId]
    );
    for (const u of users) {
      const roles = await client.query<{ name: string }>(
        'SELECT r.name FROM roles r INNER JOIN user_roles ur ON ur.role_id = r.id WHERE ur.user_id = ? AND ur.tenant_id = ?;',
        [u.id, tenantId]
      );
      u.roles = roles.map((r) => r.name);
    }

    const recentRuns = await client.query(
      `SELECT id, graph_id AS "graphId", status, outcome, park_reason AS "parkReason",
              error_message AS "errorMessage", step_count AS "stepCount", created_at AS "createdAt", updated_at AS "updatedAt"
         FROM graph_runs WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 20;`,
      [tenantId]
    );
    const auditTrail = await client.query<Record<string, unknown>>(
      `SELECT id, action, resource_type AS "resourceType", resource_id AS "resourceId", user_id AS "userId",
              details_json AS "detailsJson", created_at AS "createdAt"
         FROM audit_logs WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ?;`,
      [tenantId, cap]
    );

    return {
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        status: tenant.status,
        planTier: tenant.plan_tier,
        channelPlan: tenant.channel_plan,
        industry: tenant.industry,
        region: tenant.region,
        timezone: tenant.timezone,
        quotas: parseQuotas(tenant.quotas_json),
        createdAt: tenant.created_at,
        updatedAt: tenant.updated_at,
      },
      stats: await this.tenantStats(tenantId),
      users,
      recentRuns,
      auditTrail: auditTrail.map(({ detailsJson, ...row }) => ({ ...row, details: safeJson(detailsJson) })),
      operatorActions: (await this.repo.listOperatorLogs(500))
        .filter((l: { targetTenantId?: string }) => l.targetTenantId === tenantId)
        .slice(0, 50),
    };
  }

  public async listAllTenants(): Promise<TenantRecord[]> {
    return this.tenantRepo.listAll();
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

  public async listAllAnnouncements(): Promise<SystemAnnouncement[]> {
    return this.repo.listAnnouncements();
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

function parseQuotas(json: string | null | undefined): { monthly_budget_inr?: number; [k: string]: unknown } {
  try {
    return json ? JSON.parse(json) : {};
  } catch {
    return {};
  }
}

function safeJson(value: unknown): unknown {
  if (typeof value !== 'string') return value ?? {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}
