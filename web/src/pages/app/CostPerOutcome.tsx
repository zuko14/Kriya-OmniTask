import { useState } from 'react';
import { apiFetch } from '../../lib/apiClient';
import { useAsync } from '../../lib/useAsync';
import { AsyncState } from '../../components/AsyncState';
import { DataTable, Column } from '../../components/DataTable';
import { MetricBlock } from '../../components/primitives/MetricBlock';
import styles from './TrustScreens.module.css';

/** Server shape: src/outcomes/types/outcomeKpiTypes.ts (CostPerOutcomeReport). */
interface LevelStats { level: string; count: number; percentage: number; costUsd: number }
interface Report {
  window: string;
  periodStart: string;
  periodEnd: string;
  overallCostPerOutcomeUsd: number | null;
  totalCostUsd: number;
  verifiedOutcomesCount: number;
  byWorkflow: Array<{ workflowId: string; name: string; outcomesCount: number; totalCostUsd: number; costPerOutcomeUsd: number | null; verifiedActionRate: number | null }>;
  byAgent: Array<{ agentId: string; name: string; outcomesCount: number; totalCostUsd: number; costPerOutcomeUsd: number | null; toolReliability: number | null }>;
  byModel: Array<{ modelId: string; callsCount: number; totalCostUsd: number; tokensInput: number; tokensOutput: number; avgLatencyMs: number | null }>;
  cascadeMix: { totalInvocations: number; levels: Record<string, LevelStats>; estimatedSavingsUsd: number };
}

const WINDOWS = ['24h', '7d', '30d'] as const;
const usd = (n: number | null | undefined) => `$${Number(n ?? 0).toFixed(3)}`;
const LEVEL_LABEL: Record<string, string> = {
  L0_rule: 'L0 · rule',
  L1_cache: 'L1 · cache',
  L2_fast_model: 'L2 · fast model',
  L3_reasoning_model: 'L3 · reasoning model',
  human_review: 'Human review',
};

/**
 * Cost per verified business outcome (04_UI_UX_KRIYA_DESIGN.md §4, WP-6.1 data).
 * Per-workflow figures count verified outcomes only (S55 fixed in the backend); — where nothing was verified.
 */
