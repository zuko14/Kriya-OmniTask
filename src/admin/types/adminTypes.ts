/**
 * Kriya Omnitask — Platform Administration Types & Contracts
 * Operator Control Plane, Tenant Lifecycle, Enterprise Provisioning & Elevation (§2, §17.1, §17.2, §17.6).
 */

import { z } from 'zod';

export const OperatorActionTypeSchema = z.enum([
  'tenant_provision',
  'tenant_suspend',
  'tenant_reactivate',
  'tenant_delete',
  'tenant_elevate',
  'tenant_elevation_revoke',
  'quota_override',
  'maintenance_mode_toggle',
  'global_announcement_broadcast',
  'emergency_kill_switch',
]);
export type OperatorActionType = z.infer<typeof OperatorActionTypeSchema>;

export const TenantLifecycleStatusSchema = z.enum([
  'active',
  'suspended',
  'degraded',
  'disabled',
  'pending_deletion',
  'trial',
]);
export type TenantLifecycleStatus = z.infer<typeof TenantLifecycleStatusSchema>;

export const NodeStatusSchema = z.enum(['healthy', 'degraded', 'draining', 'offline']);
export type NodeStatus = z.infer<typeof NodeStatusSchema>;

export const AnnouncementSeveritySchema = z.enum(['info', 'warning', 'critical', 'maintenance']);
export type AnnouncementSeverity = z.infer<typeof AnnouncementSeveritySchema>;

// Tenant Provisioning Schema (§2, §17.2)
export const ProvisionTenantRequestSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1, 'Business name is required'),
  slug: z.string().min(1, 'Unique slug is required'),
  industry: z.string().default('general'),
  region: z.string().default('ap-south-1'),
  languages: z.array(z.string()).default(['en', 'hi']),
  timezone: z.string().default('Asia/Kolkata'),
  dnaProfileId: z.string().default('dna_retail_commerce'),
  planTier: z.enum(['starter', 'growth', 'enterprise']).default('growth'),
  channelPlan: z.enum(['whatsapp_only', 'voice_only', 'combined']).default('combined'),
  brainSupplyMode: z.enum(['byo', 'managed']).default('byo'),
  adminEmail: z.string().email(),
  adminFullName: z.string().optional(),
  adminPassword: z.string().optional(),
  quotas: z
    .object({
      max_concurrent_tasks: z.number().int().positive().default(10),
      monthly_budget_inr: z.number().positive().default(10000),
      max_daily_tokens: z.number().positive().default(1000000),
    })
    .default({
      max_concurrent_tasks: 10,
      monthly_budget_inr: 10000,
      max_daily_tokens: 1000000,
    }),
  autonomyCeiling: z.enum(['L1', 'L2', 'L3', 'L4']).default('L2'),
});
export type ProvisionTenantRequest = z.infer<typeof ProvisionTenantRequestSchema>;

// Operator Elevation Request Schema (§17.6)
export const ElevateSessionRequestSchema = z.object({
  reason: z.string().min(5, 'Elevation reason must be at least 5 characters'),
  durationMinutes: z.number().int().min(1).max(240).default(30),
});
export type ElevateSessionRequest = z.infer<typeof ElevateSessionRequestSchema>;

// Update Tenant Status Schema
export const UpdateTenantStatusRequestSchema = z.object({
  status: z.enum(['active', 'suspended', 'degraded', 'disabled']),
  reason: z.string().min(1, 'Reason for status update is required'),
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
  targetTenantIds: z.array(z.string()).default(['*']),
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

// Organizations Roster Item (§17.1)
export interface OrganizationRosterItem {
  id: string;
  name: string;
  slug: string;
  status: 'active' | 'suspended' | 'degraded' | 'disabled';
  planTier: string;
  channelPlan: 'whatsapp_only' | 'voice_only' | 'combined';
  brainSupplyMode: 'byo' | 'managed';
  agentCount: number;
  executions24h: number;
  errorRatePct: number;
  spendInr: number;
  quotaBudgetInr: number;
  spendRatioPct: number;
  attentionCount: number;
  activeElevation?: {
    operatorId: string;
    operatorName?: string;
    reason: string;
    expiresAt: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}

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

export interface FleetDiagnosticsSummary {
  totalNodes: number;
  healthyNodes: number;
  onlineNodes?: number;
  degradedNodes: number;
  drainingNodes: number;
  offlineNodes: number;
  avgCpuUsagePct: number;
  avgMemoryUsagePct: number;
  totalActiveExecutions: number;
  totalActiveThreads: number;
  generatedAt: string;
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
