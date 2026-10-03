import React from 'react';
import { SignalBadge } from './SignalBadge';
import { SignalState } from './StateDot';

export type AttentionPriorityTier = 'P0_CRITICAL' | 'P1_HIGH' | 'P2_MEDIUM' | 'P3_LOW';

export interface AttentionItemData {
  id: string;
  title: string;
  description: string;
  priority: AttentionPriorityTier;
  status: 'pending' | 'claimed' | 'resolved' | 'rejected' | 'timed_out';
  channel?: string;
  sourceAgentId?: string;
  customerId?: string;
  slaExpiresAt?: string;
  recommendedAction?: string;
  contextData?: Record<string, unknown>;
  createdAt?: string;
}

export interface AttentionCardProps {
  item: AttentionItemData;
  onApprove?: () => void;
  onReject?: () => void;
  onClaim?: () => void;
  onSelect?: () => void;
  style?: React.CSSProperties;
  className?: string;
}

export function AttentionCard({
  item,
  onApprove,
  onReject,
  onClaim,
  onSelect,
  style = {},
  className = '',
}: AttentionCardProps) {
  const prioritySignalMap: Record<AttentionPriorityTier, { color: string; bg: string; label: string }> = {
    P0_CRITICAL: { color: 'var(--red)', bg: 'var(--red-bg)', label: 'P0 · CRITICAL' },
    P1_HIGH: { color: 'var(--amber)', bg: 'var(--amber-bg)', label: 'P1 · HIGH' },
    P2_MEDIUM: { color: 'var(--accent)', bg: 'var(--blue-bg)', label: 'P2 · MEDIUM' },
    P3_LOW: { color: 'var(--text2)', bg: 'var(--surface2)', label: 'P3 · LOW' },
  };

  const priorityStyle = prioritySignalMap[item.priority] || prioritySignalMap.P2_MEDIUM;

  const statusSignalMap: Record<string, SignalState> = {
    pending: 'attention',
    claimed: 'learning',
    resolved: 'live',
    rejected: 'halt',
    timed_out: 'halt',
  };

  const statusSignal = statusSignalMap[item.status] || 'info';

  return (
    <div
      className={`attention-card ${className}`}
      tabIndex={0}
      role="article"
      aria-label={`Attention item: ${item.title}`}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect?.();
        }
      }}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-3)',
        padding: 'var(--space-4)',
        background: 'var(--surface)',
        border: 'var(--border-width) solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'inset 0 1px 0 var(--rim), var(--shadow)',
        backdropFilter: 'blur(var(--blur)) saturate(155%)',
        outline: 'none',
        cursor: onSelect ? 'pointer' : 'default',
        transition: 'border-color var(--motion-fast) var(--ease-out)',
        ...style,
      }}
    >
      {/* Header: Priority, Source, SLA */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-2xs)',
              fontWeight: 700,
              color: priorityStyle.color,
              background: priorityStyle.bg,
              padding: '2px var(--space-2)',
              borderRadius: 'var(--radius-sm)',
              border: `var(--border-width) solid ${priorityStyle.color}`,
              letterSpacing: '0.04em',
            }}
          >
            {priorityStyle.label}
          </span>
          <SignalBadge state={statusSignal} label={item.status.toUpperCase()} />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          {item.sourceAgentId && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--text2)' }}>
              agent: {item.sourceAgentId}
            </span>
          )}
          {item.channel && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-2xs)', color: 'var(--text3)' }}>
              [{item.channel}]
            </span>
          )}
        </div>
      </div>

      {/* Title & Description */}
      <div>
        <h4
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'var(--text-md)',
            fontWeight: 600,
            color: 'var(--text)',
            margin: '0 0 var(--space-1) 0',
          }}
        >
          {item.title}
        </h4>
        <p
          style={{
            fontFamily: 'var(--font-body)',
            fontSize: 'var(--text-sm)',
            color: 'var(--text2)',
            margin: 0,
            lineHeight: 1.4,
          }}
        >
          {item.description}
        </p>
      </div>

      {/* Recommended Action */}
      {item.recommendedAction && (
        <div
          style={{
            padding: 'var(--space-2) var(--space-3)',
            background: 'var(--surface3)',
            borderRadius: 'var(--radius-sm)',
            borderLeft: '2px solid var(--amber)',
            fontSize: 'var(--text-xs)',
            color: 'var(--text)',
          }}
        >
          <span style={{ color: 'var(--amber)', fontWeight: 600 }}>Action Required: </span>
          {item.recommendedAction}
        </div>
      )}

      {/* SLA & Inline Actions */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: 'var(--space-1)',
          borderTop: 'var(--border-width) solid var(--border)',
          paddingTop: 'var(--space-3)',
          flexWrap: 'wrap',
          gap: 'var(--space-2)',
        }}
      >
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-2xs)', color: 'var(--text3)' }}>
          {item.slaExpiresAt ? `SLA: ${item.slaExpiresAt}` : item.createdAt ? `Created: ${item.createdAt}` : ''}
        </div>

        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
          {item.status === 'pending' && onClaim && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClaim();
              }}
              className="btn btn-ghost btn-sm"
            >
              Claim Item
            </button>
          )}

          {onReject && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onReject();
              }}
              className="btn btn-danger btn-sm"
            >
              Reject
            </button>
          )}

          {onApprove && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onApprove();
              }}
              className="btn btn-success btn-sm"
            >
              Approve
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