export function CostPerOutcome() {
  const [window, setWindow] = useState<(typeof WINDOWS)[number]>('24h');
  const report = useAsync(() => apiFetch<Report>(`/api/v1/outcomes/cost-per-outcome?window=${window}`), [window]);

  const agentColumns: Column<Report['byAgent'][number]>[] = [
    { key: 'name', header: 'Agent' },
    { key: 'outcomesCount', header: 'Achieved outcomes' },
    { key: 'totalCostUsd', header: 'Cost', render: (a) => usd(a.totalCostUsd) },
    { key: 'costPerOutcomeUsd', header: 'Cost / outcome', render: (a) => (a.costPerOutcomeUsd === null ? '—' : usd(a.costPerOutcomeUsd)) },
    { key: 'toolReliability', header: 'Tool success', render: (a) => (a.toolReliability === null ? '—' : `${a.toolReliability}%`) },
  ];
  const modelColumns: Column<Report['byModel'][number]>[] = [
    { key: 'modelId', header: 'Model / provider', render: (m) => <span className={styles.mono}>{m.modelId}</span> },
    { key: 'callsCount', header: 'Calls' },
    { key: 'totalCostUsd', header: 'Cost', render: (m) => usd(m.totalCostUsd) },
    { key: 'tokens', header: 'Tokens in / out', render: (m) => `${m.tokensInput.toLocaleString()} / ${m.tokensOutput.toLocaleString()}` },
    { key: 'avgLatencyMs', header: 'Avg latency', render: (m) => (m.avgLatencyMs === null || m.avgLatencyMs <= 0 ? '—' : `${m.avgLatencyMs} ms`) },
  ];

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>Cost per Outcome</h1>
          <p className={styles.subtitle}>What each verified business outcome cost, by agent, model and cascade level. Unverified work is never counted as an outcome.</p>
        </div>
        <div className="segmented" role="group" aria-label="Time window">
          {WINDOWS.map((w) => (
            <button key={w} type="button" aria-pressed={window === w} onClick={() => setWindow(w)}>
              {w}
            </button>
          ))}
        </div>
      </header>

      {report.status !== 'success' ? (
        <AsyncState status={report.status} error={report.error} />
      ) : (
        <>
          <section className={styles.stats} aria-label="Totals">
            <MetricBlock
              label="Cost per verified outcome"
              value={report.data?.overallCostPerOutcomeUsd === null || report.data?.overallCostPerOutcomeUsd === undefined ? 'No verified outcomes' : usd(report.data.overallCostPerOutcomeUsd)}
              source={`cost_records ÷ verified outcomes · ${report.data?.window || 'current'}`}
              timestamp={report.data?.periodEnd ? `to ${new Date(report.data.periodEnd).toLocaleString()}` : 'live'}
            />
            <MetricBlock label="Total cost" value={usd(report.data?.totalCostUsd)} source={`cost_records · ${report.data?.window || 'current'}`} timestamp={report.data?.periodEnd ? `to ${new Date(report.data.periodEnd).toLocaleString()}` : 'live'} />
            <MetricBlock
              label="Verified outcomes"
              value={(report.data?.verifiedOutcomesCount ?? 0).toLocaleString()}
              source="proof receipts verified + achieved outcomes"
              timestamp={report.data?.periodEnd ? `to ${new Date(report.data.periodEnd).toLocaleString()}` : 'live'}
            />
          </section>

          <section className="card" aria-label="By agent">
            <h2>By agent</h2>
            <DataTable columns={agentColumns} data={report.data?.byAgent ?? []} keyExtractor={(a) => a.agentId} emptyMessage="No agent cost recorded in this window." ariaLabel="Cost by agent" />
          </section>

          <section className="card" aria-label="Cascade mix">
            <h2>Cascade level mix</h2>
            {(report.data?.cascadeMix?.totalInvocations ?? 0) === 0 ? (
              <p className={styles.note}>No cascade invocations recorded in this window.</p>
            ) : (
              <>
                <DataTable
                  columns={[
                    { key: 'level', header: 'Level', render: (l: LevelStats) => LEVEL_LABEL[l.level] ?? l.level },
                    { key: 'count', header: 'Invocations' },
                    { key: 'percentage', header: 'Share', render: (l: LevelStats) => `${l.percentage}%` },
                    { key: 'costUsd', header: 'Cost', render: (l: LevelStats) => usd(l.costUsd) },
                  ]}
                  data={Object.values(report.data?.cascadeMix?.levels ?? {})}
                  keyExtractor={(l) => l.level}
                  ariaLabel="Cascade level mix"
                />
                <p className={styles.note}>
                  Estimated saving versus sending every request to L3: {usd(report.data?.cascadeMix?.estimatedSavingsUsd)} — an estimate against a modelled baseline, not a measured saving.
                </p>
              </>
            )}
          </section>

          <section className="card" aria-label="By model">
            <h2>By model</h2>
            <DataTable columns={modelColumns} data={report.data?.byModel ?? []} keyExtractor={(m) => m.modelId} emptyMessage="No model calls recorded in this window." ariaLabel="Cost by model" />
          </section>

          <section className="card" aria-label="By workflow">
            <h2>By workflow</h2>
            <DataTable
              columns={[
                { key: 'name', header: 'Workflow' },
                { key: 'outcomesCount', header: 'Verified outcomes' },
                { key: 'totalCostUsd', header: 'Cost', render: (w: Report['byWorkflow'][number]) => usd(w.totalCostUsd) },
                { key: 'costPerOutcomeUsd', header: 'Cost / outcome', render: (w: Report['byWorkflow'][number]) => (w.costPerOutcomeUsd === null ? '—' : usd(w.costPerOutcomeUsd)) },
                { key: 'verifiedActionRate', header: 'Verified-action rate', render: (w: Report['byWorkflow'][number]) => (w.verifiedActionRate === null ? '—' : `${w.verifiedActionRate}%`) },
              ]}
              data={report.data?.byWorkflow ?? []}
              keyExtractor={(w) => w.workflowId}
              emptyMessage="No workflow cost recorded in this window."
              ariaLabel="Cost by workflow"
            />
          </section>
        </>
      )}
    </div>
  );
}
