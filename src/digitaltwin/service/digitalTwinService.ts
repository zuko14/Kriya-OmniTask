/**
 * Xylarc AI — Business Digital Twin Controller Service
 * High-level orchestration service for organizational graphs, KPI evaluations, and operational bottleneck diagnostics (§13-§15 of CLAUDE.md).
 */

import {
  CreateEntityRequest,
  CreateRelationshipRequest,
  CreateKpiRequest,
  DigitalTwinEntityRecord,
  DigitalTwinRelationshipRecord,
  OrganizationKpiRecord,
  OperationalBottleneckRecord,
  OrganizationGraphView,
} from '../types/digitalTwinTypes.js';
import { DigitalTwinRepository } from '../repositories/digitalTwinRepository.js';
import { KpiRepository } from '../repositories/kpiRepository.js';
import { OrganizationGraph } from '../graph/organizationGraph.js';
import { KpiEngine, KpiEvaluationResult } from '../kpi/kpiEngine.js';
import {
  BottleneckDetector,
  FunnelMetricsInput,
  SupportMetricsInput,
} from '../diagnostics/bottleneckDetector.js';
import { NotFoundError } from '../../core/errors/errors.js';
import { logger } from '../../core/logger/logger.js';

export class DigitalTwinService {
  private twinRepo: DigitalTwinRepository;
  private kpiRepo: KpiRepository;

  constructor(dependencies?: {
    twinRepo?: DigitalTwinRepository;
    kpiRepo?: KpiRepository;
  }) {
    this.twinRepo = dependencies?.twinRepo || new DigitalTwinRepository();
    this.kpiRepo = dependencies?.kpiRepo || new KpiRepository();
  }

  /**
   * Creates an organizational entity (Department, Location, Product, Service).
   */
  public async createEntity(data: CreateEntityRequest): Promise<DigitalTwinEntityRecord> {
    return this.twinRepo.createEntity(data);
  }

  /**
   * Creates a relationship between entities.
   */
  public async createRelationship(data: CreateRelationshipRequest): Promise<DigitalTwinRelationshipRecord> {
    const source = await this.twinRepo.findById(data.sourceEntityId);
    const target = await this.twinRepo.findById(data.targetEntityId);

    if (!source) throw new NotFoundError(`Source entity '${data.sourceEntityId}' not found.`);
    if (!target) throw new NotFoundError(`Target entity '${data.targetEntityId}' not found.`);

    return this.twinRepo.createRelationship(data);
  }

  /**
   * Builds and returns the complete Organizational Graph View for visualization and routing.
   */
  public async getOrganizationGraph(): Promise<OrganizationGraphView> {
    const entities = await this.twinRepo.listEntities();
    const relationships = await this.twinRepo.listRelationships();

    const graph = new OrganizationGraph(entities, relationships);
    return graph.toGraphView();
  }

  /**
   * Defines or updates an organization KPI.
   */
  public async recordKpi(data: CreateKpiRequest): Promise<OrganizationKpiRecord> {
    const { status } = KpiEngine.evaluateStatus(
      data.kpiKey,
      data.targetValue,
      data.actualValue ?? 0
    );

    return this.kpiRepo.createOrUpdateKpi({
      ...data,
      status,
    });
  }

  /**
   * Lists all organization KPIs with real-time evaluated summaries.
   */
  public async listEvaluatedKpis(): Promise<{
    kpis: OrganizationKpiRecord[];
    evaluations: KpiEvaluationResult[];
    healthOverview: { onTrack: number; atRisk: number; critical: number; exceeded: number };
  }> {
    const kpis = await this.kpiRepo.listKpis();
    const evaluations = kpis.map((k) => KpiEngine.evaluate(k));

    const healthOverview = {
      onTrack: evaluations.filter((e) => e.status === 'on_track').length,
      atRisk: evaluations.filter((e) => e.status === 'at_risk').length,
      critical: evaluations.filter((e) => e.status === 'critical').length,
      exceeded: evaluations.filter((e) => e.status === 'exceeded').length,
    };

    return { kpis, evaluations, healthOverview };
  }

  /**
   * Executes diagnostic scan across funnel and support operations, persisting any detected bottlenecks.
   */
  public async runDiagnostics(params: {
    funnel?: FunnelMetricsInput;
    support?: SupportMetricsInput;
  }): Promise<OperationalBottleneckRecord[]> {
    const candidates = [];

    if (params.funnel) {
      candidates.push(...BottleneckDetector.diagnoseFunnel(params.funnel));
    }
    if (params.support) {
      candidates.push(...BottleneckDetector.diagnoseSupportOperations(params.support));
    }

    const recorded: OperationalBottleneckRecord[] = [];
    for (const candidate of candidates) {
      const record = await this.kpiRepo.recordBottleneck(candidate);
      recorded.push(record);
    }

    logger.info(`Operational diagnostic scan completed. Detected ${recorded.length} active bottlenecks.`);
    return recorded;
  }

  /**
   * Lists all active operational bottlenecks.
   */
  public async listBottlenecks(): Promise<OperationalBottleneckRecord[]> {
    return this.kpiRepo.listBottlenecks();
  }

  /**
   * Bootstraps standard organization departments and baseline KPIs for a tenant.
   */
  public async bootstrapStandardTwin(): Promise<{
    departmentsCreated: number;
    kpisCreated: number;
  }> {
    const sales = await this.createEntity({
      entityType: 'department',
      name: 'Commercial & Sales Operations',
      slug: 'sales-ops',
      description: 'Inbound lead qualification, demo scheduling, and customer acquisition.',
    });

    const support = await this.createEntity({
      entityType: 'department',
      name: 'Customer Support & Retention',
      slug: 'customer-support',
      description: 'Tier-1 automated triage, resolution, and churn prevention.',
    });

    // Create KPI: Lead Conversion Rate
    await this.recordKpi({
      kpiName: 'Lead-to-Opportunity Conversion Rate',
      kpiKey: 'lead_conversion_rate',
      category: 'growth',
      targetValue: 35.0,
      actualValue: 28.5,
      unit: 'percent',
      timeframe: 'monthly',
    });

    // Create KPI: Support First Response SLA
    await this.recordKpi({
      kpiName: 'First Response Time SLA',
      kpiKey: 'avg_response_time_seconds',
      category: 'customer_experience',
      targetValue: 60.0, // 60 seconds
      actualValue: 45.0,
      unit: 'seconds',
      timeframe: 'daily',
    });

    return { departmentsCreated: 2, kpisCreated: 2 };
  }
}
