/**
 * WP-7.3 regression tests: the console never shows more than the backend proved (S44, S45, S43),
 * and the restyled primitives use the shared DS classes.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const stream = vi.hoisted(() => ({
  events: [] as Array<Record<string, unknown>>,
  agentStates: {} as Record<string, { state: string; load?: number; currentTask?: string }>,
}));
vi.mock('../lib/useRealtimeStream', () => ({
  useRealtimeStream: () => ({ events: stream.events, agentStates: stream.agentStates, isConnected: true, isReconnecting: false, error: null, client: null }),
}));

import { DecisionTraceDrawer } from './DecisionTraceDrawer';
import { ActivityTheatre } from './theatre/ActivityTheatre';
import { SignalBadge, ConfirmDialog, AttentionCard, STATE_GLYPHS } from './primitives';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  stream.events = [];
  stream.agentStates = {};
});

const respond = (status: number, body: unknown) =>
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: status < 400, status, json: async () => body })));

describe('DecisionTraceDrawer never fabricates a trace (S44)', () => {
  it.each([500, 403, 404])('API %s → honest error, no synthetic "verified" trace', async (status) => {
    respond(status, { error: { code: 'X', message: 'boom', statusCode: status } });
    render(<DecisionTraceDrawer taskId="task_1" onClose={() => {}} />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(status === 404 ? /No decision trace is recorded/ : status === 403 ? /Access denied/ : /Could not load the decision trace/);
    expect(document.body.textContent).not.toMatch(/verified|lead_44812|committed/i);
  });

  it('an unknown outcome is not shown as succeeded, and missing tokens/trust tier are not invented', async () => {
    respond(200, {
      success: true,
      trace: {
        id: 't', tenantId: 'x', taskId: 'task_2', correlationId: 'c', currentLevel: 'specialist', status: 'running',
        totalAttempts: 1, totalDurationMs: 10, totalCostUsd: 0, createdAt: '', updatedAt: '',
        steps: [{ stepNumber: 1, timestamp: '2026-10-02T00:00:00Z', level: 'specialist', actor: 'A', action: 'do_x', outcome: 'mystery', evidence: {}, durationMs: 5, costUsd: 0 }],
      },
    });
    render(<DecisionTraceDrawer taskId="task_2" onClose={() => {}} />);
    expect((await screen.findAllByText(/do_x/)).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/succeeded/i);
    expect(document.body.textContent).not.toMatch(/1200|1,200/);
    expect(document.body.textContent).not.toMatch(/Tier A/i);
  });
});

describe('Activity Theatre counts only what the stream reported (S45)', () => {
  const ev = (seq: number, type: string) => ({ seq, ts: `2026-10-02T00:00:0${seq}Z`, type, agent_id: 'intake', payload: {} });

  it('"done" counts task.completed only: no +42, no started/ping/state-change events', () => {
    stream.events = [ev(1, 'task.completed'), ev(2, 'task.completed'), ev(3, 'task.started'), ev(4, 'agent.state_changed'), ev(5, 'stream.ping')];
    render(<ActivityTheatre tenantId="t" />);
    expect(screen.getByText('2 done today')).toBeInTheDocument();
    expect(screen.getAllByText(/^completed$/i)).toHaveLength(2);
  });

  it('approval and security events are flagged, never "completed"', () => {
    stream.events = [ev(1, 'approval.required'), ev(2, 'security.event')];
    render(<ActivityTheatre tenantId="t" />);
    expect(screen.getByText('0 done today')).toBeInTheDocument();
    expect(screen.queryByText(/^completed$/i)).not.toBeInTheDocument();
    expect(screen.getByText('1 attention')).toBeInTheDocument();
  });

  it('with no fleet data, nothing is "working" and no elapsed time is invented', () => {
    render(<ActivityTheatre tenantId="t" />);
    expect(screen.getByText('0 working')).toBeInTheDocument();
    stream.agentStates = { intake: { state: 'live', currentTask: 'triage' } };
    cleanup();
    render(<ActivityTheatre tenantId="t" />);
    expect(screen.getByText('1 working')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/3\.2s/);
  });
});

describe('Primitives use the DS recipes (DS §7)', () => {
  it('SignalBadge is a semantic pill badge', () => {
    const { container } = render(<SignalBadge state="attention" label="Needs approval" />);
    expect(container.firstElementChild).toHaveClass('badge', 'badge-amber');
  });

  it('ConfirmDialog: high risk = danger button, otherwise primary CTA; glass modal', () => {
    const { rerender } = render(<ConfirmDialog isOpen title="Refund" actionName="refund" consequence="money moves" isHighRisk onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.getByRole('button', { name: 'Confirm Action' })).toHaveClass('btn-danger');
    expect(screen.getByRole('dialog')).toHaveClass('modal-overlay');
    rerender(<ConfirmDialog isOpen title="Note" actionName="note" consequence="none" onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.getByRole('button', { name: 'Confirm Action' })).toHaveClass('btn-accent');
  });

  it('AttentionCard Approve is not white-on-green (S43): uses btn-success', () => {
    const onApprove = vi.fn();
    render(
      <AttentionCard
        item={{ id: 'a1', title: 'Refund over limit', reason: 'mandate', priority: 'P1', status: 'pending' } as any}
        onApprove={onApprove}
        onReject={() => {}}
      />
    );
    const approve = screen.getByRole('button', { name: 'Approve' });
    expect(approve).toHaveClass('btn', 'btn-success');
    expect(approve.getAttribute('style') ?? '').not.toMatch(/#FFFFFF/i);
    fireEvent.click(approve);
    expect(onApprove).toHaveBeenCalledTimes(1);
  });

  it('state glyphs contain no emoji/dingbats', () => {
    for (const g of Object.values(STATE_GLYPHS)) expect(/[☀-➿]|[\u{1F300}-\u{1FAFF}]/u.test(g)).toBe(false);
  });
});

describe('Primary CTA label contrast (S43, D15)', () => {
  const lum = (h: string) => {
    const c = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((s) => (s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

  it('.btn-accent uses the navy label, which meets AA (4.5:1) on every gradient stop', () => {
    const css = readFileSync(resolve(__dirname, '../styles/components.css'), 'utf8');
    const rule = css.slice(css.indexOf('.btn-accent {'), css.indexOf('}', css.indexOf('.btn-accent {')));
    expect(rule).toContain('color: #040A11');
    for (const stop of ['10B981', '2FA8D8', '3D8BFD']) expect(ratio('040A11', stop)).toBeGreaterThanOrEqual(4.5);
  });
});
