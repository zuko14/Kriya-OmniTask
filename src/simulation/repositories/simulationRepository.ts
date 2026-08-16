/**
 * Xylarc AI — Simulation Scenarios & Runs Relational Repository
 * Persistence for sandbox test scenarios and execution runs (§14, §17 of CLAUDE.md).
 */

import { BaseRepository } from '../../storage/repositories/baseRepository.js';
import { DatabaseClient } from '../../storage/db.js';
import {
  SimulationScenarioRecord,
  SimulationRunRecord,
  CreateScenarioRequest,
  ScenarioCategory,
  SimulationRunMode,
  SimulationRunStatus,
} from '../types/simulationTypes.js';
import { CryptoUtils } from '../../core/utils/crypto.js';

export class SimulationRepository extends BaseRepository<SimulationScenarioRecord> {
  protected readonly tableName = 'simulation_scenarios';

  constructor(client?: DatabaseClient) {
    super(client);
  }

  /**
   * Persists a new simulation scenario.
   */
  public async createScenario(request: CreateScenarioRequest): Promise<SimulationScenarioRecord> {
    const tenantId = this.getTenantId();
    const id = CryptoUtils.generateId();
    const now = new Date().toISOString();

    const record: SimulationScenarioRecord = {
      id,
      tenant_id: tenantId,
      organization_id: 'default',
      name: request.name,
      description: request.description,
      category: request.category,
      target_agent_id: request.targetAgentId,
      mock_customer_json: JSON.stringify(request.mockCustomer || {}),
      initial_message: request.initialMessage,
      conversation_history_json: JSON.stringify(request.conversationHistory || []),
      mock_tool_responses_json: JSON.stringify(request.mockToolResponses || {}),
      expected_outcomes_json: JSON.stringify(request.expectedOutcomes || {}),
      created_at: now,
      updated_at: now,
    };

    await this.client.execute(
      `INSERT INTO simulation_scenarios (
        id, tenant_id, organization_id, name, description, category,
        target_agent_id, mock_customer_json, initial_message,
        conversation_history_json, mock_tool_responses_json,
        expected_outcomes_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        record.id,
        record.tenant_id,
        record.organization_id,
        record.name,
        record.description,
        record.category,
        record.target_agent_id,
        record.mock_customer_json,
        record.initial_message,
        record.conversation_history_json,
        record.mock_tool_responses_json,
        record.expected_outcomes_json,
        record.created_at,
        record.updated_at,
      ]
    );

    return record;
  }

  /**
   * Records a completed simulation run in the database.
   */
  public async createRun(params: {
    scenarioId: string;
    runMode: SimulationRunMode;
    status: SimulationRunStatus;
    simulatedOutput: string;
    simulatedToolCallsJson: string;
    policyVerdictsJson: string;
    comparisonReportJson: string;
    latencyMs: number;
    tokensUsed: number;
    costUsd: number;
  }): Promise<SimulationRunRecord> {
    const tenantId = this.getTenantId();
    const id = CryptoUtils.generateId();
    const now = new Date().toISOString();

    const record: SimulationRunRecord = {
      id,
      tenant_id: tenantId,
      organization_id: 'default',
      scenario_id: params.scenarioId,
      run_mode: params.runMode,
      status: params.status,
      simulated_output: params.simulatedOutput,
      simulated_tool_calls_json: params.simulatedToolCallsJson,
      policy_verdicts_json: params.policyVerdictsJson,
      comparison_report_json: params.comparisonReportJson,
      latency_ms: params.latencyMs,
      tokens_used: params.tokensUsed,
      cost_usd: params.costUsd,
      started_at: now,
      completed_at: now,
      created_at: now,
      updated_at: now,
    };

    await this.client.execute(
      `INSERT INTO simulation_runs (
        id, tenant_id, organization_id, scenario_id, run_mode, status,
        simulated_output, simulated_tool_calls_json, policy_verdicts_json,
        comparison_report_json, latency_ms, tokens_used, cost_usd,
        started_at, completed_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        record.id,
        record.tenant_id,
        record.organization_id,
        record.scenario_id,
        record.run_mode,
        record.status,
        record.simulated_output,
        record.simulated_tool_calls_json,
        record.policy_verdicts_json,
        record.comparison_report_json,
        record.latency_ms,
        record.tokens_used,
        record.cost_usd,
        record.started_at,
        record.completed_at,
        record.created_at,
        record.updated_at,
      ]
    );

    return record;
  }

  /**
   * Lists scenarios with optional filtering.
   */
  public async listScenarios(filter?: {
    category?: ScenarioCategory;
    targetAgentId?: string;
    limit?: number;
  }): Promise<SimulationScenarioRecord[]> {
    const tenantId = this.getTenantId();
    let sql = 'SELECT * FROM simulation_scenarios WHERE tenant_id = ?';
    const params: unknown[] = [tenantId];

    if (filter?.category) {
      sql += ' AND category = ?';
      params.push(filter.category);
    }
    if (filter?.targetAgentId) {
      sql += ' AND target_agent_id = ?';
      params.push(filter.targetAgentId);
    }

    sql += ' ORDER BY created_at DESC LIMIT ?;';
    params.push(filter?.limit || 50);

    return this.client.query<SimulationScenarioRecord>(sql, params);
  }

  /**
   * Lists simulation execution runs.
   */
  public async listRuns(filter?: {
    scenarioId?: string;
    status?: SimulationRunStatus;
    limit?: number;
  }): Promise<SimulationRunRecord[]> {
    const tenantId = this.getTenantId();
    let sql = 'SELECT * FROM simulation_runs WHERE tenant_id = ?';
    const params: unknown[] = [tenantId];

    if (filter?.scenarioId) {
      sql += ' AND scenario_id = ?';
      params.push(filter.scenarioId);
    }
    if (filter?.status) {
      sql += ' AND status = ?';
      params.push(filter.status);
    }

    sql += ' ORDER BY started_at DESC LIMIT ?;';
    params.push(filter?.limit || 50);

    return this.client.query<SimulationRunRecord>(sql, params);
  }

  /**
   * Retrieves a specific simulation run by ID.
   */
  public async findRunById(runId: string): Promise<SimulationRunRecord | null> {
    const tenantId = this.getTenantId();
    const rows = await this.client.query<SimulationRunRecord>(
      'SELECT * FROM simulation_runs WHERE id = ? AND tenant_id = ? LIMIT 1;',
      [runId, tenantId]
    );
    return rows.length > 0 ? rows[0] : null;
  }
}
