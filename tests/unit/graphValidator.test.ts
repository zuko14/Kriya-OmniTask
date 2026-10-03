/**
 * Kriya Omnitask — Graph validator tests (docs/kriya WP-2.1)
 * A correct Verified Action graph passes; each unsafe variant is rejected for the right reason.
 */

import { describe, it, expect } from 'vitest';
import { validateGraph, assertValidGraph } from '../../src/runtime/graph/validator.js';
import { GraphDefinition, evaluateCondition } from '../../src/runtime/graph/types.js';

/** Blueprint §14 refund flow: understand → authorise → decide → execute → verify → prove. */
const refundGraph = (): GraphDefinition => ({
  id: 'refund_under_mandate',
  version: '1.0.0',
  entry: 'understand',
  maxSteps: 40,
  nodes: [
    { id: 'understand', kind: 'llm', config: { outputSchema: 'RefundIntent' } },
    { id: 'route_intent', kind: 'router', config: {} },
    { id: 'policy', kind: 'policy', config: {} },
    { id: 'mandate', kind: 'mandate', config: {} },
    { id: 'approval', kind: 'human_gate', config: {} },
    { id: 'refund', kind: 'tool', actionTier: 'T2', config: { tool: 'payments.refund' } },
    { id: 'readback', kind: 'verify', config: {}, maxVisits: 3 },
    { id: 'settled', kind: 'router', config: {}, maxVisits: 3 },
    { id: 'wait', kind: 'rule', config: { delayMs: 60000 }, maxVisits: 3 },
    { id: 'receipt', kind: 'proof', config: {} },
    { id: 'done', kind: 'end', outcome: 'verified', config: {} },
    { id: 'mismatch', kind: 'end', outcome: 'verification_failed', config: {} },
    { id: 'blocked', kind: 'end', outcome: 'blocked', config: {} },
    { id: 'rejected', kind: 'end', outcome: 'escalated', config: {} },
    { id: 'answer', kind: 'end', outcome: 'informed', config: {} },
  ],
  edges: [
    { from: 'understand', to: 'route_intent' },
    { from: 'route_intent', to: 'policy', when: [{ path: 'intent', op: 'eq', value: 'refund' }] },
    { from: 'route_intent', to: 'answer' },
    { from: 'policy', to: 'mandate', when: [{ path: 'policy.decision', op: 'eq', value: 'allow' }] },
    { from: 'policy', to: 'blocked' },
    { from: 'mandate', to: 'refund', when: [{ path: 'mandate.decision', op: 'eq', value: 'allow' }] },
    { from: 'mandate', to: 'approval' },
    { from: 'approval', to: 'refund', when: [{ path: 'approval.decision', op: 'eq', value: 'approved' }] },
    { from: 'approval', to: 'rejected' },
    { from: 'refund', to: 'readback' },
    { from: 'readback', to: 'settled' },
    { from: 'settled', to: 'receipt', when: [{ path: 'verification.state', op: 'eq', value: 'verified' }] },
    { from: 'settled', to: 'wait', when: [{ path: 'verification.state', op: 'eq', value: 'pending' }] },
    { from: 'settled', to: 'mismatch' },
    { from: 'wait', to: 'readback' },
    { from: 'receipt', to: 'done' },
  ],
});

const rulesOf = (g: unknown) => validateGraph(g).violations.map((v) => v.rule);

