import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router';
import { apiFetch } from '../lib/apiClient';
import { Icon } from './brand/Icon';
import styles from './CommandPalette.module.css';

export interface CommandItem {
  id: string;
  title: string;
  category: 'Navigation' | 'Customers' | 'Agents' | 'Workflows' | 'Tenants';
  subtitle?: string;
  path: string;
}

const STATIC_NAV_COMMANDS: CommandItem[] = [
  { id: 'nav_overview', title: 'Executive Overview', category: 'Navigation', subtitle: 'Live telemetry & workforce health', path: '/app/overview' },
  { id: 'nav_attention', title: 'Human Attention Center', category: 'Navigation', subtitle: 'Escalations, claims & intervention', path: '/app/attention' },
  { id: 'nav_customers', title: 'Customer 360', category: 'Navigation', subtitle: 'Customer profiles & audit', path: '/app/customers' },
  { id: 'nav_conversations', title: 'Conversations & Omnichannel', category: 'Navigation', subtitle: 'Live customer chat & messaging', path: '/app/conversations' },
  { id: 'nav_agents', title: 'Agent Command Center', category: 'Navigation', subtitle: 'Workforce catalog & dispatch', path: '/app/agents' },
  { id: 'nav_workflows', title: 'Workflows & Orchestration', category: 'Navigation', subtitle: 'Pipeline execution & DAGs', path: '/app/workflows' },
  { id: 'nav_bi', title: 'Business Intelligence', category: 'Navigation', subtitle: 'ROI, cost reduction & revenue attribution', path: '/app/bi' },
  { id: 'nav_knowledge', title: 'Knowledge Center & RAG', category: 'Navigation', subtitle: 'Enterprise documents & grounding', path: '/app/knowledge' },
  { id: 'nav_billing', title: 'Billing & Subscriptions', category: 'Navigation', subtitle: 'Plan tiers & invoices', path: '/app/billing' },
  { id: 'nav_settings', title: 'Tenant Settings', category: 'Navigation', subtitle: 'Team management & limits', path: '/app/settings' },
  { id: 'nav_plat_overview', title: 'Platform Control Plane', category: 'Navigation', subtitle: 'Cross-tenant diagnostics', path: '/platform/overview' },
  { id: 'nav_plat_tenants', title: 'Tenant Organizations Registry', category: 'Navigation', subtitle: 'Provisioning & status controls', path: '/platform/tenants' },
  { id: 'nav_plat_fleet', title: 'Agent Fleet Diagnostics', category: 'Navigation', subtitle: 'Node heartbeats & cluster capacity', path: '/platform/fleet' },
  { id: 'nav_plat_models', title: 'Model Provider Resilience', category: 'Navigation', subtitle: 'Model registry & fallback routing', path: '/platform/models' },
  { id: 'nav_plat_security', title: 'Platform Security Center', category: 'Navigation', subtitle: 'Zero-trust scan & hash ledger', path: '/platform/security' },
  { id: 'nav_plat_billing', title: 'Platform Revenue & Monetization', category: 'Navigation', subtitle: 'Cross-tenant MRR & billing', path: '/platform/billing' },
  { id: 'nav_plat_audit', title: 'Platform Operator Audit Ledger', category: 'Navigation', subtitle: 'Operator activity log stream', path: '/platform/audit' },
];

