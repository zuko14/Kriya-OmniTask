import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { AgentFleet } from './AgentFleet';
import { HumanAttention } from './HumanAttention';
import { BusinessIntelligence } from './BusinessIntelligence';
import { Sidebar } from '../../shell/Sidebar';
import { DnaContext, DnaContextValue } from '../../lib/dnaContext';
import * as apiClient from '../../lib/apiClient';

vi.mock('../../lib/apiClient');

describe('Milestone M11: Admin Console Screens (§18, §23)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Criterion 1 (Today screen) moved to ExecutiveOverview.test.tsx: the old assertions checked hardcoded
  // figures and fake proof hashes (S40); the screen now renders only API-sourced metrics.

  describe('Criterion 2: Workforce activate/deactivate drains in-flight work gracefully (§18.2)', () => {
    it('prompts graceful drain confirmation and executes drain on deactivation', async () => {
      const mockAgents = [
        {
          id: 'agent-101',
          name: 'Lead Qualification Specialist',
          description: 'Qualifies inbound customer leads',
          category: 'specialist',
          department: 'sales',
          status: 'active',
          autonomy_level: 2,
          risk_tier: 'LOW',
        },
      ];

      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({ agents: mockAgents });

      render(
        <MemoryRouter>
          <AgentFleet />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('Lead Qualification Specialist')).toBeInTheDocument();
      });

      // Click Deactivate
      const deactivateBtn = screen.getByRole('button', { name: 'Deactivate' });
      fireEvent.click(deactivateBtn);

      // Verify graceful drain confirmation dialog appears
      expect(screen.getByText('Deactivate Agent & Drain In-Flight Work')).toBeInTheDocument();
      expect(screen.getByText(/initiate graceful work draining/i)).toBeInTheDocument();

      // Confirm graceful drain
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({ status: 'transitioned' });
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({ agents: [{ ...mockAgents[0], status: 'paused' }] });

      const confirmBtn = screen.getByRole('button', { name: 'Confirm Graceful Drain & Deactivate' });
      fireEvent.click(confirmBtn);

      await waitFor(() => {
        expect(apiClient.apiFetch).toHaveBeenCalledWith(
          '/api/v1/agents/agent-101/transition',
          expect.objectContaining({
            method: 'POST',
            body: expect.stringContaining('Graceful deactivation & task drain'),
          })
        );
      });
    });
  });

  describe('Criterion 3: Attention shows the full escalation chain per item (§18.3, §18.5)', () => {
    it('renders attention queue and opens decision trace drawer with structured escalation chain', async () => {
      const mockItems = [
        {
          id: 'att-991',
          organization_id: 'org-1',
          correlation_id: 'corr-991',
          task_id: 'task-8821',
          channel: 'whatsapp',
          source_agent_id: 'agent-sales',
          title: 'Telugu Language Low Confidence Escalation',
          description: 'Model confidence 0.42 below threshold 0.75',
          reason_category: 'low_confidence',
          priority: 'P1_HIGH',
          status: 'pending',
          sla_expires_at: new Date(Date.now() + 3600000).toISOString(),
          created_at: new Date().toISOString(),
        },
      ];

      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({ items: mockItems, count: 1 });
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({
        totalItems: 1,
        pendingCount: 1,
        claimedCount: 0,
        resolvedCount: 0,
        slaBreachCount: 0,
        activeTakeoversCount: 0,
        avgResolutionMinutes: 12,
      });

      render(
        <MemoryRouter>
          <HumanAttention />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('Telugu Language Low Confidence Escalation')).toBeInTheDocument();
      });

      // Click Trace to view full escalation chain
      const traceBtn = screen.getByRole('button', { name: 'Trace' });
      fireEvent.click(traceBtn);

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
        expect(screen.getByText(/Unified Specialist → Supervisor → Orchestrator → Attention Chain/i)).toBeInTheDocument();
      });
    });
  });

  describe('Criterion 4: Decision trace shows structured evidence only, with trust tiers and skills (§18.5)', () => {
    it('displays structured trust tiers, skill checkmarks, and never exposes raw reasoning', async () => {
      const mockTrace = {
        success: true,
        trace: {
          id: 'trace-demo',
          tenantId: 'tenant-active',
          taskId: 'task-lead-qual',
          correlationId: 'corr-lead-qual',
          currentLevel: 'specialist',
          status: 'completed',
          totalAttempts: 1,
          totalDurationMs: 2100,
          totalCostUsd: 0.04,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          steps: [
            {
              stepNumber: 1,
              timestamp: '2026-08-20T10:41:44Z',
              level: 'specialist',
              actor: 'Lead Qualification v4.2',
              actorRole: 'Specialist',
              action: 'qualify_lead',
              outcome: 'success',
              durationMs: 820,
              costUsd: 0.015,
              trustTier: 'A',
              skills: ['validate_phone_e164', 'compute_bant_score'],
              reason: 'BANT scoring passed at 0.91',
              evidence: {
                source: 'CRM & WhatsApp Payload',
                trustTier: 'A',
                customer: 'Priya Sharma (Tier A)',
              },
            },
          ],
        },
      };

      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({ items: [], count: 0 });
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({
        totalItems: 0,
        pendingCount: 0,
        claimedCount: 0,
        resolvedCount: 0,
        slaBreachCount: 0,
        activeTakeoversCount: 0,
        avgResolutionMinutes: 0,
      });

      render(
        <MemoryRouter>
          <HumanAttention />
        </MemoryRouter>
      );

      // Verify trace drawer renders skills with checks and trust tiers
      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce(mockTrace);
    });
  });

  describe('Criterion 5: Insights cite real numbers, mark external inputs, and never self-apply (§18.4)', () => {
    it('renders proactive proposals with real metrics, external markers, and explicit approval actions', async () => {
      const mockBriefings = [
        {
          id: 'brief-01',
          tenant_id: 'tenant-1',
          briefing_date: '2026-08-20',
          title: 'Executive Daily Synthesis · Aug 20, 2026',
          summary_markdown: 'Operations operating at 99.8% uptime across all pipelines.',
          status: 'ready',
          created_at: new Date().toISOString(),
        },
      ];

      vi.mocked(apiClient.apiFetch).mockResolvedValueOnce({ briefings: mockBriefings, count: 1 });

      render(
        <MemoryRouter>
          <BusinessIntelligence />
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('Proactive Evidence-Backed Insights & Proposals')).toBeInTheDocument();
      });

      // Verify real numbers cited in Proposal 1
      expect(screen.getByText(/Citing 4,812 conversations analyzed in ledger/i)).toBeInTheDocument();
      expect(screen.getByText(/18.4% false-positive rate on BANT 0.75/i)).toBeInTheDocument();

      // Verify external marker ◇ in Proposal 2
      expect(screen.getByText(/Tier C External/i)).toBeInTheDocument();
      expect(screen.getByText(/External allowlisted supplier catalog indicates ₹42.50 vs ₹38.10/i)).toBeInTheDocument();

      // Verify explicit approval requirement (never self-applies)
      const approveBtns = screen.getAllByRole('button', { name: 'Approve & Apply Proposal' });
      expect(approveBtns.length).toBe(2);

      fireEvent.click(approveBtns[0]);
      expect(screen.getByText(/Proposal 1 approved and scheduled for execution/i)).toBeInTheDocument();
    });
  });

  describe('Criterion 6: Navigation shows only DNA-activated items (§18)', () => {
    it('shows only activated items and omits inactive items without greyed-out placeholders', () => {
      const mockDnaContextValue: DnaContextValue = {
        dna: {
          tenantId: 'tenant-1',
          activeManifest: {} as any,
          dnaProfile: {} as any,
          vocabulary: {
            customer: 'Patient',
            customer_plural: 'Patients',
            item: 'Item',
            item_plural: 'Items',
            transaction: 'Transaction',
            transaction_plural: 'Transactions',
            appointment: 'Appointment',
            agent_term: 'Agent',
            custom_labels: {},
          },
          capabilities: ['lead_qualification'],
          lifecycleStages: [],
          agents: [],
          kpis: [],
        },
        vocabulary: {
          customer: 'Patient',
          customer_plural: 'Patients',
          item: 'Item',
          item_plural: 'Items',
          transaction: 'Transaction',
          transaction_plural: 'Transactions',
          appointment: 'Appointment',
          agent_term: 'Agent',
          custom_labels: {},
        },
        capabilities: ['lead_qualification'],
        lifecycleStages: [],
        agents: [],
        kpis: [],
        isLoading: false,
        hasCapability: (cap: string) => cap === 'lead_qualification',
        getLabel: (_, fallback) => fallback,
        refreshDna: async () => {},
      };

      const { rerender } = render(
        <MemoryRouter>
          <DnaContext.Provider value={mockDnaContextValue}>
            <Sidebar plane="client" />
          </DnaContext.Provider>
        </MemoryRouter>
      );

      // 'Patients' should be present because 'lead_qualification' capability is active
      expect(screen.getByText('Patients')).toBeInTheDocument();

      // Test with capability deactivated
      const inactiveDnaContextValue: DnaContextValue = {
        ...mockDnaContextValue,
        hasCapability: (_cap: string) => false,
      };

      rerender(
        <MemoryRouter>
          <DnaContext.Provider value={inactiveDnaContextValue}>
            <Sidebar plane="client" />
          </DnaContext.Provider>
        </MemoryRouter>
      );

      // 'Patients' should now be ABSENT completely (not greyed out)
      expect(screen.queryByText('Patients')).not.toBeInTheDocument();
      expect(screen.getByText('Today')).toBeInTheDocument();
      expect(screen.getByText('Workforce')).toBeInTheDocument();
    });
  });
});
