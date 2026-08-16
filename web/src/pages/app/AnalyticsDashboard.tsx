import { useState, useCallback } from 'react';
import { apiFetch, ApiError } from '../../lib/apiClient';
import { useAsync } from '../../lib/useAsync';
import { DataTable, Column } from '../../components/DataTable';
import { AsyncState } from '../../components/AsyncState';
import styles from './AnalyticsDashboard.module.css';

export interface SpendSummary {
  totalCostUsd: number;
  byCategory: Record<string, number>;
  byProvider: Record<string, number>;
  period: string;
}

export interface UnitEconomicItem {
  outcomeType: string;
  totalCount: number;
  totalValueUsd: number;
  totalCostUsd: number;
  roiMultiplier: number;
  costPerOutcomeUsd: number;
}

export interface BudgetPolicy {
  monthlyBudgetLimitUsd: number;
  currentMonthSpendUsd: number;
  isCircuitBreakerTripped: boolean;
  alertThresholdPct: number;
}

export function AnalyticsDashboard() {
  const [refreshTrigger, setRefreshTrigger] = useState<number>(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [isResetting, setIsResetting] = useState<boolean>(false);

  const fetchSummary = useCallback(() => {
    return apiFetch<SpendSummary>('/api/v1/cost/summary');
  }, [refreshTrigger]);

  const fetchEconomics = useCallback(() => {
    return apiFetch<{ economics: UnitEconomicItem[] }>('/api/v1/cost/outcomes/unit-economics');
  }, [refreshTrigger]);

  const fetchBudget = useCallback(() => {
    return apiFetch<BudgetPolicy>('/api/v1/cost/budget');
  }, [refreshTrigger]);

  const summaryState = useAsync(fetchSummary, [fetchSummary]);
  const economicsState = useAsync(fetchEconomics, [fetchEconomics]);
  const budgetState = useAsync(fetchBudget, [fetchBudget]);

  const handleResetCircuit = async () => {
    try {
      setIsResetting(true);
      setActionError(null);
      await apiFetch('/api/v1/cost/budget/reset-circuit', { method: 'POST' });
      setActionSuccess('Budget circuit breaker successfully reset.');
      setRefreshTrigger((prev) => prev + 1);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Failed to reset circuit breaker');
    } finally {
      setIsResetting(false);
    }
  };

  const summary = summaryState.status === 'success' ? summaryState.data : null;
  const economics = economicsState.status === 'success' ? economicsState.data.economics : [];
  const budget = budgetState.status === 'success' ? budgetState.data : null;

  // Calculate total outcome value
  const totalOutcomeValue = economics.reduce((acc, curr) => acc + (curr.totalValueUsd || 0), 0);
  const totalSpend = summary?.totalCostUsd || 0;
  const netRoi = totalSpend > 0 ? (totalOutcomeValue / totalSpend).toFixed(2) : 'N/A';

  const categoryEntries = Object.entries(summary?.byCategory || {});
  const maxCategorySpend = Math.max(...categoryEntries.map(([, v]) => v), 0.01);

  const providerEntries = Object.entries(summary?.byProvider || {});
  const maxProviderSpend = Math.max(...providerEntries.map(([, v]) => v), 0.01);

  const economicsColumns: Column<UnitEconomicItem>[] = [
    {
      key: 'outcomeType',
      header: 'Business Outcome',
      render: (e) => <strong style={{ textTransform: 'capitalize' }}>{e.outcomeType.replace(/_/g, ' ')}</strong>,
    },
    {
      key: 'totalCount',
      header: 'Volume Completed',
      width: '150px',
      render: (e) => <span>{e.totalCount.toLocaleString()} units</span>,
    },
    {
      key: 'costPerOutcomeUsd',
      header: 'Cost / Unit',
      width: '120px',
      render: (e) => <span style={{ fontFamily: 'var(--font-mono)' }}>${e.costPerOutcomeUsd.toFixed(3)}</span>,
    },
    {
      key: 'totalValueUsd',
      header: 'Value Generated',
      width: '140px',
      render: (e) => <span style={{ color: 'var(--color-verify)', fontWeight: 600 }}>${e.totalValueUsd.toFixed(2)}</span>,
    },
    {
      key: 'roiMultiplier',
      header: 'Outcome ROI',
      width: '120px',
      render: (e) => <span className={`${styles.badge} ${styles.badgeRoi}`}>{e.roiMultiplier.toFixed(1)}x</span>,
    },
  ];

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.titleGroup}>
          <h1>Cost Intelligence & Business Outcome Analytics</h1>
          <p className={styles.subtitle}>Granular agent cost attribution, compute ROI, and autonomous unit economics.</p>
        </div>
      </header>

      {actionError && <div style={{ color: 'var(--color-critical)', background: 'rgba(216,87,75,0.1)', padding: 'var(--space-3)', borderRadius: 'var(--radius-sm)' }}>⚠️ {actionError}</div>}
      {actionSuccess && <div style={{ color: 'var(--color-verify)', background: 'rgba(63,166,107,0.1)', padding: 'var(--space-3)', borderRadius: 'var(--radius-sm)' }}>✓ {actionSuccess}</div>}

      {/* Top Metrics Strip */}
      <div className={styles.metricsGrid}>
        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>Total Spend</span>
          <span className={styles.metricValue}>${totalSpend.toFixed(2)}</span>
        </div>
        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>Value Delivered</span>
          <span className={styles.metricValue} style={{ color: 'var(--color-verify)' }}>${totalOutcomeValue.toFixed(2)}</span>
        </div>
        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>Net ROI Multiplier</span>
          <span className={styles.metricValue} style={{ color: 'var(--color-signal)' }}>{netRoi}x</span>
        </div>
        <div className={styles.metricCard}>
          <span className={styles.metricLabel}>Active Period</span>
          <span className={styles.metricValue} style={{ fontSize: '16px', fontWeight: 600 }}>{summary?.period || 'All-time'}</span>
        </div>
      </div>

      {/* Budget & Circuit Breaker Status */}
      {budget && (
        <div className={`${styles.card} ${budget.isCircuitBreakerTripped ? styles.budgetCardTripped : styles.budgetCardSafe}`}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
            <div>
              <h2 className={styles.cardTitle}>
                {budget.isCircuitBreakerTripped ? '🚨 Circuit Breaker Tripped (Hard Spend Cap Reached)' : '🛡️ Budget Circuit Breaker Active'}
              </h2>
              <div style={{ fontSize: '13px', color: 'var(--color-ink-muted)', marginTop: '2px' }}>
                Monthly Spend: <strong>${budget.currentMonthSpendUsd?.toFixed(2) || '0.00'}</strong> / Limit: <strong>${budget.monthlyBudgetLimitUsd?.toFixed(2) || 'Unlimited'}</strong> (Alert threshold: {budget.alertThresholdPct}%)
              </div>
            </div>
            {budget.isCircuitBreakerTripped && (
              <button className={styles.btnPrimary} onClick={handleResetCircuit} disabled={isResetting}>
                {isResetting ? 'Resetting...' : 'Reset Circuit Breaker'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Breakdown Charts Grid */}
      <div className={styles.chartsGrid}>
        {/* Category Spend Breakdown */}
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Spend by Cost Category</h2>
          {categoryEntries.length === 0 ? (
            <div style={{ color: 'var(--color-ink-muted)', fontSize: '13px' }}>No category spend recorded yet.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              {categoryEntries.map(([cat, val]) => {
                const pct = ((val / maxCategorySpend) * 100).toFixed(0);
                return (
                  <div key={cat} className={styles.barChartRow}>
                    <div className={styles.barChartHeader}>
                      <span style={{ textTransform: 'capitalize' }}>{cat.replace(/_/g, ' ')}</span>
                      <strong>${val.toFixed(3)}</strong>
                    </div>
                    <div className={styles.barChartTrack}>
                      <div className={styles.barChartFill} style={{ width: `${pct}%`, background: 'var(--color-signal)' }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Provider Spend Breakdown */}
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Spend by Model Provider</h2>
          {providerEntries.length === 0 ? (
            <div style={{ color: 'var(--color-ink-muted)', fontSize: '13px' }}>No provider spend recorded yet.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              {providerEntries.map(([prov, val]) => {
                const pct = ((val / maxProviderSpend) * 100).toFixed(0);
                return (
                  <div key={prov} className={styles.barChartRow}>
                    <div className={styles.barChartHeader}>
                      <span style={{ textTransform: 'capitalize' }}>{prov}</span>
                      <strong>${val.toFixed(3)}</strong>
                    </div>
                    <div className={styles.barChartTrack}>
                      <div className={styles.barChartFill} style={{ width: `${pct}%`, background: 'var(--color-verify)' }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Business Outcome Unit Economics Table */}
      <div className={styles.card}>
        <h2 className={styles.cardTitle}>Business Outcome Unit Economics</h2>
        {economicsState.status !== 'success' ? (
          <AsyncState status={economicsState.status === 'loading' ? 'loading' : 'error'} error={economicsState.error} />
        ) : (
          <DataTable
            columns={economicsColumns}
            data={economics}
            keyExtractor={(e) => e.outcomeType}
            emptyMessage="No business outcome events recorded yet."
            ariaLabel="Unit economics table"
          />
        )}
      </div>
    </div>
  );
}
