import { describe, it, expect } from 'vitest';
import { DriftDetector } from '../../src/observability/drift/driftDetector.js';
import { ExecutionSpanRecord } from '../../src/observability/types/observabilityTypes.js';

describe('Hallucination & Drift Detector Unit Tests', () => {
  it('should compute fact grounding score based on evidence overlap', () => {
    const evidence = [
      'The enterprise subscription pricing is $499 per month with 99.9% uptime guarantee.',
      'Refund requests must be filed within 14 days of purchase.',
    ];

    // High grounding
    const groundedOutput = 'Our enterprise subscription is priced at $499 per month with a 99.9% uptime guarantee.';
    const scoreHigh = DriftDetector.evaluateGrounding(groundedOutput, evidence);
    expect(scoreHigh).toBeGreaterThanOrEqual(0.70);

    // Ungrounded / Divergent output (Hallucination)
    const hallucinatedOutput = 'We offer diamond unlimited lifetime access for cryptocurrency payments with zero refund rights.';
    const scoreLow = DriftDetector.evaluateGrounding(hallucinatedOutput, evidence);
    expect(scoreLow).toBeLessThan(0.40);
  });

  it('should detect tool loop anomalies and telemetry spikes', () => {
    const mockSpans: ExecutionSpanRecord[] = [
      {
        id: 's1',
        trace_id: 'tr_1',
        tenant_id: 'tenant_1',
        span_name: 'Tool Loop 1',
        agent_id: 'support_agent',
        step_type: 'tool_execution',
        tool_name: 'calendar_check_availability',
        status: 'completed',
        latency_ms: 100,
        tokens_input: 0,
        tokens_output: 0,
        cost_usd: 0,
        attributes_json: '{}',
        started_at: '2026-08-15T10:00:00Z',
        ended_at: '2026-08-15T10:00:00Z',
        created_at: '2026-08-15T10:00:00Z',
        updated_at: '2026-08-15T10:00:00Z',
      },
      {
        id: 's2',
        trace_id: 'tr_1',
        tenant_id: 'tenant_1',
        span_name: 'Tool Loop 2',
        agent_id: 'support_agent',
        step_type: 'tool_execution',
        tool_name: 'calendar_check_availability',
        status: 'completed',
        latency_ms: 100,
        tokens_input: 0,
        tokens_output: 0,
        cost_usd: 0,
        attributes_json: '{}',
        started_at: '2026-08-15T10:00:00Z',
        ended_at: '2026-08-15T10:00:00Z',
        created_at: '2026-08-15T10:00:00Z',
        updated_at: '2026-08-15T10:00:00Z',
      },
      {
        id: 's3',
        trace_id: 'tr_1',
        tenant_id: 'tenant_1',
        span_name: 'Tool Loop 3',
        agent_id: 'support_agent',
        step_type: 'tool_execution',
        tool_name: 'calendar_check_availability',
        status: 'completed',
        latency_ms: 100,
        tokens_input: 0,
        tokens_output: 0,
        cost_usd: 0,
        attributes_json: '{}',
        started_at: '2026-08-15T10:00:00Z',
        ended_at: '2026-08-15T10:00:00Z',
        created_at: '2026-08-15T10:00:00Z',
        updated_at: '2026-08-15T10:00:00Z',
      },
      {
        id: 's4',
        trace_id: 'tr_1',
        tenant_id: 'tenant_1',
        span_name: 'Tool Loop 4',
        agent_id: 'support_agent',
        step_type: 'tool_execution',
        tool_name: 'calendar_check_availability',
        status: 'completed',
        latency_ms: 100,
        tokens_input: 0,
        tokens_output: 0,
        cost_usd: 0,
        attributes_json: '{}',
        started_at: '2026-08-15T10:00:00Z',
        ended_at: '2026-08-15T10:00:00Z',
        created_at: '2026-08-15T10:00:00Z',
        updated_at: '2026-08-15T10:00:00Z',
      },
    ];

    const result = DriftDetector.detectDrift({
      spans: mockSpans,
      totalTokens: 9500, // Blowup (> 8k)
      totalLatencyMs: 18000, // Spike (> 15k)
      groundingScore: 0.35, // Low (< 0.50)
    });

    expect(result.driftDetected).toBe(true);
    expect(result.toolLoopCount).toBe(4);
    expect(result.reasons.some((r) => r.includes('Anomalous tool repetition loop'))).toBe(true);
    expect(result.reasons.some((r) => r.includes('Token consumption drift'))).toBe(true);
    expect(result.reasons.some((r) => r.includes('Execution latency drift'))).toBe(true);
    expect(result.reasons.some((r) => r.includes('Low fact grounding'))).toBe(true);
  });
});
