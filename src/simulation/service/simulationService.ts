/**
 * Kriya AI — Agent Simulation & Dry-Run Sandbox Controller Service
 * High-level orchestration for scenario configuration, virtual dry-run execution, and regression reporting (§14, §17 of CLAUDE.md).
 */

import {
  CreateScenarioRequest,
  RunScenarioRequest,
  SimulationScenarioRecord,
  SimulationRunRecord,
  ScenarioCategory,
  SimulationRunStatus,
} from '../types/simulationTypes.js';
import { SimulationRepository } from '../repositories/simulationRepository.js';
import { DryRunSandbox } from '../sandbox/dryRunSandbox.js';
import { NotFoundError } from '../../core/errors/errors.js';
import { logger } from '../../core/logger/logger.js';

export class SimulationService {
  private simRepo: SimulationRepository;

  constructor(simRepo?: SimulationRepository) {
    this.simRepo = simRepo || new SimulationRepository();
  }

  /**
   * Creates a new simulation scenario.
   */
  public async createScenario(request: CreateScenarioRequest): Promise<SimulationScenarioRecord> {
    return this.simRepo.createScenario(request);
  }

  /**
   * Retrieves a simulation scenario by ID.
   */
  public async getScenario(id: string): Promise<SimulationScenarioRecord> {
    const scenario = await this.simRepo.findById(id);
    if (!scenario) throw new NotFoundError(`Simulation scenario '${id}' not found.`);
    return scenario;
  }

  /**
   * Lists scenarios matching query filters.
   */
  public async listScenarios(filter?: {
    category?: ScenarioCategory;
    targetAgentId?: string;
    limit?: number;
  }): Promise<SimulationScenarioRecord[]> {
    return this.simRepo.listScenarios(filter);
  }

  /**
   * Executes a scenario in the dry-run sandbox without production side effects.
   */
  public async runScenario(
    scenarioId: string,
    request: RunScenarioRequest
  ): Promise<SimulationRunRecord> {
    const scenario = await this.getScenario(scenarioId);

    const sandboxResult = await DryRunSandbox.execute({
      scenario,
      overridePrompt: request.overridePrompt,
      overrideModelId: request.overrideModelId,
    });

    const run = await this.simRepo.createRun({
      scenarioId,
      runMode: request.runMode,
      status: sandboxResult.comparisonReport.overallResult,
      simulatedOutput: sandboxResult.simulatedOutput,
      simulatedToolCallsJson: JSON.stringify(sandboxResult.simulatedToolCalls),
      policyVerdictsJson: JSON.stringify(sandboxResult.policyVerdicts),
      comparisonReportJson: JSON.stringify(sandboxResult.comparisonReport),
      latencyMs: sandboxResult.latencyMs,
      tokensUsed: sandboxResult.tokensUsed,
      costUsd: sandboxResult.costUsd,
    });

    if (run.status === 'regression_detected' || run.status === 'failed') {
      logger.warn(
        `[SIMULATION REGRESSION] Scenario '${scenario.name}' (${scenarioId}) resulted in '${run.status}': ${sandboxResult.comparisonReport.failureDetails.join('; ')}`
      );
    }

    return run;
  }

  /**
   * Lists simulation runs.
   */
  public async listRuns(filter?: {
    scenarioId?: string;
    status?: SimulationRunStatus;
    limit?: number;
  }): Promise<SimulationRunRecord[]> {
    return this.simRepo.listRuns(filter);
  }

  /**
   * Retrieves an individual simulation run by ID.
   */
  public async getRun(runId: string): Promise<SimulationRunRecord> {
    const run = await this.simRepo.findRunById(runId);
    if (!run) throw new NotFoundError(`Simulation run '${runId}' not found.`);
    return run;
  }
}
