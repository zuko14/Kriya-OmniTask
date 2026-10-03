/**
 * Kriya AI — Behavioral Comparison & Regression Evaluator
 * Evaluates simulated sandbox runs against expected scenario outcomes (§14, §17 of CLAUDE.md).
 */

import {
  ExpectedOutcomes,
  SimulatedToolCall,
  ComparisonReport,
  SimulationRunStatus,
} from '../types/simulationTypes.js';

export class BehavioralComparator {
  /**
   * Compares simulated output, tool invocations, and policy verdicts against expected outcomes.
   */
  public static evaluateRun(params: {
    simulatedOutput: string;
    toolCalls: SimulatedToolCall[];
    policyVerdict?: string;
    expectedOutcomes: ExpectedOutcomes;
    latencyMs: number;
    tokensUsed: number;
    costUsd: number;
  }): ComparisonReport {
    const {
      simulatedOutput,
      toolCalls,
      policyVerdict,
      expectedOutcomes,
      latencyMs,
      tokensUsed,
      costUsd,
    } = params;

    let checksPassed = 0;
    let checksFailed = 0;
    const failureDetails: string[] = [];

    const invokedTools = new Set(toolCalls.map((t) => t.toolName));

    // 1. Check Expected Tools
    let toolSequenceMatch = true;
    if (expectedOutcomes.expectedToolsCalled && expectedOutcomes.expectedToolsCalled.length > 0) {
      for (const tool of expectedOutcomes.expectedToolsCalled) {
        if (invokedTools.has(tool)) {
          checksPassed++;
        } else {
          checksFailed++;
          toolSequenceMatch = false;
          failureDetails.push(`Expected tool '${tool}' was not invoked by the agent.`);
        }
      }
    }

    // 2. Check Forbidden Tools
    if (expectedOutcomes.forbiddenTools && expectedOutcomes.forbiddenTools.length > 0) {
      for (const tool of expectedOutcomes.forbiddenTools) {
        if (invokedTools.has(tool)) {
          checksFailed++;
          toolSequenceMatch = false;
          failureDetails.push(`Forbidden tool '${tool}' was illegally invoked in simulation.`);
        } else {
          checksPassed++;
        }
      }
    }

    // 3. Check Expected Keywords
    const outputLower = simulatedOutput.toLowerCase();
    if (expectedOutcomes.expectedKeywords && expectedOutcomes.expectedKeywords.length > 0) {
      for (const kw of expectedOutcomes.expectedKeywords) {
        if (outputLower.includes(kw.toLowerCase())) {
          checksPassed++;
        } else {
          checksFailed++;
          failureDetails.push(`Expected keyword '${kw}' was missing in simulated output.`);
        }
      }
    }

    // 4. Check Prohibited Keywords
    if (expectedOutcomes.prohibitedKeywords && expectedOutcomes.prohibitedKeywords.length > 0) {
      for (const kw of expectedOutcomes.prohibitedKeywords) {
        if (outputLower.includes(kw.toLowerCase())) {
          checksFailed++;
          failureDetails.push(`Prohibited keyword '${kw}' was detected in simulated output.`);
        } else {
          checksPassed++;
        }
      }
    }

    // 5. Check Policy Verdict
    let policyComplianceMatch = true;
    if (expectedOutcomes.expectedPolicyVerdict) {
      if (policyVerdict === expectedOutcomes.expectedPolicyVerdict) {
        checksPassed++;
      } else {
        checksFailed++;
        policyComplianceMatch = false;
        failureDetails.push(
          `Policy verdict mismatch: Expected '${expectedOutcomes.expectedPolicyVerdict}', received '${policyVerdict}'.`
        );
      }
    }

    // 6. Check Latency Budget
    let latencyWithinBudget = true;
    if (expectedOutcomes.maxAllowedLatencyMs !== undefined) {
      if (latencyMs <= expectedOutcomes.maxAllowedLatencyMs) {
        checksPassed++;
      } else {
        checksFailed++;
        latencyWithinBudget = false;
        failureDetails.push(
          `Latency budget exceeded: ${latencyMs}ms > max ${expectedOutcomes.maxAllowedLatencyMs}ms.`
        );
      }
    }

    // 7. Check Cost Budget
    let costWithinBudget = true;
    if (expectedOutcomes.maxAllowedCostUsd !== undefined) {
      if (costUsd <= expectedOutcomes.maxAllowedCostUsd) {
        checksPassed++;
      } else {
        checksFailed++;
        costWithinBudget = false;
        failureDetails.push(
          `Cost budget exceeded: $${costUsd} > max $${expectedOutcomes.maxAllowedCostUsd}.`
        );
      }
    }

    let overallResult: SimulationRunStatus = 'passed';
    if (checksFailed > 0) {
      overallResult = failureDetails.some((d) => d.includes('Forbidden') || d.includes('Policy'))
        ? 'regression_detected'
        : 'failed';
    }

    return {
      overallResult,
      checksPassed,
      checksFailed,
      failureDetails,
      toolSequenceMatch,
      policyComplianceMatch,
      latencyWithinBudget,
      costWithinBudget,
      metrics: {
        latencyMs,
        tokensUsed,
        costUsd,
      },
    };
  }
}