describe('Graph validator', () => {
  it('accepts a correct Verified Action graph (with a bounded verification-polling loop)', () => {
    const res = validateGraph(refundGraph());
    expect(res.violations).toEqual([]);
    expect(res.valid).toBe(true);
    expect(() => assertValidGraph(refundGraph())).not.toThrow();
  });

  it('accepts a pure T0 answer graph', () => {
    expect(
      validateGraph({
        id: 'faq', version: '1.0.0', entry: 'a', maxSteps: 5,
        nodes: [{ id: 'a', kind: 'llm', config: { outputSchema: 'Answer' } }, { id: 'e', kind: 'end', outcome: 'informed' }],
        edges: [{ from: 'a', to: 'e' }],
      }).valid
    ).toBe(true);
  });

  it('rejects a tool reachable without a policy check', () => {
    const g = refundGraph();
    g.edges.push({ from: 'route_intent', to: 'refund', when: [{ path: 'intent', op: 'eq', value: 'fast_refund' }] });
    expect(rulesOf(g)).toContain('policy_before_tool');
  });

  it('rejects a T2 tool reachable without a mandate check', () => {
    const g = refundGraph();
    g.edges = g.edges.map((e) => (e.from === 'policy' && e.to === 'mandate' ? { ...e, to: 'refund' } : e));
    expect(rulesOf(g)).toContain('mandate_before_tool');
  });

  it('rejects a T3 tool without a human gate on every path', () => {
    const g = refundGraph();
    g.nodes = g.nodes.map((n) => (n.id === 'refund' ? { ...n, actionTier: 'T3' } : n));
    expect(rulesOf(g)).toContain('human_gate_before_t3');
  });

  it('rejects "verified" reachable after a tool without verify or proof', () => {
    const g = refundGraph();
    g.edges = g.edges.map((e) => (e.from === 'refund' ? { ...e, to: 'done' } : e));
    const rules = rulesOf(g);
    expect(rules).toContain('verify_after_tool');
    expect(rules).toContain('proof_after_tool');
  });

  it('rejects writing a receipt before verifying', () => {
    const g = refundGraph();
    g.edges = g.edges.map((e) => (e.from === 'refund' ? { ...e, to: 'receipt' } : e));
    expect(rulesOf(g)).toContain('verify_before_proof');
  });

  it('rejects reporting "informed" after an action ran', () => {
    const g = refundGraph();
    g.edges.push({ from: 'settled', to: 'answer', when: [{ path: 'verification.state', op: 'eq', value: 'unknown' }] });
    expect(rulesOf(g)).toContain('tool_not_informed');
  });

  it('rejects an unbounded loop', () => {
    const g = refundGraph();
    g.nodes = g.nodes.map(({ maxVisits, ...n }) => n);
    expect(rulesOf(g)).toContain('loop_bound');
  });

  it('rejects an llm node without an output schema, a tool without a tier, and two default edges', () => {
    const g = refundGraph();
    g.nodes = g.nodes.map((n) => (n.id === 'understand' ? { ...n, config: {} } : n.id === 'refund' ? { ...n, actionTier: undefined } : n));
    g.edges.push({ from: 'policy', to: 'rejected' });
    const rules = rulesOf(g);
    expect(rules).toContain('llm_schema');
    expect(rules).toContain('tool_tier');
    expect(rules).toContain('single_default');
  });

  it('rejects structural errors: dead ends, unreachable nodes, ends with exits, bad references', () => {
    const g = refundGraph();
    g.nodes.push({ id: 'orphan', kind: 'rule', config: {} });
    g.edges.push({ from: 'done', to: 'understand' });
    const rules = rulesOf(g);
    expect(rules).toContain('reachable');
    expect(rules).toContain('has_exit');
    expect(rules).toContain('end_terminal');

    expect(rulesOf({ ...refundGraph(), entry: 'nope' })).toContain('entry_exists');
    expect(rulesOf({ ...refundGraph(), edges: [...refundGraph().edges, { from: 'refund', to: 'ghost' }] })).toContain('edge_endpoints');
  });

  it('evaluates edge conditions deterministically', () => {
    const state = { intent: 'refund', amount: 400, verification: { state: 'verified' } };
    expect(evaluateCondition({ path: 'verification.state', op: 'eq', value: 'verified' }, state)).toBe(true);
    expect(evaluateCondition({ path: 'amount', op: 'lte', value: 500 }, state)).toBe(true);
    expect(evaluateCondition({ path: 'intent', op: 'in', value: ['refund', 'cancel'] }, state)).toBe(true);
    expect(evaluateCondition({ path: 'missing.field', op: 'exists' }, state)).toBe(false);
    expect(evaluateCondition({ path: 'amount', op: 'gt', value: '100' }, state)).toBe(false); // no type coercion
  });
});
