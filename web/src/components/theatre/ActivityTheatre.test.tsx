import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HeaderSummary } from './HeaderSummary';
import { HierarchyCanvas } from './HierarchyCanvas';
import { ActivityStream, ActivityStreamEvent } from './ActivityStream';
import { NowRunningStrip } from './NowRunningStrip';
import { ActivityTheatre } from './ActivityTheatre';

describe('Live Agent Activity Theatre Unit Tests (§15, Milestone M10)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('1. Delegation visibly traces supervisor → specialist in real time (§15.2, Criterion 1)', () => {
    const customEdges = [
      { fromId: 'orchestrator', toId: 'supervisor_sales', status: 'delegating' as const },
      { fromId: 'supervisor_sales', toId: 'lead_qual', status: 'delegating' as const },
    ];

    render(<HierarchyCanvas edges={customEdges} />);

    const delegationEdge1 = screen.getByTestId('delegation-edge-orchestrator->supervisor_sales');
    const delegationEdge2 = screen.getByTestId('delegation-edge-supervisor_sales->lead_qual');

    expect(delegationEdge1).toBeDefined();
    expect(delegationEdge2).toBeDefined();
  });

  it('2. Failure visibly cascades upward and repair resolves it (§15.2, Criterion 2)', () => {
    const customEdges = [
      { fromId: 'orchestrator', toId: 'supervisor_support', status: 'repairing' as const },
      { fromId: 'supervisor_support', toId: 'support_care', status: 'failing' as const },
    ];

    render(<HierarchyCanvas edges={customEdges} />);

    const failingEdge = screen.getByTestId('failure-edge-supervisor_support->support_care');
    const repairingEdge = screen.getByTestId('failure-edge-orchestrator->supervisor_support');

    expect(failingEdge).toBeDefined();
    expect(repairingEdge).toBeDefined();
  });

  it('3. External-influenced events carry the ◇ marker in the live feed (§15.3, Criterion 3)', () => {
    const events: ActivityStreamEvent[] = [
      {
        id: 'ev-1',
        seq: 101,
        ts: '2026-08-20T10:41:44Z',
        agentId: 'research_agent',
        agentName: 'Research Agent',
        type: 'external.retrieved',
        outcome: 'external',
        outcomeLabel: 'external',
        subject: '3 sources retrieved from web',
        evidence: 'web · allowlisted · cited',
        hasExternalSource: true,
        taskId: 'task_ext_1',
      },
    ];

    render(<ActivityStream events={events} />);

    expect(screen.getByText('◇')).toBeDefined();
    expect(screen.getByText('Research Agent')).toBeDefined();
    expect(screen.getByText('3 sources retrieved from web')).toBeDefined();
    expect(screen.getByText('web · allowlisted · cited')).toBeDefined();
  });

  it('4. Auto-scroll pauses on scroll-up with a resume pill (§15.3, Criterion 4)', () => {
    const initialEvents: ActivityStreamEvent[] = [
      {
        id: 'ev-1',
        seq: 1,
        ts: '2026-08-20T10:00:00Z',
        agentId: 'lead_qual',
        agentName: 'Lead Qual',
        type: 'task.started',
        outcome: 'live',
        outcomeLabel: 'started',
        subject: 'Lead scoring',
      },
    ];

    const { rerender } = render(<ActivityStream events={initialEvents} />);

    const feed = screen.getByRole('feed');

    // Simulate scrolling down/up
    Object.defineProperty(feed, 'scrollTop', { value: 120, writable: true });
    fireEvent.scroll(feed);

    // Ingest new events while scrolled up
    const updatedEvents: ActivityStreamEvent[] = [
      {
        id: 'ev-2',
        seq: 2,
        ts: '2026-08-20T10:00:05Z',
        agentId: 'lead_qual',
        agentName: 'Lead Qual',
        type: 'task.completed',
        outcome: 'live',
        outcomeLabel: 'completed',
        subject: 'Lead qualified',
      },
      ...initialEvents,
    ];

    rerender(<ActivityStream events={updatedEvents} />);

    // Verify resume pill is displayed
    const resumePill = screen.getByTestId('resume-scroll-pill');
    expect(resumePill).toBeDefined();
    expect(screen.getByText('1 new events')).toBeDefined();

    // Click resume pill
    fireEvent.click(resumePill);
    expect(screen.queryByTestId('resume-scroll-pill')).toBeNull();
  });

  it('5. Every stream row opens its decision trace (§15.3, Criterion 5)', () => {
    const onOpenTrace = vi.fn();
    const events: ActivityStreamEvent[] = [
      {
        id: 'ev-trace-test',
        seq: 42,
        ts: '2026-08-20T10:42:07Z',
        agentId: 'lead_qual',
        agentName: 'Lead Qual',
        type: 'task.completed',
        outcome: 'live',
        outcomeLabel: 'qualified',
        subject: 'Priya S.',
        taskId: 'task_exec_999',
      },
    ];

    render(<ActivityStream events={events} onOpenTrace={onOpenTrace} />);

    const row = screen.getByTestId('stream-row-42');
    fireEvent.click(row);

    expect(onOpenTrace).toHaveBeenCalledWith('task_exec_999');
  });

  it('6. Idle state reads as calm and intentional, never broken (§15.6, Criterion 6)', () => {
    render(<ActivityStream events={[]} />);

    expect(screen.getByTestId('stream-idle-state')).toBeDefined();
    // An empty stream says only that nothing was reported, never that work completed (WP-7.4).
    expect(screen.getByText('No activity yet')).toBeDefined();
    expect(screen.queryByText(/All scheduled tasks completed/i)).toBeNull();
  });

  it('7. Activity Stream and Header announce correctly to screen reader (§15.3, §15.5, §20, Criterion 8)', () => {
    render(
      <HeaderSummary
        workingCount={12}
        attentionCount={3}
        doneTodayCount={47}
      />
    );

    const statusHeader = screen.getByRole('status');
    expect(statusHeader).toBeDefined();
    expect(statusHeader.getAttribute('aria-live')).toBe('polite');
    expect(screen.getByText('12 working')).toBeDefined();
    expect(screen.getByText('3 attention')).toBeDefined();
    expect(screen.getByText('47 done today')).toBeDefined();
  });

  it('8. Composite ActivityTheatre integrates Header, Canvas, Stream, and Now Running strip end-to-end', () => {
    const events: ActivityStreamEvent[] = [
      {
        id: 'ev-full-1',
        seq: 1,
        ts: '2026-08-20T10:42:00Z',
        agentId: 'booking',
        agentName: 'Booking',
        type: 'task.completed',
        outcome: 'live',
        outcomeLabel: 'held slot',
        subject: 'Thu 4pm',
      },
    ];

    // The canvas draws a configured layout; without one it must not invent a team (S45, WP-7.4).
    const layout = [{ id: 'booking', name: 'Booking', role: 'Scheduling', depth: 0, state: 'idle' as const, load: 0, x: 250, y: 55 }];
    const { unmount } = render(<ActivityTheatre tenantId="tenant_test_theatre" initialEvents={events} />);
    expect(screen.queryByTestId('hierarchy-canvas')).toBeNull();
    expect(screen.getByText('No agent hierarchy reported yet')).toBeDefined();
    unmount();

    render(<ActivityTheatre tenantId="tenant_test_theatre" initialEvents={events} customNodes={layout} />);

    expect(screen.getByTestId('live-agent-activity-theatre')).toBeDefined();
    expect(screen.getByTestId('hierarchy-canvas')).toBeDefined();
    expect(screen.getByTestId('activity-stream')).toBeDefined();
    expect(screen.getByTestId('now-running-strip')).toBeDefined();
  });
});
