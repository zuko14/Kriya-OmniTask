/**
 * Xylarc AI — Hallucination & Agent Drift Detector
 * Evaluates fact grounding, tool invocation loops, and latency/cost spikes (§14, §16 of CLAUDE.md).
 */

import {
  ExecutionSpanRecord,
  DriftDetectionResult,
} from '../types/observabilityTypes.js';

export class DriftDetector {
  /**
   * Evaluates fact grounding score between model output and authoritative retrieved evidence context.
   */
  public static evaluateGrounding(
    modelOutput: string,
    retrievedEvidence: string[]
  ): number {
    if (!modelOutput || modelOutput.trim().length === 0) return 1.0;
    if (!retrievedEvidence || retrievedEvidence.length === 0) return 1.0;

    const normalize = (text: string): Set<string> => {
      return new Set(
        text
          .toLowerCase()
          .replace(/[^\w\s]/g, '')
          .split(/\s+/)
          .filter((t) => t.length > 3)
      );
    };

    const outputTokens = normalize(modelOutput);
    if (outputTokens.size === 0) return 1.0;

    const evidenceTokens = new Set<string>();
    for (const chunk of retrievedEvidence) {
      const chunkTokens = normalize(chunk);
      for (const t of chunkTokens) evidenceTokens.add(t);
    }

    let matchCount = 0;
    for (const t of outputTokens) {
      if (evidenceTokens.has(t)) {
        matchCount++;
      }
    }

    const score = Math.round((matchCount / outputTokens.size) * 100) / 100;
    return Math.min(Math.max(score, 0.0), 1.0);
  }

  /**
   * Scans execution spans and output metrics for anomalies, tool loops, cost blowups, or ungrounded facts.
   */
  public static detectDrift(params: {
    spans: ExecutionSpanRecord[];
    totalTokens: number;
    totalLatencyMs: number;
    groundingScore?: number;
  }): DriftDetectionResult {
    const reasons: string[] = [];
    let toolLoopCount = 0;

    // 1. Tool Loop Anomaly Check
    const toolSpans = params.spans.filter((s) => s.step_type === 'tool_execution' && s.tool_name);
    const toolCallCounts: Record<string, number> = {};
    for (const span of toolSpans) {
      const name = span.tool_name!;
      toolCallCounts[name] = (toolCallCounts[name] || 0) + 1;
      if (toolCallCounts[name] >= 4) {
        toolLoopCount = toolCallCounts[name];
        reasons.push(`Anomalous tool repetition loop detected on tool '${name}' (${toolLoopCount} invocations).`);
      }
    }

    // 2. Cost / Token Blowup Check (> 8,000 tokens)
    if (params.totalTokens > 8000) {
      reasons.push(`Token consumption drift: Interaction consumed ${params.totalTokens} tokens (threshold: 8,000).`);
    }

    // 3. Latency Spike Check (> 15,000 ms)
    if (params.totalLatencyMs > 15000) {
      reasons.push(`Execution latency drift: Interaction took ${params.totalLatencyMs}ms (threshold: 15,000ms).`);
    }

    // 4. Low Fact Grounding Check (< 0.50)
    const groundingScore = params.groundingScore !== undefined ? params.groundingScore : 1.0;
    if (groundingScore < 0.50) {
      reasons.push(`Low fact grounding score (${Math.round(groundingScore * 100)}%): output diverged from retrieved evidence.`);
    }

    // 5. Failed Step Ratio
    const errorSpans = params.spans.filter((s) => s.status === 'error');
    if (errorSpans.length >= 2) {
      reasons.push(`Multiple sub-step failures observed (${errorSpans.length} failed spans).`);
    }

    return {
      driftDetected: reasons.length > 0,
      groundingScore,
      reasons,
      toolLoopCount,
    };
  }
}
