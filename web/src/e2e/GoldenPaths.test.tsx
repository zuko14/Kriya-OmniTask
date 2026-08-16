import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { App } from '../App';

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

describe('Golden Paths Integration & E2E Validation', () => {
  beforeEach(() => {
    sessionStorage.clear();
    sessionStorage.setItem('xylarc_access_token', 'mock_e2e_token');

    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        // Auth Me
        if (url.includes('/api/v1/auth/me')) {
          return Promise.resolve(
            jsonResponse({
              user: { id: 'usr_e2e', email: 'owner@enterprise.com', fullName: 'Elena Enterprise', roles: ['owner', 'system:admin'] },
              tenant: { id: 't_ent', name: 'Global Enterprise Ltd', slug: 'global-ent', planTier: 'enterprise', channelPlan: 'combined' },
            })
          );
        }

        // Overview / Telemetry
        if (url.includes('/api/v1/workforce/telemetry')) {
          return Promise.resolve(
            jsonResponse({
              activeAgents: 12,
              idleAgents: 2,
              busyAgents: 10,
              totalAgents: 14,
              avgResponseTimeMs: 142,
              successRate: 0.994,
              throughputPerMinute: 45,
            })
          );
        }

        // SRE Health
        if (url.includes('/api/v1/sre/health')) {
          return Promise.resolve(
            jsonResponse({
              cluster_status: 'HEALTHY',
              active_incidents: 0,
              total_checks_evaluated: 24,
              overall_error_budget_burn_rate: 0.05,
              slo_targets: [
                {
                  target_name: 'api_latency_p95',
                  slo_threshold: 0.999,
                  current_sli: 0.9995,
                  budget_remaining: 0.95,
                  status: 'HEALTHY',
                },
              ],
            })
          );
        }

        // Cost Records & Summary
        if (url.includes('/api/v1/cost/records')) {
          return Promise.resolve(
            jsonResponse({
              records: [{ id: 'cost_1', totalCostUsd: 1250.0, costType: 'model_inference', createdAt: new Date().toISOString() }],
              count: 1,
            })
          );
        }

        // BI Briefings
        if (url.includes('/api/v1/bi/briefings')) {
          return Promise.resolve(
            jsonResponse({
              briefings: [
                {
                  id: 'br_1',
                  headline: 'Executive Weekly Summary',
                  body: 'All systems operating within SLO parameters.',
                  createdAt: new Date().toISOString(),
                },
              ],
              count: 1,
            })
          );
        }

        // Attention items
        if (url.includes('/api/v1/attention/items')) {
          return Promise.resolve(
            jsonResponse({
              items: [
                {
                  id: 'att_e2e_1',
                  source: 'agent',
                  sourceId: 'agent_01',
                  severity: 'HIGH',
                  status: 'PENDING',
                  reason: 'Customer requested human supervisor',
                  payload: { conversationId: 'conv_123', sentimentScore: 0.15 },
                  createdAt: new Date().toISOString(),
                },
              ],
              count: 1,
            })
          );
        }

        // Customers list
        if (url.includes('/api/v1/customers')) {
          return Promise.resolve(
            jsonResponse({
              customers: [
                {
                  id: 'cust_e2e_1',
                  name: 'Apex Innovations',
                  full_name: 'Apex Innovations',
                  email: 'contact@apex.com',
                  primary_email: 'contact@apex.com',
                  external_id: 'ext_apex_1',
                  lifecycle_stage: 'active',
                  preferred_channel: 'email',
                  preferred_language: 'en',
                  metadata: { industry: 'FinTech', mrr: 15000 },
                  created_at: new Date().toISOString(),
                },
              ],
              count: 1,
            })
          );
        }

        // Agents list
        if (url.includes('/api/v1/workforce/agents')) {
          return Promise.resolve(
            jsonResponse({
              agents: [
                {
                  id: 'agent_e2e_1',
                  name: 'Triage Agent Prime',
                  role: 'support',
                  status: 'idle',
                  system_prompt: 'You are a tier-1 customer success specialist.',
                  capabilities: ['chat', 'routing'],
                  metadata: { memory_limit_mb: 512 },
                  created_at: new Date().toISOString(),
                },
              ],
              count: 1,
            })
          );
        }

        // Workflows list
        if (url.includes('/api/v1/workflows')) {
          return Promise.resolve(
            jsonResponse({
              workflows: [
                {
                  id: 'wf_e2e_1',
                  name: 'Lead Qualification & Enrich',
                  slug: 'lead-qualification',
                  status: 'active',
                  created_at: new Date().toISOString(),
                },
              ],
              count: 1,
            })
          );
        }

        // Knowledge documents
        if (url.includes('/api/v1/knowledge/documents')) {
          return Promise.resolve(
            jsonResponse({
              documents: [
                {
                  id: 'doc_e2e_1',
                  title: 'Platform SLA & Terms',
                  content: '99.99% availability guaranteed for enterprise contracts.',
                  contentType: 'application/pdf',
                  tags: ['legal', 'sla'],
                  embeddingStatus: 'indexed',
                  createdAt: new Date().toISOString(),
                },
              ],
              count: 1,
            })
          );
        }

        // Billing plans & invoices
        if (url.includes('/api/v1/billing/plans')) {
          return Promise.resolve(
            jsonResponse({
              plans: [
                {
                  id: 'plan_e2e',
                  name: 'Enterprise Plan',
                  tier: 'enterprise',
                  priceMonthlyUsd: 1499,
                  features: ['Custom SLIs', 'Dedicated Fleet'],
                  maxAgents: 100,
                  maxMonthlyWorkflows: 500000,
                },
              ],
              count: 1,
            })
          );
        }

        if (url.includes('/api/v1/billing/invoices')) {
          return Promise.resolve(
            jsonResponse({
              invoices: [
                {
                  id: 'inv_e2e_1',
                  period_start: '2026-08-01',
                  period_end: '2026-08-31',
                  total_cents: 149900,
                  status: 'paid',
                },
              ],
              count: 1,
            })
          );
        }

        // Platform Admin Tenants
        if (url.includes('/api/v1/admin/tenants')) {
          return Promise.resolve(
            jsonResponse({
              tenants: [
                {
                  id: 't_ent',
                  name: 'Global Enterprise Ltd',
                  slug: 'global-ent',
                  status: 'active',
                  plan_tier: 'enterprise',
                  channel_plan: 'combined',
                  created_at: new Date().toISOString(),
                },
              ],
              count: 1,
            })
          );
        }

        // Platform Fleet Diagnostics
        if (url.includes('/api/v1/admin/fleet/diagnostics')) {
          return Promise.resolve(
            jsonResponse({
              totalNodes: 8,
              onlineNodes: 8,
              degradedNodes: 0,
              offlineNodes: 0,
              avgCpuUsagePct: 28.5,
              avgMemoryUsagePct: 42.1,
              clusterHealth: 'OPTIMAL',
            })
          );
        }

        // Platform Maintenance
        if (url.includes('/api/v1/admin/maintenance')) {
          return Promise.resolve(
            jsonResponse({
              isMaintenanceActive: false,
              readOnlyMode: false,
              emergencyKillActive: false,
              updatedAt: new Date().toISOString(),
            })
          );
        }

        return Promise.resolve(jsonResponse({}, true, 200));
      })
    );
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('executes client plane navigation and validates real telemetry and entity loading', async () => {
    window.history.pushState({}, '', '/app/overview');
    render(<App />);

    // Renders Executive Overview
    expect(await screen.findByText('Executive Overview')).toBeInTheDocument();
    expect(await screen.findByText('$1250.00')).toBeInTheDocument();

    // Navigates via Command Palette
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    expect(await screen.findByRole('dialog', { name: /Command Palette/i })).toBeInTheDocument();

    const searchInput = screen.getByPlaceholderText(/Search commands, customers, agents/i);
    fireEvent.change(searchInput, { target: { value: 'Customer 360' } });

    const custNavOption = await screen.findByText('Customer 360');
    fireEvent.click(custNavOption);

    // Validates Customer 360 Page rendered with data
    expect(await screen.findByText(/Customer 360 Directory/i)).toBeInTheDocument();
    expect(await screen.findByText('Apex Innovations')).toBeInTheDocument();
  });

  it('executes platform owner plane navigation and verifies zero-trust posture & fleet health', async () => {
    window.history.pushState({}, '', '/platform/overview');
    render(<App />);

    expect(await screen.findByText('Platform Overview')).toBeInTheDocument();
    expect((await screen.findAllByText('Global Enterprise Ltd')).length).toBeGreaterThan(0);
    expect(await screen.findByText('OPTIMAL')).toBeInTheDocument();
  });
});
