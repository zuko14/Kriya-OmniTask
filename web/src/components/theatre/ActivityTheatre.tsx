import React, { useState, useMemo } from 'react';
import { HeaderSummary } from './HeaderSummary';
import { HierarchyCanvas, HierarchyAgentNode, LiveDelegationEdge } from './HierarchyCanvas';
import { ActivityStream, ActivityStreamEvent } from './ActivityStream';
import { NowRunningStrip, RunningTaskItem } from './NowRunningStrip';
import { DecisionTraceDrawer } from '../DecisionTraceDrawer';
import { useRealtimeStream } from '../../lib/useRealtimeStream';
import { Icon } from '../brand/Icon';
import { EmptyState } from '../primitives/EmptyState';
import styles from './ActivityTheatre.module.css';

export interface ActivityTheatreProps {
  tenantId: string;
  customNodes?: HierarchyAgentNode[];
  customEdges?: LiveDelegationEdge[];
  initialEvents?: ActivityStreamEvent[];
}

export function ActivityTheatre({
  tenantId,
  customNodes,
  customEdges,
  initialEvents = [],
}: ActivityTheatreProps) {
  const { events: streamEvents, agentStates, isConnected, isReconnecting } = useRealtimeStream(tenantId);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [activeTraceTaskId, setActiveTraceTaskId] = useState<string | null>(null);
  const [headerFilter, setHeaderFilter] = useState<'all' | 'working' | 'attention' | 'done'>('all');

  // Convert raw stream events to display format
  const displayEvents: ActivityStreamEvent[] = useMemo(() => {
    if (streamEvents.length > 0) {
      return streamEvents.map((ev) => {
        // Unknown / non-task events are informational. Only `task.completed` is ever shown as completed.
        let outcome: 'live' | 'attention' | 'halt' | 'external' | 'learning' | 'info' = 'info';
        let outcomeLabel: string = ev.type;

        if (ev.type === 'task.completed') {
          outcome = 'live';
          outcomeLabel = 'completed';
        } else if (ev.type === 'task.failed') {
          outcome = 'halt';
          outcomeLabel = 'failed';
        } else if (ev.type === 'task.escalated' || ev.type === 'attention.created') {
          outcome = 'attention';
          outcomeLabel = 'escalated';
        } else if (ev.type === 'model.degraded') {
          outcome = 'attention';
          outcomeLabel = 'degraded';
        } else if (ev.type === 'external.retrieved') {
          outcome = 'external';
          outcomeLabel = 'external';
        } else if (ev.type === 'task.started') {
          outcome = 'learning';
          outcomeLabel = 'started';
        } else if (ev.type === 'approval.required') {
          outcome = 'attention';
          outcomeLabel = 'approval required';
        } else if (ev.type === 'security.event') {
          outcome = 'halt';
          outcomeLabel = 'security event';
        }

        return {
          id: `${ev.seq}-${ev.ts}`,
          seq: ev.seq,
          ts: ev.ts,
          agentId: ev.agent_id || 'system',
          agentName: ev.agent_id ? ev.agent_id.replace(/_/g, ' ') : 'Orchestrator',
          type: ev.type,
          outcome,
          outcomeLabel,
          subject: (ev.payload?.taskType as string) || (ev.payload?.outcome as string) || ev.type,
          evidence: (ev.payload?.reason as string) || (ev.payload?.summary as string) || undefined,
          hasExternalSource: ev.type === 'external.retrieved' || !!ev.payload?.trustTier,
          taskId: (ev.execution_id as string) || (ev.payload?.taskId as string) || undefined,
        };
      });
    }
    return initialEvents;
  }, [streamEvents, initialEvents]);

  // Derive dynamic hierarchy nodes from agent states
  const hierarchyNodes: HierarchyAgentNode[] = useMemo(() => {
    if (customNodes && customNodes.length > 0) {
      return customNodes.map((n) => {
        const liveState = agentStates[n.id];
        if (liveState) {
          return {
            ...n,
            state: liveState.state || n.state,
            load: typeof liveState.load === 'number' ? liveState.load : n.load,
          };
        }
        return n;
      });
    }
    // No configured hierarchy: draw nothing rather than a fictional reference team (S45).
    return [];
  }, [customNodes, agentStates]);

  // Derive running tasks
  const runningTasks: RunningTaskItem[] = useMemo(() => {
    const tasks: RunningTaskItem[] = [];
    for (const [agentId, state] of Object.entries(agentStates)) {
      if (state.currentTask) {
        tasks.push({
          id: `task-${agentId}`,
          agentName: agentId.replace(/_/g, ' '),
          taskType: state.currentTask,
          summary: state.currentTask,
          state: state.state === 'attention' ? 'attention' : 'live',
        });
      }
    }
    return tasks;
  }, [agentStates]);

  // Derive counts for HeaderSummary
  // Counts come only from what the live stream reported (S45): no padding, no placeholder fleet.
  const workingCount = Object.values(agentStates).filter((s) => s.state === 'live').length;
  const attentionCount = displayEvents.filter((e) => e.outcome === 'attention').length;
  const doneTodayCount = displayEvents.filter((e) => e.type === 'task.completed').length;

  return (
    <section className={styles.theatreContainer} data-testid="live-agent-activity-theatre" aria-label="Live Agent Activity Theatre">
      {/* Reconnecting banner (§19) */}
      {isReconnecting && (
        <div className={styles.reconnectingBanner} role="status">
          <Icon name="alert" />
          <span>Reconnecting to live telemetry stream...</span>
        </div>
      )}

      {/* 1. Header Summary (§15.5) */}
      <HeaderSummary
        workingCount={workingCount}
        attentionCount={attentionCount}
        doneTodayCount={doneTodayCount}
        activeFilter={headerFilter}
        onSelectFilter={setHeaderFilter}
      />

      {/* 2. Theatre Body (40% Hierarchy Canvas + 60% Activity Stream) */}
      <div className={styles.theatreBody}>
        {hierarchyNodes.length === 0 ? (
          <EmptyState
            title="No agent hierarchy reported yet"
            message={
              Object.keys(agentStates).length > 0
                ? `Live agents reporting: ${Object.keys(agentStates).map((id) => id.replace(/_/g, ' ')).join(', ')}. The hierarchy view appears once a fleet layout is configured.`
                : 'No agents have reported state on the live stream yet.'
            }
          />
        ) : (
        <HierarchyCanvas
          nodes={hierarchyNodes}
          edges={customEdges}
          selectedAgentId={selectedAgentId}
          onSelectAgent={(agentId) => setSelectedAgentId(selectedAgentId === agentId ? null : agentId)}
        />
        )}
        <ActivityStream
          events={displayEvents}
          selectedAgentId={selectedAgentId}
          onOpenTrace={(taskId) => setActiveTraceTaskId(taskId)}
          onFilterAgent={(agentId) => setSelectedAgentId(agentId)}
        />
      </div>

      {/* 3. Now Running Strip (§15.4) */}
      <NowRunningStrip
        tasks={runningTasks}
        onSelectTask={(taskId) => setActiveTraceTaskId(taskId)}
      />

      {/* 4. Decision Trace Drawer (§18.5) */}
      {activeTraceTaskId && (
        <DecisionTraceDrawer
          taskId={activeTraceTaskId}
          onClose={() => setActiveTraceTaskId(null)}
        />
      )}
    </section>
  );
}
