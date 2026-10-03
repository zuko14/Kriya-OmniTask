import { useEffect, useState } from 'react';
import { apiFetch, ApiError } from '../lib/apiClient';
import { Icon } from './brand/Icon';
import { TraceStep as TraceStepComponent, TraceStepEvidence } from './primitives/TraceStep';
import styles from './DecisionTraceDrawer.module.css';

export interface TraceStepData {
  stepNumber: number;
  timestamp: string;
  level: string;
  actor: string;
  actorRole?: string;
  action: string;
  failureClass?: string;
  remediationAttempted?: string;
  outcome: 'success' | 'failure' | 'escalated' | 'stopped';
  evidence: Record<string, unknown>;
  reason?: string;
  durationMs: number;
  costUsd: number;
  trustTier?: 'A' | 'B' | 'C' | 'D' | 'E';
  skills?: string[];
  tokens?: number;
}

export interface EscalationTrace {
  id: string;
  tenantId: string;
  taskId: string;
  correlationId: string;
  currentLevel: string;
  status: string;
  totalAttempts: number;
  totalDurationMs: number;
  totalCostUsd: number;
  steps: TraceStepData[];
  attentionItemId?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface DecisionTraceDrawerProps {
  taskId: string;
  onClose: () => void;
}

export function DecisionTraceDrawer({ taskId, onClose }: DecisionTraceDrawerProps) {
  const [trace, setTrace] = useState<EscalationTrace | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    async function loadTrace() {
      try {
        setLoading(true);
        setError(null);
        const res = await apiFetch<{ success: boolean; trace: EscalationTrace }>(
          `/api/v1/escalation/traces/${encodeURIComponent(taskId)}`
        );
        if (isMounted) {
          setTrace(res.trace);
        }
      } catch (err: unknown) {
        // Never substitute a synthetic trace: an operator must not see "verified" for a run
        // that could not be loaded (verified-or-not-done; S44).
        if (isMounted) {
          setTrace(null);
          setError(
            err instanceof ApiError && err.statusCode === 404
              ? 'No decision trace is recorded for this task.'
              : err instanceof ApiError && err.statusCode === 403
                ? "Access denied — you don't have permission to view this trace."
                : 'Could not load the decision trace. No trace is shown in its place.'
          );
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    loadTrace();
    return () => {
      isMounted = false;
    };
  }, [taskId]);

  return (
    <div className={styles.overlay} onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="trace-drawer-title">
      <div className={styles.drawer} onClick={(e) => e.stopPropagation()}>
        <header className={styles.header}>
          <div className={styles.titleGroup}>
            <div className={styles.title} id="trace-drawer-title">
              <span>TRACE</span>
              <span style={{ color: 'var(--purple)' }}>{taskId}</span>
            </div>
            <div className={styles.subtitle}>
              Unified Specialist → Supervisor → Orchestrator → Attention Chain (§5, §18.5)
            </div>
          </div>
          <button className={styles.closeButton} onClick={onClose} aria-label="Close trace drawer">
            <Icon name="close" />
          </button>
        </header>

        <div className={styles.body}>
          {loading && <div style={{ color: 'var(--text3)' }}>Loading decision trace…</div>}
          {error && (
            <div className="alert alert-err" role="alert">
              {error}
            </div>
          )}

          {trace && (
            <>
              <div className={styles.metaStrip}>
                <div className={styles.metaItem}>
                  <span className={styles.metaLabel}>Current Level</span>
                  <span className={styles.metaValue} style={{ textTransform: 'capitalize' }}>
                    {trace.currentLevel}
                  </span>
                </div>
                <div className={styles.metaItem}>
                  <span className={styles.metaLabel}>Total Cost</span>
                  <span className={styles.metaValue}>${trace.totalCostUsd.toFixed(4)}</span>
                </div>
                <div className={styles.metaItem}>
                  <span className={styles.metaLabel}>Total Duration</span>
                  <span className={styles.metaValue}>{trace.totalDurationMs}ms</span>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
                {trace.steps.map((step) => {
                  // An outcome the console doesn't know is shown as needing attention, never as success.
                  const statusMap: Record<string, 'succeeded' | 'failed' | 'escalated' | 'blocked'> = {
                    success: 'succeeded',
                    failure: 'failed',
                    escalated: 'escalated',
                    stopped: 'blocked',
                  };

                  const traceEvidence: TraceStepEvidence[] = Object.entries(step.evidence || {}).map(([key, val]) => ({
                    text: `${key}: ${String(val)}`,
                    source: String((step.evidence as any)?.source || 'ledger'),
                    trustTier: step.trustTier,
                  }));

                  return (
                    <TraceStepComponent
                      key={step.stepNumber}
                      stepNumber={step.stepNumber}
                      timestamp={step.timestamp}
                      actor={`${step.actor} (${(step.actorRole || step.level).toUpperCase()})`}
                      action={step.action}
                      status={statusMap[step.outcome] ?? 'escalated'}
                      trustTier={step.trustTier}
                      inputSummary={step.reason || `Action executed: ${step.action}`}
                      outputSummary={step.skills ? `Skills executed: ${step.skills.join(' · ')}` : undefined}
                      latencyMs={step.durationMs}
                      tokens={step.tokens}
                      evidence={traceEvidence}
                    />
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
