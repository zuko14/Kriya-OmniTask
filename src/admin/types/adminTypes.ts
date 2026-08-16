/**
 * Xylarc AI — Platform Administration Types & Contracts
 * Operator Control Plane, Tenant Lifecycle, Fleet Health & Node Diagnostics (§10–§14, §24).
 */

import { z } from 'zod';

export const OperatorActionTypeSchema = z.enum([
  'tenant_provision',
  'tenant_suspend',
  'tenant_reactivate',
  'tenant_delete',
  'quota_override',
  'maintenance_mode_toggle',
  'global_announcement_broadcast',
  'emergency_kill_switch',
]);
export type OperatorActionType = z.infer<typeof OperatorActionTypeSchema>;

export const TenantLifecycleStatusSchema = z.enum([
  'active',
  'suspended',
  'pending_deletion',
  'trial',
]);
export type TenantLifecycleStatus = z.infer<typeof TenantLifecycleStatusSchema>;

export const NodeStatusSchema = z.enum(['healthy', 'degraded', 'draining', 'offline']);
export type NodeStatus = z.infer<typeof NodeStatusSchema>;

export const AnnouncementSeveritySchema = z.enum(['info', 'warning', 'critical', 'maintenance']);
export type AnnouncementSeverity = z.infer<typeof AnnouncementSeveritySchema>;

// Tenant Provisioning Schema
export const ProvisionTenantRequestSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  slug: z.string().min(1),
  planTier: z.enum(['starter', 'growth', 'enterprise']).default('growth'),
  channelPlan: z.enum(['single_channel', 'dual_channel', 'omnichannel', 'combined']).default('combined'),
  adminEmail: z.string().email(),
  maxAgents: z.number().int().positive().default(10),
  maxWorkflows: z.number().int().positive().default(50),
});
export type ProvisionTenantRequest = z.infer<typeof ProvisionTenantRequestSchema>;

// Update Tenant Status Schema
export const UpdateTenantStatusRequestSchema = z.object({
  status: TenantLifecycleStatusSchema,
  reason: z.string().min(1),
});
export type UpdateTenantStatusRequest = z.infer<typeof UpdateTenantStatusRequestSchema>;

// Node Fleet Heartbeat Schema
export const NodeHeartbeatRequestSchema = z.object({
  nodeId: z.string().min(1),
  clusterRegion: z.string().min(1),
  status: NodeStatusSchema.default('healthy'),
  cpuUsagePct: z.number().min(0).max(100),
  memoryUsagePct: z.number().min(0).max(100),
  activeWorkerThreads: z.number().int().nonnegative(),
  activeAgentExecutions: z.number().int().nonnegative(),
});
export type NodeHeartbeatRequest = z.infer<typeof NodeHeartbeatRequestSchema>;

// Announcement Schema
export const CreateAnnouncementRequestSchema = z.object({
  title: z.string().min(1),
  message: z.string().min(1),
  severity: AnnouncementSeveritySchema.default('info'),
  targetTenantIds: z.array(z.string()).default(['*']), // '*' for all tenants
  startsAt: z.string().optional(),
  expiresAt: z.string().optional(),
});
export type CreateAnnouncementRequest = z.infer<typeof CreateAnnouncementRequestSchema>;

// Maintenance State Schema
export const UpdateMaintenanceStateRequestSchema = z.object({
  isMaintenanceActive: z.boolean(),
  maintenanceMessage: z.string().optional(),
  readOnlyMode: z.boolean().default(false),
  emergencyKillActive: z.boolean().default(false),
  reason: z.string().min(1),
});
export type UpdateMaintenanceStateRequest = z.infer<typeof UpdateMaintenanceStateRequestSchema>;

// Entities
export interface OperatorAuditLog {
  id: string;
  operatorId: string;
  targetTenantId?: string;
  actionType: OperatorActionType;
  reason: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface NodeFleetRecord {
  id: string;
  nodeId: string;
  clusterRegion: string;
  status: NodeStatus;
  cpuUsagePct: number;
  memoryUsagePct: number;
  activeWorkerThreads: number;
  activeAgentExecutions: number;
  lastHeartbeatAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface SystemAnnouncement {
  id: string;
  title: string;
  message: string;
  severity: AnnouncementSeverity;
  isActive: boolean;
  targetTenantIds: string[];
  startsAt: string;
  expiresAt?: string;
  createdAt: string;
}

export interface PlatformMaintenanceState {
  id: string;
  isMaintenanceActive: boolean;
  maintenanceMessage?: string;
  readOnlyMode: boolean;
  emergencyKillActive: boolean;
  activatedBy?: string;
  activatedAt?: string;
  updatedAt: string;
}

export interface FleetDiagnosticsSummary {
  totalNodes: number;
  onlineNodes: number;
  degradedNodes: number;
  offlineNodes: number;
  avgCpuUsagePct: number;
  avgMemoryUsagePct: number;
  totalActiveThreads: number;
  totalActiveExecutions: number;
  clusterHealth: 'healthy' | 'degraded' | 'critical';
  nodes: NodeFleetRecord[];
}
