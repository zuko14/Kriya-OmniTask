import { useState } from 'react';
import {
  StateDot,
  SignalBadge,
  Panel,
  MetricBlock,
  RosterRow,
  TaskChip,
  EvidenceLink,
  TraceStep,
  AttentionCard,
  DrillButton,
  EmptyState,
  ConfirmDialog,
  SignalState,
  SIGNAL_COLOR,
  SIGNAL_BG,
} from '../components/primitives';
import { getBranding } from '../lib/branding';

const SIGNAL_STATES: SignalState[] = [
  'live',
  'idle',
  'attention',
  'halt',
  'learning',
  'info',
  'external',
];

// Mirrors web/src/styles/tokens.css (KRIYA_AI_DESIGN_SYSTEM.md §2.1, dark theme).
const COLOR_TOKENS = [
  { name: '--bg', value: '#040A11', desc: 'Page ground (deep navy) under two auras' },
  { name: '--surface', value: 'rgba(28,45,63,.72)', desc: 'Glass: cards, sidebar, modals' },
  { name: '--surface2', value: 'rgba(38,58,79,.68)', desc: 'Recessed: inputs, table headers' },
  { name: '--surface3', value: 'rgba(48,70,93,.60)', desc: 'Nested controls' },
  { name: '--border', value: 'rgba(199,234,225,.13)', desc: 'Mint rim on every container' },
  { name: '--border2', value: 'rgba(199,234,225,.22)', desc: 'Hover / stronger rim' },
  { name: '--text', value: '#E4EFF1', desc: 'Body text' },
  { name: '--text2', value: '#9FB6BF', desc: 'Secondary text, labels' },
  { name: '--text3', value: '#6E8794', desc: 'Metadata (3:1 — not for small body copy)' },
  { name: '--accent', value: '#3D8BFD', desc: 'Interactive, focus, links' },
];

const SIGNAL_COLORS = [
  { state: 'live' as SignalState, token: '--green', hex: '#10B981', label: 'Healthy / Active / Verified' },
  { state: 'idle' as SignalState, token: '--text3', hex: '#6E8794', label: 'Idle / Paused / Not scheduled' },
  { state: 'attention' as SignalState, token: '--amber', hex: '#F5A524', label: 'Needs human / Approval / Degraded' },
  { state: 'halt' as SignalState, token: '--red', hex: '#F2555F', label: 'Failed / Blocked / Stopped' },
  { state: 'learning' as SignalState, token: '--purple', hex: '#B98CF0', label: 'Adapting / Canary / Under evaluation' },
  { state: 'info' as SignalState, token: '--accent', hex: '#3D8BFD', label: 'Neutral notice / Submitted' },
  { state: 'external' as SignalState, token: '--cyan', hex: '#22D3EE', label: 'EXTERNAL / Untrusted data provenance' },
];

