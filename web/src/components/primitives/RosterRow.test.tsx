import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RosterRow } from './RosterRow';

describe('RosterRow Primitive (§14.4, M8)', () => {
  const baseAgent = {
    id: 'ag_orch_1',
    name: 'Workforce Orchestrator',
    slug: 'orchestrator',
    role: 'Supervisor Engine',
    isSupervisor: true,
  };

  it('renders agent hierarchy, load bar, and 24h trend sparkline', () => {
    const trend24 = [10, 20, 30, 40, 50, 60, 70, 80, 90, 80, 70, 60, 50, 40, 30, 20, 10, 5, 0, 10, 20, 30, 40, 50];
    const { container } = render(
      <RosterRow
        agent={baseAgent}
        depth={0}
        state="live"
        load={0.7}
        trend={trend24}
        attentionCount={0}
        version="v2.3"
      />
    );

    expect(screen.getByText('Workforce Orchestrator')).toBeInTheDocument();
    expect(screen.getByText(/Supervisor Engine/)).toBeInTheDocument();
    expect(screen.getByText(/v2.3/)).toBeInTheDocument();
    expect(screen.getByText('live')).toBeInTheDocument();

    // Check 24h sparkline SVG polyline
    const polyline = container.querySelector('svg polyline');
    expect(polyline).toBeInTheDocument();
    expect(polyline?.getAttribute('points')).toBeTruthy();

    // Check load bar title/label
    expect(screen.getByLabelText(/Current load 70%/i)).toBeInTheDocument();
  });

  it('renders child hierarchy indentation with connector glyphs', () => {
    const childAgent = {
      id: 'ag_lead_1',
      name: 'Lead Qualification Specialist',
      slug: 'lead_qual',
      role: 'Sales Specialist',
    };

    render(
      <RosterRow
        agent={childAgent}
        depth={1}
        isLastChild={false}
        state="live"
        load={0.5}
      />
    );

    expect(screen.getByText('├─')).toBeInTheDocument();
  });

  it('renders canary border and badge when isCanary is true (§14.4)', () => {
    const canaryAgent = {
      id: 'ag_canary_1',
      name: 'Experimental Retention Agent',
      slug: 'retention_canary',
    };

    const { container } = render(
      <RosterRow
        agent={canaryAgent}
        state="learning"
        isCanary={true}
      />
    );

    expect(screen.getByText('CANARY')).toBeInTheDocument();
    const rowContainer = container.querySelector('.roster-row-container');
    expect(rowContainer).toHaveStyle({ borderLeft: '2px solid var(--purple)' });
  });

  it('renders degraded-brain warning icon with reason when running below preferred tier (§9.4, §14.4)', () => {
    const degradedAgent = {
      id: 'ag_supp_1',
      name: 'Support Agent',
      slug: 'support',
    };

    render(
      <RosterRow
        agent={degradedAgent}
        state="attention"
        preferredModelTier="tier_1"
        modelTier="tier_2"
        degradedReason="Degraded to tier_2: router rate limit on primary provider"
      />
    );

    const warningIcon = screen.getByTestId('degraded-warning');
    expect(warningIcon).toBeInTheDocument();
    expect(warningIcon).toHaveAttribute('title', 'Degraded to tier_2: router rate limit on primary provider');
  });

  it('handles in-place task expansion showing active task chips (§14.4)', () => {
    const activeTasks = [
      { id: 'tsk_1', taskType: 'WhatsApp Chat', state: 'live' as const, label: 'handling +91 9876543210', elapsed: '2.4s' },
      { id: 'tsk_2', taskType: 'CRM Sync', state: 'live' as const, label: 'updating lead status', elapsed: '0.8s' },
    ];

    render(
      <RosterRow
        agent={baseAgent}
        state="live"
        activeTasks={activeTasks}
      />
    );

    // Expand button is present
    const expandBtn = screen.getByRole('button', { name: /Expand tasks for Workforce Orchestrator/i });
    expect(expandBtn).toBeInTheDocument();

    // Click to expand
    fireEvent.click(expandBtn);

    // Active tasks appear in place
    expect(screen.getByText('In-Flight Tasks (2):')).toBeInTheDocument();
    expect(screen.getByText(/handling \+91 9876543210/)).toBeInTheDocument();
    expect(screen.getByText(/2.4s/)).toBeInTheDocument();
  });

  it('handles inline toggle switch with confirmation on deactivation', () => {
    const onToggleMock = vi.fn();

    render(
      <RosterRow
        agent={baseAgent}
        state="live"
        isActive={true}
        onToggle={onToggleMock}
      />
    );

    const toggleSwitch = screen.getByRole('switch', { name: /Deactivate agent Workforce Orchestrator/i });
    expect(toggleSwitch).toBeInTheDocument();

    // Click toggle to deactivate -> opens confirmation modal
    fireEvent.click(toggleSwitch);

    expect(screen.getByText(/Deactivate Agent: Workforce Orchestrator/i)).toBeInTheDocument();

    // Confirm deactivation
    const confirmBtn = screen.getByRole('button', { name: /Deactivate Agent/i });
    fireEvent.click(confirmBtn);

    expect(onToggleMock).toHaveBeenCalledWith(false);
  });
});
