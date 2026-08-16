/**
 * Xylarc AI — Business Digital Twin & Organization KPI Model Type Definitions
 * Typed contracts for Organization Context Graphs, KPI Trees & Operational Diagnostics (§13, §14, §15 of CLAUDE.md).
 */

import { z } from 'zod';
import { BaseEntity } from '../../storage/repositories/baseRepository.js';

export const DigitalTwinEntityTypeEnum = z.enum([
  'department',
  'location',
  'product',
  'service',
  'employee_role',
  'operating_schedule',
  'business_goal',
  'system_integration',
]);

export type DigitalTwinEntityType = z.infer<typeof DigitalTwinEntityTypeEnum>;

export const RelationshipTypeEnum = z.enum([
  'contains',
  'reports_to',
  'operates_in',
  'produces',
  'delivers',
  'governed_by',
  'assigned_to',
  'depends_on',
]);

export type RelationshipType = z.infer<typeof RelationshipTypeEnum>;

export const KpiCategoryEnum = z.enum([
  'financial',
  'operational',
  'customer_experience',
  'agent_workforce',
  'growth',
]);

export type KpiCategory = z.infer<typeof KpiCategoryEnum>;

export const KpiStatusEnum = z.enum([
  'on_track',
  'at_risk',
  'critical',
  'exceeded',
]);

export type KpiStatus = z.infer<typeof KpiStatusEnum>;

export const BottleneckSeverityEnum = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
export type BottleneckSeverity = z.infer<typeof BottleneckSeverityEnum>;

export const BottleneckTypeEnum = z.enum([
  'sla_breach',
  'queue_congestion',
  'capacity_overload',
  'revenue_leak',
  'escalation_spike',
  'churn_cluster',
]);

export type BottleneckType = z.infer<typeof BottleneckTypeEnum>;

// ============================================================================
// Entity & Relationship Request Schemas
// ============================================================================

export const CreateEntityRequestSchema = z.object({
  entityType: DigitalTwinEntityTypeEnum,
  name: z.string().min(1).max(255),
  slug: z.string().min(1).max(255).regex(/^[a-z0-9-_]+$/),
  description: z.string().optional(),
  parentEntityId: z.string().optional(),
  properties: z.record(z.unknown()).default({}),
  status: z.enum(['active', 'inactive', 'deprecated']).default('active'),
});

export type CreateEntityRequest = z.input<typeof CreateEntityRequestSchema>;

export interface DigitalTwinEntityRecord extends BaseEntity {
  organization_id: string;
  entity_type: DigitalTwinEntityType;
  name: string;
  slug: string;
  description?: string;
  parent_entity_id?: string;
  properties_json: string;
  status: 'active' | 'inactive' | 'deprecated';
}

export const CreateRelationshipRequestSchema = z.object({
  sourceEntityId: z.string().min(1),
  targetEntityId: z.string().min(1),
  relationshipType: RelationshipTypeEnum,
  properties: z.record(z.unknown()).default({}),
});

export type CreateRelationshipRequest = z.input<typeof CreateRelationshipRequestSchema>;

export interface DigitalTwinRelationshipRecord extends BaseEntity {
  source_entity_id: string;
  target_entity_id: string;
  relationship_type: RelationshipType;
  properties_json: string;
}

// ============================================================================
// KPI Model Schemas
// ============================================================================

export const CreateKpiRequestSchema = z.object({
  kpiName: z.string().min(1).max(255),
  kpiKey: z.string().min(1).max(100),
  category: KpiCategoryEnum.default('operational'),
  entityId: z.string().optional(),
  targetValue: z.number(),
  actualValue: z.number().default(0.0),
  unit: z.enum(['usd', 'percent', 'count', 'seconds', 'ratio']).default('ratio'),
  timeframe: z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'yearly']).default('monthly'),
  calculationMethod: z.record(z.unknown()).default({}),
});

export type CreateKpiRequest = z.input<typeof CreateKpiRequestSchema>;

export interface OrganizationKpiRecord extends BaseEntity {
  organization_id: string;
  entity_id?: string;
  kpi_name: string;
  kpi_key: string;
  category: KpiCategory;
  target_value: number;
  actual_value: number;
  unit: 'usd' | 'percent' | 'count' | 'seconds' | 'ratio';
  status: KpiStatus;
  timeframe: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';
  calculation_method_json: string;
  last_evaluated_at: string;
}

export interface OperationalBottleneckRecord extends BaseEntity {
  organization_id: string;
  bottleneck_type: BottleneckType;
  entity_id?: string;
  title: string;
  description: string;
  severity: BottleneckSeverity;
  impact_estimate_usd: number;
  recommendation: string;
  status: 'detected' | 'acknowledged' | 'mitigating' | 'resolved';
  detected_at: string;
  resolved_at?: string;
}

// ============================================================================
// Graph Topology Output Schemas
// ============================================================================

export interface OrganizationGraphNode {
  id: string;
  name: string;
  slug: string;
  type: DigitalTwinEntityType;
  parentEntityId?: string;
  properties: Record<string, unknown>;
  status: string;
}

export interface OrganizationGraphEdge {
  id: string;
  source: string;
  target: string;
  type: RelationshipType;
  properties: Record<string, unknown>;
}

export interface OrganizationGraphView {
  nodes: OrganizationGraphNode[];
  edges: OrganizationGraphEdge[];
  rootDepartments: OrganizationGraphNode[];
  totalEntities: number;
  totalRelationships: number;
}