export function Styleguide() {
  const branding = getBranding();
  const [showConfirm, setShowConfirm] = useState(false);
  const [activeTab, setActiveTab] = useState<'tokens' | 'typography' | 'primitives'>('tokens');

  return (
    <div style={{ maxWidth: 'var(--main-max)', margin: '0 auto', padding: 'var(--space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      {/* Header */}
      <header style={{ borderBottom: 'var(--border-width) solid var(--border)', paddingBottom: 'var(--space-4)' }}>
        <div className="eyebrow">{branding.productName} · Design System Specification</div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-3xl)', fontWeight: 700, margin: 'var(--space-1) 0' }}>
          Design Tokens &amp; Component Primitives
        </h1>
        <p style={{ color: 'var(--text2)', fontSize: 'var(--text-md)', margin: 0, maxWidth: 'var(--reading-max)' }}>
          Authoritative specification for colors, typography, and foundational components from KRIYA_AI_DESIGN_SYSTEM.md ("Clinical Depth"); values mirror web/src/styles/tokens.css.
        </p>

        <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-4)' }}>
          {(['tokens', 'typography', 'primitives'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                background: activeTab === tab ? 'var(--surface2)' : 'var(--surface)',
                border: `var(--border-width) solid ${activeTab === tab ? 'var(--border2)' : 'var(--border)'}`,
                color: activeTab === tab ? 'var(--text)' : 'var(--text3)',
                padding: 'var(--space-2) var(--space-4)',
                borderRadius: 'var(--radius-sm)',
                fontSize: 'var(--text-sm)',
                fontWeight: 600,
                textTransform: 'capitalize',
                cursor: 'pointer',
              }}
            >
              {tab}
            </button>
          ))}
        </div>
      </header>

      {activeTab === 'tokens' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
          {/* Ground Colors */}
          <Panel title="Ground Color Hierarchy" eyebrow="Base Ground Tokens">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--space-4)' }}>
              {COLOR_TOKENS.map((col) => (
                <div
                  key={col.name}
                  style={{
                    background: `var(${col.name})`,
                    border: 'var(--border-width) solid var(--border)',
                    borderRadius: 'var(--radius-md)',
                    padding: 'var(--space-3)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 'var(--space-2)',
                    boxShadow: 'var(--elev-1)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--text)', fontWeight: 600 }}>
                      {col.name}
                    </span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-2xs)', color: 'var(--text3)' }}>
                      {col.value}
                    </span>
                  </div>
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text2)' }}>
                    {col.desc}
                  </span>
                </div>
              ))}
            </div>
          </Panel>

          {/* Signal Colors */}
          <Panel title="Signal Colors &amp; Provenance (§12.1)" eyebrow="Strict State Semantics">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 'var(--space-4)' }}>
              {SIGNAL_COLORS.map((sig) => (
                <div
                  key={sig.state}
                  style={{
                    background: 'var(--surface)',
                    border: 'var(--border-width) solid var(--border)',
                    borderRadius: 'var(--radius-md)',
                    padding: 'var(--space-3)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 'var(--space-2)',
                    boxShadow: 'var(--elev-1)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                      <StateDot state={sig.state} size="md" pulse={sig.state === 'live'} showGlyph />
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: SIGNAL_COLOR[sig.state as keyof typeof SIGNAL_COLOR], fontWeight: 600 }}>
                        {sig.token}
                      </span>
                    </div>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-2xs)', color: 'var(--text3)' }}>
                      {sig.hex}
                    </span>
                  </div>
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text2)' }}>
                    {sig.label}
                  </span>
                  <div
                    style={{
                      background: SIGNAL_BG[sig.state as keyof typeof SIGNAL_BG],
                      border: `var(--border-width) solid ${SIGNAL_COLOR[sig.state as keyof typeof SIGNAL_COLOR]}`,
                      borderRadius: 'var(--radius-sm)',
                      padding: 'var(--space-1) var(--space-2)',
                      fontFamily: 'var(--font-mono)',
                      fontSize: 'var(--text-2xs)',
                      color: SIGNAL_COLOR[sig.state as keyof typeof SIGNAL_COLOR],
                      marginTop: 'var(--space-1)',
                    }}
                  >
                    {sig.token}-bg (12% opacity fill)
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      )}

      {activeTab === 'typography' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
          <Panel title="Font Families (§13)" eyebrow="Typography System">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 'var(--space-5)' }}>
              <div style={{ background: 'var(--surface2)', padding: 'var(--space-4)', borderRadius: 'var(--radius-md)', border: 'var(--border-width) solid var(--border)' }}>
                <div className="eyebrow">Headings & numbers · weights 600–700</div>
                <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-2xl)', fontWeight: 700, margin: 'var(--space-2) 0' }}>
                  IBM Plex Sans
                </h3>
                <p style={{ color: 'var(--text2)', fontSize: 'var(--text-sm)', lineHeight: 1.5 }}>
                  One family for the whole console (DS §3). Page titles 1.6rem/600, stat numbers 2rem/600 with tabular figures.
                </p>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-3xl)', fontWeight: 700, color: 'var(--text)' }}>
                  1,284
                </div>
              </div>

              <div style={{ background: 'var(--surface2)', padding: 'var(--space-4)', borderRadius: 'var(--radius-md)', border: 'var(--border-width) solid var(--border)' }}>
                <div className="eyebrow">Body · weights 400–500</div>
                <h3 style={{ fontFamily: 'var(--font-body)', fontSize: 'var(--text-2xl)', fontWeight: 600, margin: 'var(--space-2) 0' }}>
                  IBM Plex Sans Regular
                </h3>
                <p style={{ color: 'var(--text2)', fontSize: 'var(--text-sm)', lineHeight: 1.5 }}>
                  Body 0.92rem, table cells 0.87rem, tracking -0.011em.
                </p>
                <div style={{ fontFamily: 'var(--font-body)', fontSize: 'var(--text-md)', color: 'var(--text)' }}>
                  Active agent fleet orchestrates lead qualification and customer support workflows.
                </div>
              </div>

              <div style={{ background: 'var(--surface2)', padding: 'var(--space-4)', borderRadius: 'var(--radius-md)', border: 'var(--border-width) solid var(--border)' }}>
                <div className="eyebrow">Data / Mono Role · IDs, timestamps, logs</div>
                <h3 style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-2xl)', fontWeight: 500, margin: 'var(--space-2) 0' }}>
                  System monospace
                </h3>
                <p style={{ color: 'var(--text2)', fontSize: 'var(--text-sm)', lineHeight: 1.5 }}>
                  Tabular figures, traces, timestamps, hash digests, IDs, and numeric comparisons.
                </p>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-sm)', color: 'var(--accent)' }}>
                  seq: 184920 · 2026-08-20T08:15:00.000Z · #sha256:7f3a9e
                </div>
              </div>
            </div>
          </Panel>

          <Panel title="Type Scale (§13.1)" eyebrow="Font Size & Line Height Hierarchy">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              {[
                { token: '--text-4xl', size: '40px / 2.5rem', weight: '600', sample: '1,284' },
                { token: '--text-3xl', size: '32px / 2rem', weight: '600 (stat number)', sample: '₹4,812 / mo' },
                { token: '--text-2xl', size: '25.6px / 1.6rem', weight: '600 (page title)', sample: 'Executive Overview' },
                { token: '--text-xl', size: '20px / 1.25rem', weight: '600', sample: 'Live Workforce Fleet' },
                { token: '--text-lg', size: '16px / 1rem', weight: 'Body 600', sample: 'Section Intro & Emphasized' },
                { token: '--text-md', size: '14px / 0.875rem', weight: 'Body 400 (DEFAULT)', sample: 'Standard body text and controls' },
                { token: '--text-sm', size: '13px / 0.8125rem', weight: 'Body 400 (Dense)', sample: 'Dense table body and secondary UI' },
                { token: '--text-xs', size: '12px / 0.75rem', weight: 'Body 500', sample: 'Captions, metadata, timestamps' },
                { token: '--text-2xs', size: '11px / 0.6875rem', weight: 'Body 600 (Eyebrows)', sample: 'TABLE MICRO-LABELS' },
              ].map((item) => (
                <div key={item.token} style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', borderBottom: 'var(--border-width) solid var(--border)', paddingBottom: 'var(--space-2)' }}>
                  <div style={{ width: '220px' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--accent)' }}>{item.token}</span>
                    <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text3)' }}>{item.size} · {item.weight}</div>
                  </div>
                  <div style={{ flex: 1, fontSize: `var(${item.token})`, color: 'var(--text)' }}>
                    {item.sample}
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      )}

      {activeTab === 'primitives' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
          {/* RosterRow Signature Component */}
          <Panel title="RosterRow — Signature Fleet Component (§14.4)" eyebrow="Workforce Roster Hierarchy">
            <div style={{ display: 'flex', flexDirection: 'column', border: 'var(--border-width) solid var(--border)', borderRadius: 'var(--radius-md)', background: 'var(--surface)', overflow: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 2fr) 130px 140px 100px 80px 70px', padding: 'var(--space-2) var(--space-3)', background: 'var(--surface2)', borderBottom: 'var(--border-width) solid var(--border)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-2xs)', color: 'var(--text3)', textTransform: 'uppercase' }}>
                <div>Agent</div>
                <div>State</div>
                <div>Load</div>
                <div>24h Trend</div>
                <div>Attention</div>
                <div style={{ textAlign: 'right' }}>Active</div>
              </div>

              <RosterRow
                agent={{ id: 'ag_orch', name: 'Workforce Orchestrator', slug: 'orchestrator', role: 'Supervisor Engine', isSupervisor: true }}
                depth={0}
                state="live"
                load={0.65}
                trend={[12, 18, 25, 30, 42, 55, 60, 52, 48, 65, 72, 80, 85, 70, 60, 58, 62, 70, 78, 65, 50, 40, 30, 20]}
                attentionCount={0}
                version="v2.3"
                activeTasks={[
                  { id: 'tsk_1', taskType: 'Lead Routing', state: 'live', label: 'routing inbound WhatsApp lead', elapsed: '1.2s' },
                  { id: 'tsk_2', taskType: 'Health Monitor', state: 'live', label: 'checking fleet SLAs', elapsed: '0.4s' },
                ]}
              />

              <RosterRow
                agent={{ id: 'ag_lead', name: 'Lead Qualification Agent', slug: 'lead_qual', role: 'Sales & Intake' }}
                depth={1}
                isLastChild={false}
                state="live"
                load={0.88}
                trend={[5, 10, 15, 22, 35, 45, 55, 60, 75, 85, 90, 88, 80, 75, 70, 65, 60, 55, 50, 45, 35, 25, 15, 10]}
                attentionCount={2}
                version="v2.1"
                activeTasks={[
                  { id: 'tsk_3', taskType: 'WhatsApp Chat', state: 'live', label: 'customer +91 98765 43210', elapsed: '4.8s' },
                ]}
              />

              <RosterRow
                agent={{ id: 'ag_booking', name: 'Calendar Booking Agent', slug: 'booking', role: 'Scheduling Specialist' }}
                depth={1}
                isLastChild={false}
                state="live"
                load={0.33}
                trend={[2, 4, 8, 12, 20, 25, 30, 28, 25, 22, 30, 35, 40, 35, 30, 25, 20, 18, 15, 12, 10, 8, 5, 2]}
                attentionCount={0}
                version="v2.0"
              />

              <RosterRow
                agent={{ id: 'ag_support', name: 'Customer Support Agent', slug: 'support', role: 'Tier-1 Support' }}
                depth={1}
                isLastChild={false}
                state="attention"
                load={1.0}
                trend={[20, 35, 50, 65, 80, 95, 100, 100, 98, 95, 90, 85, 80, 75, 70, 65, 60, 55, 50, 45, 40, 35, 30, 25]}
                attentionCount={7}
                version="v2.2"
                preferredModelTier="tier_1"
                modelTier="tier_2"
                degradedReason="Degraded to tier_2: router rate limit on primary provider"
              />

              <RosterRow
                agent={{ id: 'ag_insights', name: 'Market Research Agent', slug: 'researcher', role: 'Canary Insights Worker' }}
                depth={1}
                isLastChild={true}
                state="learning"
                isCanary={true}
                load={0.45}
                trend={[0, 0, 5, 10, 15, 25, 30, 35, 40, 35, 30, 25, 20, 15, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0]}
                attentionCount={0}
                version="v2.4-canary"
              />
            </div>
          </Panel>

          {/* TraceStep & Decision Trace Primitives */}
          <Panel title="TraceStep — Decision Trace Elements (§14.5, §18.5)" eyebrow="Explainability Primitives">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              <TraceStep
                stepNumber={1}
                timestamp="14:32:01.102"
                actor="Orchestrator"
                actorRole="Supervisor"
                action="workflow:delegate"
                status="delegated"
                inputSummary="Customer WhatsApp query: 'Can I get a discount for annual subscription?'"
                outputSummary="Delegated intent to Lead Qualification Agent with DNA constraints."
                latencyMs={42}
                tokens={310}
              />

              <TraceStep
                stepNumber={2}
                timestamp="14:32:01.420"
                actor="Lead Qualification Agent"
                actorRole="Sales Specialist"
                action="rag:retrieve_facts"
                status="succeeded"
                trustTier="A"
                inputSummary="Lookup annual discount policy in ERP database."
                outputSummary="Retrieved Tier A rule: Max discount 15% for annual upfront contract."
                latencyMs={85}
                tokens={520}
                evidence={[
                  { text: 'ERP Policy #POL-104', source: 'SAP ERP Master Data', trustTier: 'A' },
                  { text: 'Competitor Web Benchmark', source: 'Allowlisted Public Pricing', trustTier: 'C' },
                ]}
              />

              <TraceStep
                stepNumber={3}
                timestamp="14:32:02.105"
                actor="Lead Qualification Agent"
                actorRole="Sales Specialist"
                action="customer:reply"
                status="succeeded"
                outputSummary="Synthesized approved response offering 15% annual plan discount."
                latencyMs={120}
                tokens={640}
              />
            </div>
          </Panel>

          {/* AttentionCard Human Queue Items */}
          <Panel title="AttentionCard — Human Attention Center (§14.5)" eyebrow="Operator Intervention Queue">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 'var(--space-4)' }}>
              <AttentionCard
                item={{
                  id: 'att_01',
                  title: 'Data Conflict: Pricing Mismatch on ERP vs External Source',
                  description: 'External research stated 25% discount, but ERP System of Record defines 10% limit. System of Record prevailed per §10.2.',
                  priority: 'P1_HIGH',
                  status: 'pending',
                  sourceAgentId: 'sales_agent',
                  channel: 'whatsapp',
                  slaExpiresAt: '28m remaining',
                  recommendedAction: 'Verify if ERP discount ceiling requires adjustment or confirm 10% limit.',
                }}
                onApprove={() => alert('Approved ERP supremacy')}
                onReject={() => alert('Rejected')}
                onClaim={() => alert('Claimed item')}
              />

              <AttentionCard
                item={{
                  id: 'att_02',
                  title: 'High-Risk Action Exceeded Autonomous Budget',
                  description: 'Refund request of ₹45,000 exceeds agent autonomous refund ceiling (₹10,000).',
                  priority: 'P0_CRITICAL',
                  status: 'pending',
                  sourceAgentId: 'support_agent',
                  channel: 'voice',
                  slaExpiresAt: '8m remaining (CRITICAL)',
                  recommendedAction: 'Human operator approval required before disbursement.',
                }}
                onApprove={() => alert('Approved refund')}
                onReject={() => alert('Declined refund')}
              />
            </div>
          </Panel>

          {/* StateDot & SignalBadge */}
          <Panel title="StateDot &amp; SignalBadge (§14.1 &amp; §14.5)" eyebrow="Status Primitives">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-4)', alignItems: 'center' }}>
              {SIGNAL_STATES.map((st) => (
                <div key={st} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', background: 'var(--surface2)', padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-sm)' }}>
                  <StateDot state={st} size="md" pulse={st === 'live'} showGlyph />
                  <SignalBadge state={st} />
                </div>
              ))}
            </div>
          </Panel>

          {/* MetricBlock */}
          <Panel title="MetricBlock with Strict Provenance (§14.3)" eyebrow="Metric Primitives">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 'var(--space-4)' }}>
              <MetricBlock
                isPrimary
                label="Tasks Executed Today"
                value="8,421"
                delta="12.4%"
                deltaDirection="positive"
                source="audit_ledger"
                timestamp="Just now"
                trustTier="A"
                onDrill={() => alert('Drill down to audit ledger')}
              />

              <MetricBlock
                label="Customer Churn Rate"
                value="1.2%"
                delta="0.4%"
                deltaDirection="positive"
                source="crm_bi_engine"
                timestamp="5m ago"
                trustTier="B"
                onDrill={() => alert('Drill down to CRM churn metrics')}
              />

              <MetricBlock
                label="External Competitor Price"
                value="₹4,999"
                delta="2.1%"
                deltaDirection="negative"
                source="web_fetcher_allowlist"
                timestamp="1h ago"
                trustTier="C"
                onDrill={() => alert('Drill down to external cited data')}
              />
            </div>
          </Panel>

          {/* Interactive Primitives */}
          <Panel title="Interactive &amp; Evidence Primitives" eyebrow="TaskChips, EvidenceLinks &amp; ConfirmDialog">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
                <TaskChip taskType="Lead Qual" state="live" label="qualifying +91 98765…" elapsed="3.2s" />
                <TaskChip taskType="Booking" state="live" label="held slot Thu 4pm" elapsed="1.8s" />
                <TaskChip taskType="Support" state="attention" label="ticket #4928" elapsed="14.1s" />
                <TaskChip taskType="Research" state="external" label="market check" elapsed="0.9s" />
              </div>

              <div style={{ display: 'flex', gap: 'var(--space-4)', alignItems: 'center' }}>
                <EvidenceLink text="Pricing Record #PR-4091" source="ERP Database" trustTier="A" />
                <EvidenceLink text="Industry Benchmark" source="Allowlisted Web" trustTier="C" />
                <DrillButton label="View trace evidence" onDrill={() => alert('Opened trace evidence')} />
              </div>

              <div>
                <button onClick={() => setShowConfirm(true)} className="btn btn-danger btn-sm">
                  Test ConfirmDialog (High-Risk)
                </button>
              </div>
            </div>
          </Panel>

          {/* EmptyState */}
          <Panel title="EmptyState Pattern" eyebrow="Zero State Handling">
            <EmptyState
              title="No Autonomous Workflow Runs Yet"
              message="No workflow instances have executed for this tenant today. Provision a workflow trigger or dispatch an agent task to begin autonomous execution."
              actionLabel="Dispatch Test Task"
              onAction={() => alert('Dispatched test task')}
            />
          </Panel>
        </div>
      )}

      {/* ConfirmDialog Modal */}
      <ConfirmDialog
        isOpen={showConfirm}
        isHighRisk
        title="Suspend Agent Fleet"
        actionName="agent:emergency_stop"
        consequence="All in-flight autonomous executions across all channels will be halted immediately. In-progress customer calls will degrade to human operators."
        confirmLabel="Confirm Emergency Stop"
        cancelLabel="Cancel"
        onConfirm={() => {
          alert('Emergency stop confirmed');
          setShowConfirm(false);
        }}
        onCancel={() => setShowConfirm(false)}
      />
    </div>
  );
}