export function CommandPalette({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CommandItem[]>(STATIC_NAV_COMMANDS);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  // Reset and focus when opening
  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setResults(STATIC_NAV_COMMANDS);
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Search filter & entity aggregation
  useEffect(() => {
    if (!isOpen) return;

    const trimmed = query.trim().toLowerCase();
    if (!trimmed) {
      setResults(STATIC_NAV_COMMANDS);
      setSelectedIndex(0);
      return;
    }

    // Filter static commands immediately
    const filteredNav = STATIC_NAV_COMMANDS.filter(
      (cmd) => cmd.title.toLowerCase().includes(trimmed) || cmd.subtitle?.toLowerCase().includes(trimmed)
    );
    setResults(filteredNav);
    setSelectedIndex(0);

    let cancelled = false;

    // Asynchronously fetch matching entities
    const fetchEntities = async () => {
      const dynamicItems: CommandItem[] = [];

      try {
        // Search customers
        const custRes = await apiFetch<{ customers: Array<{ id: string; name: string; email: string }> }>(
          `/api/v1/customers?search=${encodeURIComponent(trimmed)}`
        ).catch(() => ({ customers: [] }));

        if (custRes?.customers) {
          custRes.customers.forEach((c) => {
            if (c.name.toLowerCase().includes(trimmed) || c.email?.toLowerCase().includes(trimmed) || c.id.toLowerCase().includes(trimmed)) {
              dynamicItems.push({
                id: `cust_${c.id}`,
                title: c.name || c.id,
                category: 'Customers',
                subtitle: c.email || c.id,
                path: `/app/customers/${c.id}`,
              });
            }
          });
        }

        // Search agents
        const agentRes = await apiFetch<{ agents: Array<{ id: string; name: string; role: string }> }>(
          '/api/v1/workforce/agents'
        ).catch(() => ({ agents: [] }));

        if (agentRes?.agents) {
          agentRes.agents.forEach((a) => {
            if (a.name.toLowerCase().includes(trimmed) || a.role?.toLowerCase().includes(trimmed)) {
              dynamicItems.push({
                id: `agent_${a.id}`,
                title: a.name,
                category: 'Agents',
                subtitle: a.role,
                path: `/app/agents/${a.id}`,
              });
            }
          });
        }

        // Search workflows
        const wfRes = await apiFetch<{ workflows: Array<{ id: string; name: string; slug: string }> }>(
          '/api/v1/workflows'
        ).catch(() => ({ workflows: [] }));

        if (wfRes?.workflows) {
          wfRes.workflows.forEach((w) => {
            if (w.name.toLowerCase().includes(trimmed) || w.slug.toLowerCase().includes(trimmed)) {
              dynamicItems.push({
                id: `wf_${w.id}`,
                title: w.name,
                category: 'Workflows',
                subtitle: `/${w.slug}`,
                path: `/app/workflows/${w.slug}`,
              });
            }
          });
        }
      } catch {
        // Ignore entity fetch failures gracefully
      }

      if (!cancelled) {
        const merged = [...filteredNav, ...dynamicItems];
        setResults(merged);
        setSelectedIndex(0);
      }
    };

    fetchEntities();

    return () => {
      cancelled = true;
    };
  }, [query, isOpen]);

  const handleSelect = useCallback(
    (item: CommandItem) => {
      onClose();
      navigate(item.path);
    },
    [navigate, onClose]
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (results.length > 0 ? (prev + 1) % results.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (results.length > 0 ? (prev - 1 + results.length) % results.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (results[selectedIndex]) {
        handleSelect(results[selectedIndex]);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className={styles.backdrop} onClick={onClose} data-testid="command-palette-backdrop">
      <div className={styles.modal} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Command Palette">
        <div className={styles.inputWrapper}>
          <span className={styles.searchIcon}><Icon name="search" /></span>
          <input
            ref={inputRef}
            type="text"
            className={styles.searchInput}
            placeholder="Search commands, customers, agents, workflows... (Esc to exit)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            aria-label="Global search command palette"
          />
          <span className={styles.shortcutBadge}>ESC</span>
        </div>

        <div className={styles.resultsList} role="listbox">
          {results.length === 0 ? (
            <div className={styles.emptyState}>No matching commands or entities found.</div>
          ) : (
            results.map((item, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <div
                  key={item.id}
                  className={`${styles.resultItem} ${isSelected ? styles.resultItemActive : ''}`}
                  onClick={() => handleSelect(item)}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  role="option"
                  aria-selected={isSelected}
                >
                  <div className={styles.itemLabel}>
                    <strong>{item.title}</strong>
                    {item.subtitle && <span style={{ color: 'var(--text2)', fontSize: '12px' }}>{item.subtitle}</span>}
                  </div>
                  <span className={styles.itemCategory}>{item.category}</span>
                </div>
              );
            })
          )}
        </div>

        <div className={styles.footer}>
          <span>↑↓ to navigate</span>
          <span>↵ to select</span>
          <span>esc to close</span>
        </div>
      </div>
    </div>
  );
}
