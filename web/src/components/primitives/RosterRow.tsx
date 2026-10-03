import React, { useState } from 'react';
import { StateDot, SignalState, SIGNAL_COLOR } from './StateDot';
import { TaskChip } from './TaskChip';
import { ConfirmDialog } from './ConfirmDialog';
import { Icon } from '../brand/Icon';

export interface RosterAgent {
  id: string;
  name: string;
  slug: string;
  role?: string;
  isSupervisor?: boolean;
}

export interface ActiveTaskItem {
  id: string;
  taskType: string;
  state: SignalState;
  elapsed: string;
  label: string;
}

export interface RosterRowProps {
  agent: RosterAgent;
  depth?: number;
  isLastChild?: boolean;
  state: SignalState;
  load?: number; // 0 to 1
  trend?: number[]; // 24 hourly buckets
  attentionCount?: number;
  version?: string;
  isCanary?: boolean;
  modelTier?: string;
  preferredModelTier?: string;
  degradedReason?: string;
  activeTasks?: ActiveTaskItem[];
  isActive?: boolean;
  onToggle?: (active: boolean) => void;
  onExpand?: (expanded: boolean) => void;
  onSelect?: () => void;
  style?: React.CSSProperties;
  className?: string;
}

export function RosterRow({
  agent,
  depth = 0,
  isLastChild = false,
  state,
  load = 0,
  trend = [],
  attentionCount = 0,
  version = 'v2.1',
  isCanary = false,
  modelTier,
  preferredModelTier,
  degradedReason,
  activeTasks = [],
  isActive = true,
  onToggle,
  onExpand,
  onSelect,
  style = {},
  className = '',
}: RosterRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [showDeactivateConfirm, setShowDeactivateConfirm] = useState(false);

  // Check if brain is degraded below preferred tier (§9.4, §14.4)
  const isDegraded = Boolean(
    degradedReason || (preferredModelTier && modelTier && preferredModelTier !== modelTier)
  );

  const handleToggleClick = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    if (isActive) {
      // Require confirmation to deactivate an in-service agent
      setShowDeactivateConfirm(true);
    } else {
      onToggle?.(true);
    }
  };

  const handleExpandClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const newExpanded = !expanded;
    setExpanded(newExpanded);
    onExpand?.(newExpanded);
  };

  // Generate 9-cell load bar (§14.4)
  const totalCells = 9;
  const filledCells = Math.min(totalCells, Math.max(0, Math.round(load * totalCells)));
  const loadPercentage = Math.round(load * 100);

  // Normalize 24-bucket sparkline coordinates (§14.4)
  const buckets = trend.length > 0 ? trend : Array.from({ length: 24 }, () => 0);
  const maxVal = Math.max(...buckets, 1);
  const sparklinePoints = buckets
    .map((val, idx) => {
      const x = (idx / (buckets.length - 1)) * 64;
      const y = 16 - (val / maxVal) * 14;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  // Tree connector glyphs for hierarchy (§14.4)
  const connectorGlyph = depth > 0 ? (isLastChild ? '└─ ' : '├─ ') : '';

  return (
    <div
      className={`roster-row-container ${className}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        borderBottom: 'var(--border-width) solid var(--border)',
        background: isCanary ? 'var(--purple-bg)' : 'transparent',
        borderLeft: isCanary ? '2px solid var(--purple)' : '2px solid transparent',
        transition: 'background var(--motion-fast) var(--ease-out)',
        ...style,
      }}
    >
      <div
        role="row"
        tabIndex={0}
        onClick={onSelect}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect?.();
          }
        }}
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(220px, 2fr) 130px 140px 100px 80px 70px',
          alignItems: 'center',
          minHeight: 'var(--row-height)',
          padding: '0 var(--space-3)',
          cursor: onSelect ? 'pointer' : 'default',
          outline: 'none',
          gap: 'var(--space-2)',
        }}
      >
        {/* 1. AGENT IDENTITY & HIERARCHY INDENT */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            paddingLeft: `calc(${depth} * var(--space-4))`,
            overflow: 'hidden',
          }}
        >
          {depth > 0 && (
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-xs)',
                color: 'var(--text3)',
                userSelect: 'none',
              }}
              aria-hidden="true"
            >
              {connectorGlyph}
            </span>
          )}

          {activeTasks.length > 0 && (
            <button
              onClick={handleExpandClick}
              aria-expanded={expanded}
              aria-label={expanded ? `Collapse tasks for ${agent.name}` : `Expand tasks for ${agent.name}`}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text3)',
                cursor: 'pointer',
                padding: '2px',
                fontSize: 'var(--text-xs)',
                display: 'inline-flex',
                alignItems: 'center',
              }}
            >
              {expanded ? '▼' : '▶'}
            </button>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <span
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 'var(--text-sm)',
                  fontWeight: 600,
                  color: 'var(--text)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {agent.name}
              </span>
              {isCanary && (
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--text-2xs)',
                    color: 'var(--purple)',
                    background: 'var(--purple-bg)',
                    padding: '1px var(--space-1)',
                    borderRadius: 'var(--radius-sm)',
                    border: 'var(--border-width) solid var(--purple)',
                  }}
                >
                  CANARY
                </span>
              )}
            </div>
            {agent.role && (
              <span
                style={{
                  fontSize: 'var(--text-xs)',
                  color: 'var(--text3)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {agent.role} · <span style={{ fontFamily: 'var(--font-mono)' }}>{version}</span>
              </span>
            )}
          </div>
        </div>

        {/* 2. STATE & DEGRADED WARNING */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <StateDot state={state} size="md" pulse={state === 'live' && isActive} />
          <span
            style={{
              fontFamily: 'var(--font-body)',
              fontSize: 'var(--text-xs)',
              color: SIGNAL_COLOR[state],
              fontWeight: 500,
              textTransform: 'capitalize',
            }}
          >
            {state}
          </span>

          {isDegraded && (
            <span
              title={degradedReason || `Running below preferred tier (${preferredModelTier} → ${modelTier})`}
              aria-label={degradedReason || 'Degraded model tier in effect'}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--amber)',
                fontSize: 'var(--text-xs)',
                cursor: 'help',
                padding: '0 2px',
              }}
              data-testid="degraded-warning"
            >
              <Icon name="alert" />
            </span>
          )}
        </div>

        {/* 3. LOAD BAR (9 CELLS) */}
        <div
          title={`Fleet load: ${loadPercentage}%`}
          aria-label={`Current load ${loadPercentage}%`}
          style={{ display: 'flex', alignItems: 'center', gap: '2px' }}
        >
          {Array.from({ length: totalCells }).map((_, cellIdx) => {
            const isFilled = cellIdx < filledCells;
            return (
              <div
                key={cellIdx}
                style={{
                  width: '8px',
                  height: '14px',
                  borderRadius: '1px',
                  background: isFilled ? SIGNAL_COLOR[state] : 'var(--surface2)',
                  opacity: isFilled ? 0.8 : 0.25,
                  border: '1px solid var(--border)',
                }}
              />
            );
          })}
        </div>

        {/* 4. 24H TREND SPARKLINE */}
        <div
          title="24-hour activity trend"
          aria-label="24-hour activity trend"
          style={{ display: 'flex', alignItems: 'center', width: '64px', height: '16px' }}
        >
          <svg width="64" height="16" style={{ overflow: 'visible' }}>
            <polyline
              fill="none"
              stroke="var(--text2)"
              strokeWidth="1"
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity="0.6"
              points={sparklinePoints}
            />
          </svg>
        </div>

        {/* 5. ATTENTION COUNT */}
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {attentionCount > 0 ? (
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-xs)',
                fontWeight: 600,
                color: 'var(--amber)',
                background: 'var(--amber-bg)',
                padding: '2px var(--space-2)',
                borderRadius: 'var(--radius-sm)',
                border: 'var(--border-width) solid var(--amber)',
              }}
            >
              {attentionCount}
            </span>
          ) : (
            <span style={{ color: 'var(--text3)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>
              —
            </span>
          )}
        </div>

        {/* 6. INLINE TOGGLE SWITCH */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
          <button
            role="switch"
            aria-checked={isActive}
            aria-label={`${isActive ? 'Deactivate' : 'Activate'} agent ${agent.name}`}
            onClick={handleToggleClick}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleToggleClick(e);
              }
            }}
            style={{
              width: '36px',
              height: '20px',
              borderRadius: '10px',
              background: isActive ? 'var(--green)' : 'var(--surface2)',
              border: 'var(--border-width) solid var(--border2)',
              position: 'relative',
              cursor: 'pointer',
              padding: 0,
              outline: 'none',
              transition: 'background var(--motion-fast) var(--ease-out)',
            }}
          >
            <span
              style={{
                display: 'block',
                width: '14px',
                height: '14px',
                borderRadius: '50%',
                background: '#FFFFFF',
                position: 'absolute',
                top: '2px',
                left: isActive ? '18px' : '2px',
                transition: 'left var(--dur-instant) var(--ease-out)',
                boxShadow: 'var(--elev-1)',
              }}
            />
          </button>
        </div>
      </div>

      {/* EXPANDED IN-PLACE TASK STRIP (§14.4) */}
      {expanded && activeTasks.length > 0 && (
        <div
          style={{
            padding: 'var(--space-2) var(--space-4) var(--space-3) calc(var(--space-4) + 24px)',
            background: 'var(--surface3)',
            borderTop: 'var(--border-width) solid var(--border)',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 'var(--space-2)',
            alignItems: 'center',
          }}
        >
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-2xs)',
              color: 'var(--text3)',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              marginRight: 'var(--space-2)',
            }}
          >
            In-Flight Tasks ({activeTasks.length}):
          </span>
          {activeTasks.map((task) => (
            <TaskChip
              key={task.id}
              taskType={task.taskType}
              state={task.state}
              label={task.label}
              elapsed={task.elapsed}
            />
          ))}
        </div>
      )}

      {/* CONFIRMATION MODAL ON DEACTIVATION (§14.4) */}
      <ConfirmDialog
        isOpen={showDeactivateConfirm}
        isHighRisk={agent.isSupervisor}
        title={`Deactivate Agent: ${agent.name}`}
        actionName="agent:deactivate"
        consequence={`Deactivating ${agent.name} will gracefully drain active customer interactions and route incoming requests to supervisor fallback.`}
        confirmLabel="Deactivate Agent"
        cancelLabel="Cancel"
        onConfirm={() => {
          setShowDeactivateConfirm(false);
          onToggle?.(false);
        }}
        onCancel={() => setShowDeactivateConfirm(false)}
      />
    </div>
  );
}
