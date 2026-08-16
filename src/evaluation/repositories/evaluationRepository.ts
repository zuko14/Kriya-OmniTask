/**
 * Xylarc AI — Evaluation Datasets & Benchmarks Relational Repository
 * Persistence for golden datasets and benchmark execution reports (§14, §18 of CLAUDE.md).
 */

import { BaseRepository } from '../../storage/repositories/baseRepository.js';
import { DatabaseClient } from '../../storage/db.js';
import {
  EvaluationDatasetRecord,
  EvaluationBenchmarkRecord,
  CreateDatasetRequest,
  ReleaseGateVerdict,
  BenchmarkStatus,
} from '../types/evaluationTypes.js';
import { CryptoUtils } from '../../core/utils/crypto.js';

export class EvaluationRepository extends BaseRepository<EvaluationDatasetRecord> {
  protected readonly tableName = 'evaluation_datasets';

  constructor(client?: DatabaseClient) {
    super(client);
  }

  /**
   * Creates a new golden dataset record.
   */
  public async createDataset(request: CreateDatasetRequest): Promise<EvaluationDatasetRecord> {
    const tenantId = this.getTenantId();
    const id = CryptoUtils.generateId();
    const now = new Date().toISOString();

    const record: EvaluationDatasetRecord = {
      id,
      tenant_id: tenantId,
      organization_id: 'default',
      name: request.name,
      description: request.description,
      version: request.version,
      target_agent_id: request.targetAgentId,
      test_cases_json: JSON.stringify(request.testCases),
      created_at: now,
      updated_at: now,
    };

    await this.client.execute(
      `INSERT INTO evaluation_datasets (
        id, tenant_id, organization_id, name, description, version,
        target_agent_id, test_cases_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        record.id,
        record.tenant_id,
        record.organization_id,
        record.name,
        record.description,
        record.version,
        record.target_agent_id,
        record.test_cases_json,
        record.created_at,
        record.updated_at,
      ]
    );

    return record;
  }

  /**
   * Persists a completed benchmark execution record.
   */
  public async createBenchmark(params: {
    datasetId: string;
    modelId: string;
    promptVersion: string;
    status: BenchmarkStatus;
    verdict: ReleaseGateVerdict;
    totalTestCases: number;
    passedTestCases: number;
    failedTestCases: number;
    passRate: number;
    avgFaithfulness: number;
    avgLatencyMs: number;
    totalCostUsd: number;
    detailedResultsJson: string;
  }): Promise<EvaluationBenchmarkRecord> {
    const tenantId = this.getTenantId();
    const id = CryptoUtils.generateId();
    const now = new Date().toISOString();

    const record: EvaluationBenchmarkRecord = {
      id,
      tenant_id: tenantId,
      organization_id: 'default',
      dataset_id: params.datasetId,
      model_id: params.modelId,
      prompt_version: params.promptVersion,
      status: params.status,
      verdict: params.verdict,
      total_test_cases: params.totalTestCases,
      passed_test_cases: params.passedTestCases,
      failed_test_cases: params.failedTestCases,
      pass_rate: params.passRate,
      avg_faithfulness: params.avgFaithfulness,
      avg_latency_ms: params.avgLatencyMs,
      total_cost_usd: params.totalCostUsd,
      detailed_results_json: params.detailedResultsJson,
      started_at: now,
      completed_at: now,
      created_at: now,
      updated_at: now,
    };

    await this.client.execute(
      `INSERT INTO evaluation_benchmarks (
        id, tenant_id, organization_id, dataset_id, model_id, prompt_version,
        status, verdict, total_test_cases, passed_test_cases, failed_test_cases,
        pass_rate, avg_faithfulness, avg_latency_ms, total_cost_usd,
        detailed_results_json, started_at, completed_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        record.id,
        record.tenant_id,
        record.organization_id,
        record.dataset_id,
        record.model_id,
        record.prompt_version,
        record.status,
        record.verdict,
        record.total_test_cases,
        record.passed_test_cases,
        record.failed_test_cases,
        record.pass_rate,
        record.avg_faithfulness,
        record.avg_latency_ms,
        record.total_cost_usd,
        record.detailed_results_json,
        record.started_at,
        record.completed_at,
        record.created_at,
        record.updated_at,
      ]
    );

    return record;
  }

  /**
   * Lists datasets with optional agent filter.
   */
  public async listDatasets(filter?: {
    targetAgentId?: string;
    limit?: number;
  }): Promise<EvaluationDatasetRecord[]> {
    const tenantId = this.getTenantId();
    let sql = 'SELECT * FROM evaluation_datasets WHERE tenant_id = ?';
    const params: unknown[] = [tenantId];

    if (filter?.targetAgentId) {
      sql += ' AND target_agent_id = ?';
      params.push(filter.targetAgentId);
    }

    sql += ' ORDER BY created_at DESC LIMIT ?;';
    params.push(filter?.limit || 50);

    return this.client.query<EvaluationDatasetRecord>(sql, params);
  }

  /**
   * Lists benchmark execution runs.
   */
  public async listBenchmarks(filter?: {
    datasetId?: string;
    verdict?: ReleaseGateVerdict;
    limit?: number;
  }): Promise<EvaluationBenchmarkRecord[]> {
    const tenantId = this.getTenantId();
    let sql = 'SELECT * FROM evaluation_benchmarks WHERE tenant_id = ?';
    const params: unknown[] = [tenantId];

    if (filter?.datasetId) {
      sql += ' AND dataset_id = ?';
      params.push(filter.datasetId);
    }
    if (filter?.verdict) {
      sql += ' AND verdict = ?';
      params.push(filter.verdict);
    }

    sql += ' ORDER BY started_at DESC LIMIT ?;';
    params.push(filter?.limit || 50);

    return this.client.query<EvaluationBenchmarkRecord>(sql, params);
  }

  /**
   * Retrieves a specific benchmark run by ID.
   */
  public async findBenchmarkById(id: string): Promise<EvaluationBenchmarkRecord | null> {
    const tenantId = this.getTenantId();
    const rows = await this.client.query<EvaluationBenchmarkRecord>(
      'SELECT * FROM evaluation_benchmarks WHERE id = ? AND tenant_id = ? LIMIT 1;',
      [id, tenantId]
    );
    return rows.length > 0 ? rows[0] : null;
  }
}
