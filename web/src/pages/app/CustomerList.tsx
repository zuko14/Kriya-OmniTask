import { useState, useCallback } from 'react';
import { Link } from 'react-router';
import { apiFetch, ApiError } from '../../lib/apiClient';
import { useAsync } from '../../lib/useAsync';
import { DataTable, Column } from '../../components/DataTable';
import { AsyncState } from '../../components/AsyncState';
import styles from './CustomerList.module.css';

export interface Customer {
  id: string;
  full_name: string;
  name?: string;
  primary_email?: string;
  primary_phone?: string;
  preferred_channel: string;
  preferred_language: string;
  lifecycle_stage: string;
  sentiment_score: number;
  churn_risk_score: number;
  status: string;
  created_at: string;
}

export function CustomerList() {
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [stageFilter, setStageFilter] = useState<string>('all');
  const [refreshTrigger, setRefreshTrigger] = useState<number>(0);
  const [actionError, setActionError] = useState<string | null>(null);

  // New Customer Modal
  const [isCreating, setIsCreating] = useState<boolean>(false);
  const [fullName, setFullName] = useState<string>('');
  const [primaryEmail, setPrimaryEmail] = useState<string>('');
  const [primaryPhone, setPrimaryPhone] = useState<string>('');
  const [preferredChannel, setPreferredChannel] = useState<'whatsapp' | 'voice' | 'email' | 'web'>('whatsapp');
  const [lifecycleStage, setLifecycleStage] = useState<string>('lead');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const fetchCustomers = useCallback(() => {
    const params = new URLSearchParams();
    if (searchQuery.trim()) params.set('q', searchQuery.trim());
    if (stageFilter !== 'all') params.set('lifecycleStage', stageFilter);
    params.set('limit', '50');
    return apiFetch<{ customers: Customer[]; total: number }>(`/api/v1/customers?${params.toString()}`);
  }, [searchQuery, stageFilter, refreshTrigger]);

  const state = useAsync(fetchCustomers, [fetchCustomers]);

  const handleCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsSubmitting(true);
      setActionError(null);
      await apiFetch('/api/v1/customers', {
        method: 'POST',
        body: JSON.stringify({
          fullName,
          primaryEmail: primaryEmail || undefined,
          primaryPhone: primaryPhone || undefined,
          preferredChannel,
          lifecycleStage,
        }),
      });
      setIsCreating(false);
      setFullName('');
      setPrimaryEmail('');
      setPrimaryPhone('');
      setRefreshTrigger((prev) => prev + 1);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Failed to create customer');
    } finally {
      setIsSubmitting(false);
    }
  };

  const columns: Column<Customer>[] = [
    {
      key: 'full_name',
      header: 'Customer',
      render: (c) => (
        <div>
          <Link to={`/app/customers/${c.id}`} style={{ color: 'var(--accent)', fontWeight: 600, textDecoration: 'none' }}>
            {c.full_name || c.name || c.id}
          </Link>
          <div style={{ fontSize: '11px', color: 'var(--text2)', fontFamily: 'var(--font-mono)' }}>
            ID: {c.id}
          </div>
        </div>
      ),
    },
    {
      key: 'contact',
      header: 'Contact Info',
      render: (c) => (
        <div style={{ fontSize: '12px' }}>
          <div>{c.primary_email || '—'}</div>
          <div style={{ color: 'var(--text2)', fontFamily: 'var(--font-mono)', fontSize: '11px' }}>
            {c.primary_phone || ''}
          </div>
        </div>
      ),
    },
    {
      key: 'channel',
      header: 'Preferred Channel',
      width: '130px',
      render: (c) => (
        <span style={{ textTransform: 'capitalize', fontSize: '12px' }}>
          {c.preferred_channel || 'email'} ({(c.preferred_language || 'en').toUpperCase()})
        </span>
      ),
    },
    {
      key: 'lifecycle_stage',
      header: 'Lifecycle Stage',
      width: '130px',
      render: (c) => {
        const stageClass =
          c.lifecycle_stage === 'active' || c.lifecycle_stage === 'customer'
            ? styles.stageActive
            : c.lifecycle_stage === 'at_risk'
            ? styles.stageRisk
            : c.lifecycle_stage === 'churned'
            ? styles.stageChurned
            : styles.stageLead;
        return <span className={`${styles.badge} ${stageClass}`}>{(c.lifecycle_stage || 'lead').replace('_', ' ')}</span>;
      },
    },
    {
      key: 'signals',
      header: 'Signals',
      width: '120px',
      render: (c) => (
        <div style={{ fontSize: '11px', color: 'var(--text2)' }}>
          <div>Sentiment: <strong style={{ color: (c.sentiment_score ?? 0.8) >= 0.7 ? 'var(--green)' : 'var(--text)' }}>{(c.sentiment_score ?? 0.8).toFixed(2)}</strong></div>
          <div>Risk: <strong style={{ color: (c.churn_risk_score ?? 0.1) > 0.5 ? 'var(--red)' : 'var(--green)' }}>{(c.churn_risk_score ?? 0.1).toFixed(2)}</strong></div>
        </div>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      width: '100px',
      render: (c) => (
        <Link to={`/app/customers/${c.id}`} className="btn btn-ghost btn-sm">
          View 360 →
        </Link>
      ),
    },
  ];

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.titleGroup}>
          <h1>Customer 360 Directory</h1>
          <p className={styles.subtitle}>Unified customer profiles, deterministic identity resolution, and relationship intelligence.</p>
        </div>
        <button className="btn btn-accent" onClick={() => setIsCreating(true)}>
          + Add Customer
        </button>
      </header>

      {actionError && <div className="alert alert-err" role="alert">{actionError}</div>}

      <div className={styles.controlsBar}>
        <div className={styles.searchGroup}>
          <input
            type="text"
            className={styles.searchInput}
            placeholder="Search by name, email, or phone..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Search customers"
          />
          <select
            className={styles.select}
            value={stageFilter}
            onChange={(e) => setStageFilter(e.target.value)}
            aria-label="Filter by lifecycle stage"
          >
            <option value="all">All Lifecycle Stages</option>
            <option value="lead">Lead</option>
            <option value="qualified">Qualified</option>
            <option value="opportunity">Opportunity</option>
            <option value="customer">Customer</option>
            <option value="active">Active</option>
            <option value="at_risk">At Risk</option>
            <option value="churned">Churned</option>
            <option value="win_back">Win Back</option>
          </select>
        </div>
      </div>

      {state.status !== 'success' ? (
        <AsyncState
          status={state.status === 'loading' ? 'loading' : 'error'}
          error={state.error}
        />
      ) : (
        <DataTable
          columns={columns}
          data={state.data.customers}
          keyExtractor={(c) => c.id}
          emptyMessage="No customer profiles found matching criteria."
          ariaLabel="Customer directory table"
        />
      )}

      {/* New Customer Modal */}
      {isCreating && (
        <div className={styles.modalBackdrop} role="dialog" aria-modal="true" aria-labelledby="create-customer-title">
          <div className={styles.modal}>
            <h2 className={styles.modalTitle} id="create-customer-title">New Customer Profile</h2>
            <form className={styles.modalForm} onSubmit={handleCreateCustomer}>
              <div className={styles.formField}>
                <label className={styles.formLabel} htmlFor="cust-name-input">Full Name *</label>
                <input
                  id="cust-name-input"
                  type="text"
                  required
                  className={styles.formInput}
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="e.g. Elena Rostova"
                />
              </div>

              <div className={styles.formField}>
                <label className={styles.formLabel} htmlFor="cust-email-input">Primary Email</label>
                <input
                  id="cust-email-input"
                  type="email"
                  className={styles.formInput}
                  value={primaryEmail}
                  onChange={(e) => setPrimaryEmail(e.target.value)}
                  placeholder="elena@example.com"
                />
              </div>

              <div className={styles.formField}>
                <label className={styles.formLabel} htmlFor="cust-phone-input">Primary Phone (E.164)</label>
                <input
                  id="cust-phone-input"
                  type="tel"
                  className={styles.formInput}
                  value={primaryPhone}
                  onChange={(e) => setPrimaryPhone(e.target.value)}
                  placeholder="+14155552671"
                />
              </div>

              <div className={styles.formField}>
                <label className={styles.formLabel} htmlFor="cust-channel-select">Preferred Channel</label>
                <select
                  id="cust-channel-select"
                  className={styles.select}
                  value={preferredChannel}
                  onChange={(e) => setPreferredChannel(e.target.value as any)}
                >
                  <option value="whatsapp">WhatsApp</option>
                  <option value="voice">Voice</option>
                  <option value="email">Email</option>
                  <option value="web">Web Portal</option>
                </select>
              </div>

              <div className={styles.formField}>
                <label className={styles.formLabel} htmlFor="cust-stage-select">Lifecycle Stage</label>
                <select
                  id="cust-stage-select"
                  className={styles.select}
                  value={lifecycleStage}
                  onChange={(e) => setLifecycleStage(e.target.value)}
                >
                  <option value="lead">Lead</option>
                  <option value="qualified">Qualified</option>
                  <option value="opportunity">Opportunity</option>
                  <option value="customer">Customer</option>
                  <option value="active">Active</option>
                </select>
              </div>

              <div className={styles.modalActions}>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setIsCreating(false)}
                  disabled={isSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-accent"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'Creating...' : 'Create Customer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
