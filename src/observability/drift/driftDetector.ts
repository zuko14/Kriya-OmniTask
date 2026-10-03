/**
 * Kriya AI — Hallucination & Agent Drift Detector
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
  /**
   * S24: Evaluates fact grounding score between model output and authoritative retrieved evidence context
   * using claim-level entity checking, number/currency verification, and paraphrase-tolerant semantic analysis.
   */
  public static evaluateGrounding(
    modelOutput: string,
    retrievedEvidence: string[],
    authoritativeFacts?: Record<string, unknown>
  ): number {
    if (!modelOutput || modelOutput.trim().length === 0) return 1.0;

    const evidenceChunks = [...(retrievedEvidence || [])];
    if (authoritativeFacts && typeof authoritativeFacts === 'object') {
      for (const [k, v] of Object.entries(authoritativeFacts)) {
        if (v !== undefined && v !== null) {
          evidenceChunks.push(`${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`);
        }
      }
    }

    // If no evidence is provided:
    if (evidenceChunks.length === 0) {
      // Check if output makes specific unsupported factual claims (prices, phone numbers, specific entities)
      const hasSpecificFactualClaims = /\b(\$|₹|rs\.?|inr|usd|\d{2,})\b/i.test(modelOutput) ||
        /\b\d{1,2}(:\d{2})?\s*(am|pm)\b/i.test(modelOutput);
      return hasSpecificFactualClaims ? 0.15 : 1.0;
    }

    const fullEvidenceText = evidenceChunks.join(' \n ');
    const evidenceLower = fullEvidenceText.toLowerCase();

    // 1. Extract specific numerical and currency claims from output
    const extractEntities = (text: string): { numbers: string[]; times: string[]; days: string[] } => {
      // Currency + numbers: e.g. "$199", "₹500", "500 rupees", "199", "11:30"
      const numbers: string[] = text.match(/\b\d+(\.\d+)?\b/g) || [];
      const times: string[] = (text.match(/\b\d{1,2}(:\d{2})?\s*(am|pm)\b/gi) || []).map((t) => t.toLowerCase().replace(/\s+/g, ''));
      const days: string[] = (text.match(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?\b/gi) || []).map((d) => d.toLowerCase().replace(/s$/, ''));
      return { numbers, times, days };
    };

    const outputEntities = extractEntities(modelOutput);
    const evidenceEntities = extractEntities(fullEvidenceText);

    let specificClaimsCount = 0;
    let groundedClaimsCount = 0;

    // Verify numbers
    for (const num of outputEntities.numbers) {
      specificClaimsCount++;
      if (evidenceEntities.numbers.includes(num) || fullEvidenceText.includes(num)) {
        groundedClaimsCount++;
      }
    }

    // Verify times
    for (const time of outputEntities.times) {
      specificClaimsCount++;
      const timeRegex = new RegExp(time.replace(/([ap]m)/, '\\s*$1'), 'i');
      if (timeRegex.test(fullEvidenceText) || evidenceEntities.times.includes(time)) {
        groundedClaimsCount++;
      }
    }

    // Verify days of week
    for (const day of outputEntities.days) {
      specificClaimsCount++;
      if (evidenceEntities.days.includes(day) || evidenceLower.includes(day)) {
        groundedClaimsCount++;
      }
    }

    // If output asserts specific numbers/prices that are completely missing from evidence, heavily penalize
    const entityGroundingScore = specificClaimsCount > 0 ? groundedClaimsCount / specificClaimsCount : 1.0;

    // 2. Paraphrase-Tolerant Semantic Token Overlap
    // Filter conversational stop-words, greetings, and generic framing that are not factual claims
    const conversationalStopWords = new Set([
      'hello', 'hi', 'hey', 'greetings', 'welcome', 'please', 'kindly', 'thanks', 'thank', 'you',
      'would', 'could', 'should', 'will', 'glad', 'happy', 'pleasure', 'delighted', 'assist', 'help',
      'feel', 'free', 'reach', 'certainly', 'absolutely', 'note', 'provide', 'available', 'between',
      'through', 'sometime', 'schedule', 'appointment', 'consultation', 'online', 'booking', 'portal',
      'anytime', 'today', 'tomorrow', 'morning', 'evening', 'afternoon', 'hour', 'hours', 'time',
      'team', 'support', 'using', 'service', 'center', 'about', 'have', 'from', 'with', 'this', 'that',
      'there', 'their', 'they', 'what', 'when', 'where', 'which', 'your', 'ours', 'been', 'were',
      'clinic', 'doctor', 'patient', 'visit', 'check', 'operated', 'operates', 'open', 'closed',
    ]);

    const stem = (word: string): string => {
      return word
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .replace(/(ing|tion|tions|ed|es|s)$/, '');
    };

    const normalizeTokens = (text: string): Set<string> => {
      const words = text
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 2 && !conversationalStopWords.has(w));
      return new Set(words.map(stem).filter((s) => s.length > 2));
    };

    const outputTokens = normalizeTokens(modelOutput);
    const evidenceTokens = normalizeTokens(fullEvidenceText);

    let matchCount = 0;
    for (const t of outputTokens) {
      if (evidenceTokens.has(t) || evidenceLower.includes(t)) {
        matchCount++;
      }
    }

    const tokenOverlapScore = outputTokens.size > 0 ? matchCount / outputTokens.size : 1.0;

    // 3. Composite Claim & Grounding Score
    let finalScore: number;
    if (specificClaimsCount > 0) {
      // If specific factual assertions (numbers/times/dates) are made, entity grounding dominates
      finalScore = 0.65 * entityGroundingScore + 0.35 * tokenOverlapScore;
      // If an explicit price or number was completely hallucinated, cap score below passing
      if (entityGroundingScore === 0) {
        finalScore = Math.min(finalScore, 0.30);
      }
    } else {
      // Conversational answer with no numbers: semantic token overlap
      finalScore = tokenOverlapScore;
    }

    const rounded = Math.round(Math.min(Math.max(finalScore, 0.0), 1.0) * 100) / 100;
    return rounded;
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
