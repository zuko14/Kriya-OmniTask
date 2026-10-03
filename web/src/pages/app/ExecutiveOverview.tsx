import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { MetricBlock } from '../../components/primitives/MetricBlock';
import { EmptyState } from '../../components/primitives/EmptyState';
import { ActivityTheatre } from '../../components/theatre/ActivityTheatre';
import { AsyncState } from '../../components/AsyncState';
import { apiFetch } from '../../lib/apiClient';
import { useAuth } from '../../lib/authContext';
import styles from './ExecutiveOverview.module.css';

/** Server shapes: src/observability/types (ObservabilityMetricsOverview), src/attention/types (AttentionMetricsOverview). */
interface RunMetrics {
  totalTraces: number;
  completedTraces: number;
  failedTraces: number;
  escalatedTraces: number;
}
interface AttentionMetrics {
  pendingCount: number;
  claimedCount: number;
  slaBreachCount: number;
}

type Load<T> = { status: 'loading' } | { status: 'error'; error: unknown } | { status: 'ok'; data: T; readAt: string };

function useMetrics<T>(path: string): Load<T> {
  const [state, setState] = useState<Load<T>>({ status: 'loading' });
  useEffect(() => {
    let live = true;
    apiFetch<T>(path)
      .then((data) => live && setState({ status: 'ok', data, readAt: new Date().toISOString() }))
      .catch((error) => live && setState({ status: 'error', error }));
    return () => {
      live = false;
    };
  }, [path]);
  return state;
}

const fmt = (n: number | null | undefined) => Number(n ?? 0).toLocaleString('en-IN');

/**
 * Today screen (CLAUDE.md §8): every number comes from a tenant-scoped API with its source and read time.
 * Nothing is shown that the backend did not return (S40); sections with no data source say so.
 */
export function ExecutiveOverview() {
  const { auth } = useAuth();
  const navigate = useNavigate();
  const runs = useMetrics<RunMetrics>('/api/v1/observability/metrics');
  const attention = useMetrics<AttentionMetrics>('/api/v1/attention/metrics');

  return (
    <div className={styles.container}>
      <h1>Today · Executive Overview</h1>

      {auth && <ActivityTheatre tenantId={auth.tenant.id} />}

      <section className={`${styles.metricsRow} stagger`} aria-label="Key operational metrics">
        {runs.status === 'ok' ? (
          <>
            <MetricBlock
              label="Completed runs"
              value={fmt(runs.data.completedTraces)}
              source={`execution_traces · ${fmt(runs.data.totalTraces)} total · all time`}
              timestamp={`read ${new Date(runs.readAt).toLocaleTimeString()}`}
            />
            <MetricBlock
              label="Failed or escalated runs"
              value={fmt(runs.data.failedTraces + runs.data.escalatedTraces)}
              source={`execution_traces · ${fmt(runs.data.failedTraces)} failed · ${fmt(runs.data.escalatedTraces)} escalated · all time`}
              timestamp={`read ${new Date(runs.readAt).toLocaleTimeString()}`}
            />
          </>
        ) : (
          <div className={styles.span2}>
            <AsyncState status={runs.status === 'loading' ? 'loading' : 'error'} error={runs.status === 'error' ? runs.error : undefined} />
          </div>
        )}

        {attention.status === 'ok' ? (
          <>
            <MetricBlock
              label="Needs you (attention)"
              value={fmt(attention.data.pendingCount)}
              source={`attention_items · pending · ${fmt(attention.data.claimedCount)} claimed`}
              timestamp={`read ${new Date(attention.readAt).toLocaleTimeString()}`}
              onDrill={() => navigate('/app/attention')}
            />
            <MetricBlock
              label="SLA breaches"
              value={fmt(attention.data.slaBreachCount)}
              source="attention_items · past SLA · all time"
              timestamp={`read ${new Date(attention.readAt).toLocaleTimeString()}`}
              onDrill={() => navigate('/app/attention')}
            />
          </>
        ) : (
          <div className={styles.span2}>
            <AsyncState status={attention.status === 'loading' ? 'loading' : 'error'} error={attention.status === 'error' ? attention.error : undefined} />
          </div>
        )}
      </section>

      <EmptyState
        title="Customers, bookings, funnel and response-time trend"
        message="These need tenant-scoped analytics endpoints that do not exist yet. They will appear here once their data sources are built; nothing is estimated in the meantime."
      />
    </div>
  );
}
