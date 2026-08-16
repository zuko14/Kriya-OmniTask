import { useState, useCallback } from 'react';
import { apiFetch, ApiError } from '../../lib/apiClient';
import { useAsync } from '../../lib/useAsync';
import { DataTable, Column } from '../../components/DataTable';
import { AsyncState } from '../../components/AsyncState';
import styles from './BillingSubscription.module.css';

export interface SubscriptionInfo {
  id?: string;
  tenantId: string;
  planTier?: 'starter' | 'growth' | 'enterprise' | 'custom';
  channelPlan?: 'digital_only' | 'voice_only' | 'combined';
  status?: string;
  currentPeriodStart?: string;
  currentPeriodEnd?: string;
}

export interface PlanTierItem {
  id: string;
  name: string;
  tier: string;
  priceMonthlyUsd: number;
  features: string[];
  maxAgents: number;
  maxMonthlyWorkflows: number;
}

export interface InvoiceItem {
  id: string;
  tenant_id: string;
  period_start: string;
  period_end: string;
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  status: string;
  created_at: string;
}

export function BillingSubscription() {
  const [refreshTrigger, setRefreshTrigger] = useState<number>(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [isUpgrading, setIsUpgrading] = useState<boolean>(false);

  const fetchSubscription = useCallback(() => {
    return apiFetch<SubscriptionInfo>('/api/v1/billing/subscription');
  }, [refreshTrigger]);

  const fetchPlans = useCallback(() => {
    return apiFetch<{ count: number; plans: PlanTierItem[] }>('/api/v1/billing/plans');
  }, [refreshTrigger]);

  const fetchInvoices = useCallback(() => {
    return apiFetch<{ count: number; invoices: InvoiceItem[] }>('/api/v1/billing/invoices');
  }, [refreshTrigger]);

  const subState = useAsync(fetchSubscription, [fetchSubscription]);
  const plansState = useAsync(fetchPlans, [fetchPlans]);
  const invoicesState = useAsync(fetchInvoices, [fetchInvoices]);

  const handleSubscribe = async (tier: string) => {
    try {
      setIsUpgrading(true);
      setActionError(null);
      await apiFetch('/api/v1/billing/subscription', {
        method: 'POST',
        body: JSON.stringify({
          planTier: tier,
          channelPlan: 'combined',
        }),
      });
      setActionSuccess(`Plan updated to '${tier.toUpperCase()}'.`);
      setRefreshTrigger((prev) => prev + 1);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Failed to change plan');
    } finally {
      setIsUpgrading(false);
    }
  };

  const subscription = subState.status === 'success' ? subState.data : null;
  const plans = plansState.status === 'success' ? plansState.data.plans : [];
  const invoices = invoicesState.status === 'success' ? invoicesState.data.invoices : [];

  const invoiceColumns: Column<InvoiceItem>[] = [
    {
      key: 'id',
      header: 'Invoice ID',
      render: (inv) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px' }}>{inv.id}</span>,
    },
    {
      key: 'period',
      header: 'Billing Period',
      render: (inv) => (
        <span style={{ fontSize: '12px' }}>
          {new Date(inv.period_start).toLocaleDateString()} – {new Date(inv.period_end).toLocaleDateString()}
        </span>
      ),
    },
    {
      key: 'total_cents',
      header: 'Total Amount',
      width: '130px',
      render: (inv) => <strong>${(inv.total_cents / 100).toFixed(2)}</strong>,
    },
    {
      key: 'status',
      header: 'Status',
      width: '110px',
      render: (inv) => (
        <span
          className={styles.badge}
          style={{
            background: inv.status === 'paid' ? 'rgba(63, 166, 107, 0.15)' : 'rgba(217, 151, 62, 0.15)',
            color: inv.status === 'paid' ? 'var(--color-verify)' : 'var(--color-caution)',
          }}
        >
          {inv.status}
        </span>
      ),
    },
  ];

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.titleGroup}>
          <h1>Subscription, Invoices & Plan Billing</h1>
          <p className={styles.subtitle}>Manage autonomous workforce subscription tier, channels, and invoice receipts.</p>
        </div>
      </header>

      {actionError && <div style={{ color: 'var(--color-critical)', background: 'rgba(216,87,75,0.1)', padding: 'var(--space-3)', borderRadius: 'var(--radius-sm)' }}>⚠️ {actionError}</div>}
      {actionSuccess && <div style={{ color: 'var(--color-verify)', background: 'rgba(63,166,107,0.1)', padding: 'var(--space-3)', borderRadius: 'var(--radius-sm)' }}>✓ {actionSuccess}</div>}

      {/* Current Subscription Card */}
      <div className={styles.currentSubCard}>
        <div>
          <div style={{ fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-ink-muted)' }}>
            Active Subscription
          </div>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '22px', margin: '4px 0 0 0', textTransform: 'capitalize' }}>
            {subscription?.planTier || 'Starter'} Tier ({subscription?.channelPlan?.replace('_', ' ') || 'Combined Omnichannel'})
          </h2>
          <div className={styles.subMeta}>
            <span>Status: <span className={`${styles.badge} ${styles.badgeActive}`}>{subscription?.status || 'Active'}</span></span>
            <span>Tenant ID: <code style={{ fontFamily: 'var(--font-mono)' }}>{subscription?.tenantId}</code></span>
          </div>
        </div>
      </div>

      {/* Available Plan Tiers Grid */}
      <div className={styles.sectionCard}>
        <h2 className={styles.sectionTitle}>Available Workforce Plans</h2>
        <div className={styles.plansGrid}>
          {plans.map((p) => {
            const isCurrent = subscription?.planTier === p.tier;
            return (
              <div key={p.id} className={`${styles.planCard} ${isCurrent ? styles.planCardActive : ''}`}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 className={styles.planTitle}>{p.name}</h3>
                  {isCurrent && <span className={`${styles.badge} ${styles.badgeActive}`}>Current</span>}
                </div>
                <div className={styles.planPrice}>${p.priceMonthlyUsd}<span style={{ fontSize: '13px', fontWeight: 'normal', color: 'var(--color-ink-muted)' }}>/mo</span></div>
                <ul className={styles.planFeatures}>
                  <li>Up to {p.maxAgents} active autonomous agents</li>
                  <li>{p.maxMonthlyWorkflows.toLocaleString()} monthly DAG executions</li>
                  {(p.features || []).map((feat, idx) => (
                    <li key={idx}>{feat}</li>
                  ))}
                </ul>
                <button
                  className={isCurrent ? styles.btnSecondary : styles.btnPrimary}
                  disabled={isCurrent || isUpgrading}
                  onClick={() => handleSubscribe(p.tier)}
                  style={{ marginTop: 'auto' }}
                >
                  {isCurrent ? 'Current Plan' : `Upgrade to ${p.name}`}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Invoices History Table */}
      <div className={styles.sectionCard}>
        <h2 className={styles.sectionTitle}>Invoices & Payment History</h2>
        {invoicesState.status !== 'success' ? (
          <AsyncState status={invoicesState.status === 'loading' ? 'loading' : 'error'} error={invoicesState.error} />
        ) : (
          <DataTable
            columns={invoiceColumns}
            data={invoices}
            keyExtractor={(inv) => inv.id}
            emptyMessage="No invoices generated for this billing account yet."
            ariaLabel="Invoices table"
          />
        )}
      </div>
    </div>
  );
}
