import { useState, useCallback } from 'react';
import { apiFetch } from '../../lib/apiClient';
import { useAsync } from '../../lib/useAsync';
import { DataTable, Column } from '../../components/DataTable';
import { KpiCard } from '../../components/KpiCard';
import { AsyncState } from '../../components/AsyncState';
import styles from './PlatformBilling.module.css';

export interface AdminTenantRecord {
  id: string;
  name: string;
  slug: string;
  status: string;
  plan_tier: string;
  channel_plan: string;
  created_at: string;
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
  total_cents: number;
  status: string;
}

export function PlatformBilling() {
  const [refreshTrigger] = useState<number>(0);

  const fetchTenants = useCallback(() => {
    return apiFetch<{ tenants: AdminTenantRecord[]; count: number }>('/api/v1/admin/tenants');
  }, [refreshTrigger]);

  const fetchPlans = useCallback(() => {
    return apiFetch<{ count: number; plans: PlanTierItem[] }>('/api/v1/billing/plans');
  }, [refreshTrigger]);

  const fetchInvoices = useCallback(() => {
    return apiFetch<{ count: number; invoices: InvoiceItem[] }>('/api/v1/billing/invoices');
  }, [refreshTrigger]);

  const tenantsState = useAsync(fetchTenants, [fetchTenants]);
  const plansState = useAsync(fetchPlans, [fetchPlans]);
  const invoicesState = useAsync(fetchInvoices, [fetchInvoices]);

  const tenants = tenantsState.status === 'success' ? tenantsState.data.tenants : [];
  const plans = plansState.status === 'success' ? plansState.data.plans : [];
  const invoices = invoicesState.status === 'success' ? invoicesState.data.invoices : [];

  // Compute MRR from active tenants
  const planPriceMap: Record<string, number> = {
    starter: 199,
    growth: 499,
    enterprise: 1499,
    custom: 2999,
  };

  plans.forEach((p) => {
    planPriceMap[p.tier] = p.priceMonthlyUsd;
  });

  const activeTenants = tenants.filter((t) => t.status === 'active');
  const totalMrr = activeTenants.reduce((sum, t) => sum + (planPriceMap[t.plan_tier] || 199), 0);
  const arr = totalMrr * 12;
  const enterpriseCount = activeTenants.filter((t) => t.plan_tier === 'enterprise').length;

  const tenantColumns: Column<AdminTenantRecord>[] = [
    {
      key: 'name',
      header: 'Tenant Organization',
      render: (t) => (
        <div>
          <strong>{t.name}</strong>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text2)' }}>{t.id}</div>
        </div>
      ),
    },
    {
      key: 'plan_tier',
      header: 'Subscribed Tier',
      render: (t) => (
        <span style={{ textTransform: 'capitalize', fontSize: '12px' }}>
          {t.plan_tier} ({t.channel_plan?.replace('_', ' ')})
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Account Status',
      width: '120px',
      render: (t) => <span className={`${styles.badge} ${styles.badgeActive}`}>{t.status}</span>,
    },
    {
      key: 'mrr',
      header: 'Monthly Billed',
      width: '130px',
      render: (t) => <strong>${planPriceMap[t.plan_tier] || 199}/mo</strong>,
    },
    {
      key: 'created_at',
      header: 'Subscribed Since',
      width: '130px',
      render: (t) => <span style={{ fontSize: '11px', color: 'var(--text2)' }}>{new Date(t.created_at).toLocaleDateString()}</span>,
    },
  ];

  const invoiceColumns: Column<InvoiceItem>[] = [
    {
      key: 'id',
      header: 'Invoice ID',
      render: (inv) => <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px' }}>{inv.id}</span>,
    },
    {
      key: 'total_cents',
      header: 'Amount',
      width: '130px',
      render: (inv) => <strong>${(inv.total_cents / 100).toFixed(2)}</strong>,
    },
    {
      key: 'status',
      header: 'Payment Status',
      width: '120px',
      render: (inv) => <span className={`${styles.badge} ${styles.badgeActive}`}>{inv.status}</span>,
    },
  ];

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.titleGroup}>
          <h1>Platform Revenue, Subscriptions & Monetization</h1>
          <p className={styles.subtitle}>Cross-tenant recurring revenue analytics, workforce tier catalog, and platform billing operations.</p>
        </div>
      </header>

      {/* Platform Financial KPIs */}
      <div className={styles.kpiGrid}>
        <KpiCard
          title="Projected MRR"
          value={`$${totalMrr.toLocaleString()}`}
        >
          <div style={{ fontSize: '11px', color: 'var(--text2)' }}>Monthly recurring revenue</div>
        </KpiCard>
        <KpiCard
          title="Annual Run-Rate (ARR)"
          value={`$${arr.toLocaleString()}`}
        >
          <div style={{ fontSize: '11px', color: 'var(--text2)' }}>Projected annual volume</div>
        </KpiCard>
        <KpiCard
          title="Active Subscriptions"
          value={String(activeTenants.length)}
        >
          <div style={{ fontSize: '11px', color: 'var(--text2)' }}>Paying tenant organizations</div>
        </KpiCard>
        <KpiCard
          title="Enterprise Contracts"
          value={String(enterpriseCount)}
        >
          <div style={{ fontSize: '11px', color: 'var(--text2)' }}>High-volume workforce fleets</div>
        </KpiCard>
      </div>

      {/* Global Plan Tier Catalog */}
      <div className={styles.sectionCard}>
        <h2 className={styles.sectionTitle}>Workforce Plan Catalog & Quota Tiers</h2>
        <div className={styles.plansGrid}>
          {plans.map((p) => (
            <div key={p.id} className={styles.planCard}>
              <h3 style={{ margin: 0, textTransform: 'capitalize' }}>{p.name}</h3>
              <div className={styles.planPrice}>${p.priceMonthlyUsd}<span style={{ fontSize: '12px', fontWeight: 'normal', color: 'var(--text2)' }}>/mo</span></div>
              <div style={{ fontSize: '12px', color: 'var(--text2)' }}>
                Up to <strong>{p.maxAgents}</strong> agents · <strong>{p.maxMonthlyWorkflows.toLocaleString()}</strong> runs
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Tenant Subscriptions Table */}
      <div className={styles.sectionCard}>
        <h2 className={styles.sectionTitle}>Tenant Subscription Accounts ({tenants.length})</h2>
        {tenantsState.status !== 'success' ? (
          <AsyncState status={tenantsState.status === 'loading' ? 'loading' : 'error'} error={tenantsState.error} />
        ) : (
          <DataTable
            columns={tenantColumns}
            data={tenants}
            keyExtractor={(t) => t.id}
            emptyMessage="No tenant subscriptions active on the platform."
            ariaLabel="Tenant subscriptions table"
          />
        )}
      </div>

      {/* Recent Invoices Table */}
      <div className={styles.sectionCard}>
        <h2 className={styles.sectionTitle}>Platform Invoices & Receipts</h2>
        {invoicesState.status !== 'success' ? (
          <AsyncState status={invoicesState.status === 'loading' ? 'loading' : 'error'} error={invoicesState.error} />
        ) : (
          <DataTable
            columns={invoiceColumns}
            data={invoices}
            keyExtractor={(inv) => inv.id}
            emptyMessage="No billing receipts recorded for current billing period."
            ariaLabel="Platform invoices table"
          />
        )}
      </div>
    </div>
  );
}
