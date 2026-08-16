import { apiFetch } from '../../lib/apiClient';
import { useAsync } from '../../lib/useAsync';
import { KpiCard } from '../../components/KpiCard';
import { AsyncState } from '../../components/AsyncState';
import styles from './ExecutiveOverview.module.css';

interface AttentionItem {
  id: string;
  title: string;
  description: string;
  priority: string;
  status: string;
  reason_category: string;
  created_at: string;
}

interface CostRecord {
  id: string;
  agentId: string;
  costCategory: string;
  totalCostUsd: number;
  createdAt: string;
}

interface Briefing {
  id: string;
  briefing_date: string;
  title: string;
  summary_markdown: string;
  status: string;
}

function fetchAttentionItems() {
  return apiFetch<{ items: AttentionItem[]; count: number }>('/api/v1/attention/items?status=pending');
}

function fetchCostRecords() {
  return apiFetch<{ records: CostRecord[]; count: number }>('/api/v1/cost/records?limit=20');
}

function fetchBriefings() {
  return apiFetch<{ briefings: Briefing[]; count: number }>('/api/v1/bi/briefings');
}

export function ExecutiveOverview() {
  const attention = useAsync(fetchAttentionItems, []);
  const cost = useAsync(fetchCostRecords, []);
  const briefings = useAsync(fetchBriefings, []);

  const totalSpend = cost.status === 'success' ? cost.data.records.reduce((sum, r) => sum + r.totalCostUsd, 0) : undefined;
  const latestBriefing = briefings.status === 'success' ? briefings.data.briefings[0] : undefined;

  return (
    <div>
      <h1 style={{ marginBottom: 'var(--space-5)' }}>Executive Overview</h1>
      <div className={styles.grid}>
        <KpiCard title="Needs Attention" value={attention.status === 'success' ? String(attention.data.count) : undefined}>
          {attention.status !== 'success' && (
            <AsyncState status={attention.status === 'loading' ? 'loading' : 'error'} error={attention.error} />
          )}
          {attention.status === 'success' && attention.data.items.length === 0 && (
            <AsyncState status="empty" emptyMessage="Nothing needs human attention right now." />
          )}
          {attention.status === 'success' &&
            attention.data.items.slice(0, 5).map((item) => (
              <div key={item.id} className={styles.item}>
                <div className={styles.itemTitle}>{item.title}</div>
                <div className={styles.itemMeta}>
                  {item.priority} · {item.reason_category}
                </div>
              </div>
            ))}
        </KpiCard>

        <KpiCard title="Recent Spend" value={totalSpend !== undefined ? `$${totalSpend.toFixed(2)}` : undefined}>
          {cost.status !== 'success' && <AsyncState status={cost.status === 'loading' ? 'loading' : 'error'} error={cost.error} />}
          {cost.status === 'success' && cost.data.records.length === 0 && (
            <AsyncState status="empty" emptyMessage="No cost records yet." />
          )}
          {cost.status === 'success' &&
            cost.data.records.slice(0, 5).map((r) => (
              <div key={r.id} className={styles.item}>
                <div className={styles.itemTitle}>
                  {r.costCategory} — ${r.totalCostUsd.toFixed(4)}
                </div>
                <div className={styles.itemMeta}>{r.agentId}</div>
              </div>
            ))}
        </KpiCard>

        <KpiCard title="Latest Briefing">
          {briefings.status !== 'success' && (
            <AsyncState status={briefings.status === 'loading' ? 'loading' : 'error'} error={briefings.error} />
          )}
          {briefings.status === 'success' && !latestBriefing && (
            <AsyncState status="empty" emptyMessage="No briefing generated yet." />
          )}
          {latestBriefing && (
            <div className={styles.item}>
              <div className={styles.itemTitle}>{latestBriefing.title}</div>
              <div className={styles.itemMeta}>
                {latestBriefing.briefing_date} · {latestBriefing.status}
              </div>
            </div>
          )}
        </KpiCard>
      </div>
    </div>
  );
}
