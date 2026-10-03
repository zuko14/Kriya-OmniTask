import React, { useState } from 'react';
import { StateDot, SignalState } from './StateDot';
import { EvidenceLink } from './EvidenceLink';

export interface TraceStepEvidence {
  text: string;
  source: string;
  trustTier?: 'A' | 'B' | 'C' | 'D' | 'E';
  sourceUrl?: string;
}

export interface TraceStepProps {
  stepNumber: number;
  timestamp: string;
  actor: string;
  actorRole?: string;
  action: string;
  status: 'succeeded' | 'failed' | 'delegated' | 'escalated' | 'blocked' | 'in_progress';
  trustTier?: 'A' | 'B' | 'C' | 'D' | 'E';
  inputSummary?: string;
  outputSummary?: string;
  latencyMs?: number;
  tokens?: number;
  evidence?: TraceStepEvidence[];
  style?: React.CSSProperties;
  className?: string;
}

export function TraceStep({
  stepNumber,
  timestamp,
  actor,
  actorRole,
  action,
  status,
  trustTier,
  inputSummary,
  outputSummary,
  latencyMs,
  tokens,
  evidence = [],
  style = {},
  className = '',
}: TraceStepProps) {
  const [expanded, setExpanded] = useState(false);

  const statusToSignalMap: Record<string, SignalState> = {
    succeeded: 'live',
    failed: 'halt',
    delegated: 'info',
    escalated: 'attention',
    blocked: 'halt',
    in_progress: 'learning',
  };

  const signalState = statusToSignalMap[status] || 'info';

  return (
    <div
      className={`trace-step-container ${className}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--surface2)',
        border: 'var(--border-width) solid var(--border)',
        borderRadius: 'var(--radius)',
        padding: 'var(--space-3) var(--space-4)',
        gap: 'var(--space-2)',
        ...style,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-xs)',
              fontWeight: 600,
              color: 'var(--text3)',
              background: 'var(--surface2)',
              padding: '1px var(--space-2)',
              borderRadius: 'var(--radius-sm)',
            }}
          >
            #{stepNumber}
          </span>
          <StateDot state={signalState} size="sm" pulse={status === 'in_progress'} />
          <span
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'var(--text-sm)',
              fontWeight: 600,
              color: 'var(--text)',
            }}
          >
            {actor}
          </span>
          {actorRole && (
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text2)' }}>
              ({actorRole})
            </span>
          )}
          <span style={{ color: 'var(--border2)' }}>·</span>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-xs)',
              color: 'var(--accent)',
            }}
          >
            {action}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          {trustTier && (
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--text-2xs)',
                color: trustTier === 'C' || trustTier === 'D' ? 'var(--cyan)' : 'var(--text2)',
                background: trustTier === 'C' || trustTier === 'D' ? 'var(--cyan-bg)' : 'var(--surface2)',
                padding: '1px var(--space-2)',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              TIER_{trustTier}
            </span>
          )}
          {latencyMs !== undefined && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-2xs)', color: 'var(--text3)' }}>
              {latencyMs}ms
            </span>
          )}
          {tokens !== undefined && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-2xs)', color: 'var(--text3)' }}>
              {tokens} tok
            </span>
          )}
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--text3)' }}>
            {timestamp}
          </span>
        </div>
      </div>

      {/* Summaries & Evidence */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', marginTop: 'var(--space-1)' }}>
        {outputSummary && (
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text)', lineHeight: 1.4 }}>
            {outputSummary}
          </div>
        )}

        {inputSummary && (
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text2)' }}>
            <span style={{ color: 'var(--text3)', fontWeight: 500 }}>Input: </span>
            {inputSummary}
          </div>
        )}

        {evidence.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
            {evidence.map((ev, idx) => (
              <EvidenceLink
                key={idx}
                text={ev.text}
                source={ev.source}
                trustTier={ev.trustTier}
                href={ev.sourceUrl}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
