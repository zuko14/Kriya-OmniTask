import { describe, it, expect } from 'vitest';
import { WaterfallTraceVisualizer } from '../../src/sre/waterfall/waterfallTraceVisualizer.js';
import { ExecutionSpanRecord } from '../../src/observability/types/observabilityTypes.js';

describe('WaterfallTraceVisualizer Unit Tests', () => {
  const traceId = 'trace_waterfall_test';

  const spans: ExecutionSpanRecord[] = [
    {
      id: 'span_root',
      trace_id: traceId,
      tenant_id: 'tenant_test',
      agent_id: 'orchestrator_lead',
      span_name: 'execute_customer_inquiry_workflow',
      step_type: 'orchestration',
      latency_ms: 1500,
      tokens_input: 100,
      tokens_output: 50,
      cost_usd: 0.002,
      status: 'completed',
      attributes_json: '{}',
      started_at: '2026-03-01T12:00:00.000Z',
      ended_at: '2026-03-01T12:00:01.500Z',
      created_at: '2026-03-01T12:00:00.000Z',
      updated_at: '2026-03-01T12:00:00.000Z',
    },
    {
      id: 'span_child_1',
      parent_span_id: 'span_root',
      trace_id: traceId,
      tenant_id: 'tenant_test',
      agent_id: 'crm_agent',
      span_name: 'fetch_customer_timeline',
      step_type: 'tool_execution',
      latency_ms: 500,
      tokens_input: 50,
      tokens_output: 25,
      cost_usd: 0.001,
      status: 'completed',
      attributes_json: '{}',
      started_at: '2026-03-01T12:00:00.100Z',
      ended_at: '2026-03-01T12:00:00.600Z',
      created_at: '2026-03-01T12:00:00.100Z',
      updated_at: '2026-03-01T12:00:00.100Z',
    },
    {
      id: 'span_child_2',
      parent_span_id: 'span_root',
      trace_id: traceId,
      tenant_id: 'tenant_test',
      agent_id: 'llm_agent',
      span_name: 'synthesize_support_resolution',
      step_type: 'model_inference',
      latency_ms: 800,
      tokens_input: 300,
      tokens_output: 150,
      cost_usd: 0.005,
      status: 'completed',
      attributes_json: '{}',
      started_at: '2026-03-01T12:00:00.650Z',
      ended_at: '2026-03-01T12:00:01.450Z',
      created_at: '2026-03-01T12:00:00.650Z',
      updated_at: '2026-03-01T12:00:00.650Z',
    },
  ];

  it('should build hierarchical waterfall view with accurate offsets and critical path detection', () => {
    const view = WaterfallTraceVisualizer.buildWaterfallView(traceId, spans);

    expect(view.traceId).toBe(traceId);
    expect(view.spanCount).toBe(3);
    expect(view.tree.length).toBe(1); // 1 root node

    const rootNode = view.tree[0];
    expect(rootNode.spanId).toBe('span_root');
    expect(rootNode.startOffsetMs).toBe(0);
    expect(rootNode.children.length).toBe(2);

    expect(rootNode.children[0].spanId).toBe('span_child_1');
    expect(rootNode.children[0].startOffsetMs).toBe(100);
    expect(rootNode.children[1].spanId).toBe('span_child_2');
    expect(rootNode.children[1].startOffsetMs).toBe(650);

    expect(view.criticalPathDurationMs).toBeGreaterThan(1500);
  });
});
