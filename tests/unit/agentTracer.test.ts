import { describe, it, expect } from 'vitest';
import { AgentTracer } from '../../src/observability/tracing/agentTracer.js';
import { ExecutionTraceRecord, ExecutionSpanRecord } from '../../src/observability/types/observabilityTypes.js';

describe('Agent Tracer & Waterfall Tree Unit Tests', () => {
  it('should accurately calculate token cost attribution in USD', () => {
    // 1000 input tokens, 500 output tokens on standard tier
    const costStandard = AgentTracer.calculateCostUsd(1000, 500, 'gemini-2.5-flash');
    expect(costStandard).toBeGreaterThan(0);
    expect(costStandard).toBeLessThan(0.01);

    // Pro tier model
    const costPro = AgentTracer.calculateCostUsd(1000, 500, 'gemini-2.5-pro');
    expect(costPro).toBeGreaterThan(costStandard);
  });

  it('should build hierarchical waterfall tree with nested parent-child spans', () => {
    const mockTrace: ExecutionTraceRecord = {
      id: 'tr_1',
      tenant_id: 'tenant_1',
      organization_id: 'default',
      correlation_id: 'corr_1',
      root_agent_id: 'lead_qualifier',
      channel: 'whatsapp',
      status: 'completed',
      total_latency_ms: 450,
      total_tokens_input: 1200,
      total_tokens_output: 300,
      total_cost_usd: 0.0003,
      grounding_score: 1.0,
      drift_detected: false,
      drift_reasons_json: '[]',
      started_at: '2026-08-15T10:00:00Z',
      created_at: '2026-08-15T10:00:00Z',
      updated_at: '2026-08-15T10:00:00Z',
    };

    const mockSpans: ExecutionSpanRecord[] = [
      {
        id: 'span_root',
        trace_id: 'tr_1',
        tenant_id: 'tenant_1',
        span_name: 'Lead Qualification Execution',
        agent_id: 'lead_qualifier',
        step_type: 'orchestration',
        status: 'completed',
        latency_ms: 450,
        tokens_input: 1200,
        tokens_output: 300,
        cost_usd: 0.0003,
        attributes_json: '{}',
        started_at: '2026-08-15T10:00:00Z',
        ended_at: '2026-08-15T10:00:00Z',
        created_at: '2026-08-15T10:00:00Z',
        updated_at: '2026-08-15T10:00:00Z',
      },
      {
        id: 'span_rag',
        trace_id: 'tr_1',
        tenant_id: 'tenant_1',
        parent_span_id: 'span_root',
        span_name: 'Retrieve Customer Knowledge',
        agent_id: 'lead_qualifier',
        step_type: 'retrieval',
        status: 'completed',
        latency_ms: 120,
        tokens_input: 400,
        tokens_output: 0,
        cost_usd: 0.00006,
        attributes_json: '{}',
        started_at: '2026-08-15T10:00:00Z',
        ended_at: '2026-08-15T10:00:00Z',
        created_at: '2026-08-15T10:00:00Z',
        updated_at: '2026-08-15T10:00:00Z',
      },
      {
        id: 'span_tool',
        trace_id: 'tr_1',
        tenant_id: 'tenant_1',
        parent_span_id: 'span_root',
        span_name: 'Execute CRM Check Tool',
        agent_id: 'lead_qualifier',
        step_type: 'tool_execution',
        tool_name: 'crm_get_customer',
        status: 'completed',
        latency_ms: 80,
        tokens_input: 0,
        tokens_output: 0,
        cost_usd: 0.0,
        attributes_json: '{}',
        started_at: '2026-08-15T10:00:00Z',
        ended_at: '2026-08-15T10:00:00Z',
        created_at: '2026-08-15T10:00:00Z',
        updated_at: '2026-08-15T10:00:00Z',
      },
    ];

    const waterfall = AgentTracer.buildWaterfall(mockTrace, mockSpans);

    expect(waterfall.totalSpans).toBe(3);
    expect(waterfall.rootSpans.length).toBe(1);
    expect(waterfall.rootSpans[0].id).toBe('span_root');
    expect(waterfall.rootSpans[0].children.length).toBe(2);
    expect(waterfall.rootSpans[0].children.map((c) => c.stepType)).toContain('retrieval');
    expect(waterfall.rootSpans[0].children.map((c) => c.stepType)).toContain('tool_execution');
  });
});
