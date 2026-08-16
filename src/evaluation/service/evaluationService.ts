/**
 * Xylarc AI — Agent Evaluation Benchmark & Golden Test Suite Service
 * High-level orchestration for dataset management, benchmark execution, and release decision gating (§14, §18 of CLAUDE.md).
 */

import {
  CreateDatasetRequest,
  RunBenchmarkRequest,
  EvaluationDatasetRecord,
  EvaluationBenchmarkRecord,
  GoldenTestCase,
  ReleaseGateVerdict,
} from '../types/evaluationTypes.js';
import { EvaluationRepository } from '../repositories/evaluationRepository.js';
import { BenchmarkRunner } from '../benchmark/benchmarkRunner.js';
import { NotFoundError } from '../../core/errors/errors.js';
import { logger } from '../../core/logger/logger.js';

export class EvaluationService {
  private evalRepo: EvaluationRepository;

  constructor(evalRepo?: EvaluationRepository) {
    this.evalRepo = evalRepo || new EvaluationRepository();
  }

  /**
   * Creates and registers a new golden dataset.
   */
  public async createDataset(request: CreateDatasetRequest): Promise<EvaluationDatasetRecord> {
    return this.evalRepo.createDataset(request);
  }

  /**
   * Retrieves a golden dataset by ID.
   */
  public async getDataset(id: string): Promise<EvaluationDatasetRecord> {
    const dataset = await this.evalRepo.findById(id);
    if (!dataset) throw new NotFoundError(`Evaluation dataset '${id}' not found.`);
    return dataset;
  }

  /**
   * Lists golden datasets matching filters.
   */
  public async listDatasets(filter?: {
    targetAgentId?: string;
    limit?: number;
  }): Promise<EvaluationDatasetRecord[]> {
    return this.evalRepo.listDatasets(filter);
  }

  /**
   * Runs a batch evaluation benchmark against a golden dataset.
   */
  public async runBenchmark(
    datasetId: string,
    request: RunBenchmarkRequest
  ): Promise<EvaluationBenchmarkRecord> {
    const dataset = await this.getDataset(datasetId);
    const testCases: GoldenTestCase[] = JSON.parse(dataset.test_cases_json || '[]');

    const benchmarkReport = await BenchmarkRunner.executeBenchmark({
      testCases,
      modelId: request.modelId,
      promptVersion: request.promptVersion,
    });

    const record = await this.evalRepo.createBenchmark({
      datasetId,
      modelId: request.modelId,
      promptVersion: request.promptVersion,
      status: 'completed',
      verdict: benchmarkReport.verdict,
      totalTestCases: benchmarkReport.totalTestCases,
      passedTestCases: benchmarkReport.passedTestCases,
      failedTestCases: benchmarkReport.failedTestCases,
      passRate: benchmarkReport.passRate,
      avgFaithfulness: benchmarkReport.avgFaithfulness,
      avgLatencyMs: benchmarkReport.avgLatencyMs,
      totalCostUsd: benchmarkReport.totalCostUsd,
      detailedResultsJson: JSON.stringify(benchmarkReport),
    });

    logger.info(
      `[BENCHMARK EVALUATION] Dataset '${dataset.name}' (${datasetId}) finished with verdict '${record.verdict}' (Pass Rate: ${(record.pass_rate * 100).toFixed(1)}%).`
    );

    return record;
  }

  /**
   * Lists benchmark execution runs.
   */
  public async listBenchmarks(filter?: {
    datasetId?: string;
    verdict?: ReleaseGateVerdict;
    limit?: number;
  }): Promise<EvaluationBenchmarkRecord[]> {
    return this.evalRepo.listBenchmarks(filter);
  }

  /**
   * Retrieves a specific benchmark run by ID.
   */
  public async getBenchmark(id: string): Promise<EvaluationBenchmarkRecord> {
    const benchmark = await this.evalRepo.findBenchmarkById(id);
    if (!benchmark) throw new NotFoundError(`Evaluation benchmark '${id}' not found.`);
    return benchmark;
  }
}
