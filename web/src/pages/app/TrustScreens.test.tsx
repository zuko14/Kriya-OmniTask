import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ApiError } from '../../lib/apiClient';

const api = vi.hoisted(() => ({ calls: [] as Array<{ path: string; method: string }>, handler: (_p: string, _m: string): Promise<unknown> => Promise.resolve({}) }));
vi.mock('../../lib/apiClient', async (orig) => ({
  ...(await orig<typeof import('../../lib/apiClient')>()),
  apiFetch: (path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    api.calls.push({ path, method });
    return api.handler(path, method);
  },
}));
vi.mock('../../lib/authContext', () => ({ useAuth: () => ({ auth: { user: { id: 'u_owner' }, tenant: { id: 't1', name: 'Acme' } } }) }));

import { OutcomeBadge } from '../../components/primitives/OutcomeBadge';
import { CostPerOutcome } from './CostPerOutcome';
import { Mandates, mandateStatus, type MandateRecord } from './Mandates';
import { ProofReceipts } from './ProofReceipts';
import { RunTrace } from './RunTrace';
import { VerificationQueue, isOverdue, type VerificationJob } from './VerificationQueue';

const wrap = (el: JSX.Element) => render(<MemoryRouter>{el}</MemoryRouter>);
beforeEach(() => {
  api.calls = [];
});
afterEach(() => cleanup());

describe('OutcomeBadge (04 §3: verified or not done)', () => {
  it('only verified is green; submitted says awaiting confirmation; unknown is neutral and verbatim', () => {
    const { container, rerender } = render(<OutcomeBadge state="verified" />);
    expect(container.firstElementChild).toHaveClass('badge-green');
    rerender(<OutcomeBadge state="submitted" />);
    expect(screen.getByText('Submitted · awaiting confirmation')).toHaveClass('badge-blue');
    rerender(<OutcomeBadge state="completed" />);
    expect(screen.getByText('completed')).toHaveClass('badge-muted');
    rerender(<OutcomeBadge state={undefined} />);
    expect(screen.getByText('No state recorded')).toHaveClass('badge-muted');
  });
});

const REPORT = {
  window: '24h', periodStart: '2026-10-01T00:00:00Z', periodEnd: '2026-10-02T00:00:00Z',
  overallCostPerOutcomeUsd: null, totalCostUsd: 1.25, verifiedOutcomesCount: 0,
  byWorkflow: [{ workflowId: 'wf1', name: 'Doctor Leave', totalCostUsd: 0.5, outcomesCount: 0, verifiedActionRate: 0, costPerOutcomeUsd: null }],
  byAgent: [{ agentId: 'a1', name: 'Intake', outcomesCount: 0, totalCostUsd: 0.75, costPerOutcomeUsd: null, toolReliability: null }],
  byModel: [{ modelId: 'deepseek/deepseek-v4-flash', callsCount: 0, totalCostUsd: 0, tokensInput: 0, tokensOutput: 0, avgLatencyMs: null }],
  cascadeMix: { totalInvocations: 4, estimatedSavingsUsd: 0.2, levels: { L0_rule: { level: 'L0_rule', count: 3, percentage: 75, costUsd: 0 }, L2_fast_model: { level: 'L2_fast_model', count: 1, percentage: 25, costUsd: 0.01 } } },
};

describe('Cost per Outcome', () => {
  it('no verified outcomes → says so; workflow rows show 0 verified, no cost/outcome, 0% rate (S55 fixed); savings labelled an estimate', async () => {
    api.handler = () => Promise.resolve(REPORT);
    wrap(<CostPerOutcome />);
    expect(await screen.findByText('No verified outcomes')).toBeInTheDocument();
    const row = screen.getByText('Doctor Leave').closest('tr')!;
    expect(row).toHaveTextContent('0');
    expect(row).toHaveTextContent('—');
    expect(row).toHaveTextContent('0%');
    expect(row).not.toHaveTextContent('100%');
    expect(screen.getByText(/an estimate against a modelled baseline/)).toBeInTheDocument();
    expect(screen.queryByText(/\d+ ms/)).not.toBeInTheDocument(); // null latency → "—"
  });

  it('switching the window refetches with that window', async () => {
    api.handler = () => Promise.resolve(REPORT);
    wrap(<CostPerOutcome />);
    await screen.findByText('No verified outcomes');
    fireEvent.click(screen.getByRole('button', { name: '7d' }));
    await waitFor(() => expect(api.calls.some((c) => c.path === '/api/v1/outcomes/cost-per-outcome?window=7d')).toBe(true));
  });

  it('API failure → error, no figures', async () => {
    api.handler = () => Promise.reject(new ApiError({ code: 'X', message: 'Outcomes unavailable', statusCode: 500 }));
    wrap(<CostPerOutcome />);
    expect(await screen.findByText('Outcomes unavailable')).toBeInTheDocument();
    expect(screen.queryByText('Total cost')).not.toBeInTheDocument();
  });
});

const M = (over: Partial<MandateRecord>): MandateRecord => ({
  id: 'm1', agent_slug: 'billing', action_types_json: '["refund"]', per_action_limit: 10000, daily_limit: null, currency: 'INR',
  max_count_per_day: null, valid_from: '2026-01-01T00:00:00Z', valid_until: null, revoked_at: null, version: 1, ...over,
});

describe('Mandates', () => {
  it('status is derived from the record: revoked, expired, not yet valid, active', () => {
    const now = Date.parse('2026-10-02T00:00:00Z');
    expect(mandateStatus(M({ revoked_at: '2026-09-01T00:00:00Z' }), now)).toBe('revoked');
    expect(mandateStatus(M({ valid_until: '2026-09-30T00:00:00Z' }), now)).toBe('expired');
    expect(mandateStatus(M({ valid_from: '2026-12-01T00:00:00Z' }), now)).toBe('not_yet_valid');
    expect(mandateStatus(M({}), now)).toBe('active');
  });

  it('revoke asks for confirmation, then DELETEs that mandate and reports the server result', async () => {
    api.handler = (_p, m) => (m === 'DELETE' ? Promise.resolve({}) : Promise.resolve({ mandates: [M({})] }));
    wrap(<Mandates />);
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke mandate for billing' }));
    expect(api.calls.some((c) => c.method === 'DELETE')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    await waitFor(() => expect(api.calls).toContainEqual({ path: '/api/v1/mandates/m1', method: 'DELETE' }));
    expect(await screen.findByText('Mandate for billing revoked.')).toBeInTheDocument();
  });

  it('a forbidden grant shows the server message, not success', async () => {
    api.handler = (_p, m) =>
      m === 'POST' ? Promise.reject(new ApiError({ code: 'FORBIDDEN', message: 'Missing permission tenant:admin', statusCode: 403 })) : Promise.resolve({ mandates: [] });
    wrap(<Mandates />);
    await screen.findByText(/No mandates/);
    fireEvent.change(screen.getByLabelText('Agent slug (* for any)'), { target: { value: 'billing' } });
    fireEvent.change(screen.getByLabelText('Action types (comma separated)'), { target: { value: 'refund' } });
    fireEvent.click(screen.getByRole('button', { name: 'Grant mandate' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Missing permission tenant:admin');
  });
});

const RECEIPT = (seq: number, state: string) => ({
  body: { receiptId: `r${seq}`, sequence: seq, actionType: 'refund.issue', riskTier: 'T2', target: { system: 'razorpay', externalRef: `rf_${seq}` }, verification: { method: 'read_back', state }, issuedAt: '2026-10-02T09:00:00Z' },
  hash: 'h', keyId: 'k1', signature: 's',
});

describe('Proof Receipts', () => {
  it('shows each receipt outcome honestly and "Valid" only after the server verified it', async () => {
    api.handler = (p) =>
      p.startsWith('/api/v1/proof/receipts?')
        ? Promise.resolve({ receipts: [RECEIPT(1, 'verified'), RECEIPT(2, 'submitted')], total: 2, limit: 50, offset: 0, count: 2 })
        : p === '/api/v1/proof/receipts/r1/verify'
          ? Promise.resolve({ valid: true })
          : Promise.resolve({ valid: false, reason: 'signature mismatch' });
    wrap(<ProofReceipts />);
    expect(await screen.findByText('Submitted · awaiting confirmation')).toBeInTheDocument();
    expect(screen.queryByText('Valid')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Verify receipt 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Verify receipt 2' }));
    expect(await screen.findByText('Valid')).toBeInTheDocument();
    expect(await screen.findByText('Invalid · signature mismatch')).toBeInTheDocument();
  });

  it('a broken chain is reported with where it broke', async () => {
    api.handler = (p) =>
      p.startsWith('/api/v1/proof/receipts?') ? Promise.resolve({ receipts: [], total: 0, limit: 50, offset: 0, count: 0 }) : Promise.resolve({ valid: false, checked: 7, brokenAt: 5, reason: 'prevHash mismatch' });
    wrap(<ProofReceipts />);
    fireEvent.click(await screen.findByRole('button', { name: 'Verify whole chain' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Chain broken at sequence 5: prevHash mismatch (7 checked).');
  });

  it('pages through receipts and fetches the full auditor export only when asked', async () => {
    api.handler = (p) =>
      p.startsWith('/api/v1/proof/receipts?')
        ? Promise.resolve({ receipts: [RECEIPT(p.includes('offset=50') ? 51 : 1, 'verified')], total: 60, limit: 50, offset: p.includes('offset=50') ? 50 : 0, count: p.includes('offset=50') ? 10 : 50 })
        : Promise.reject(new ApiError({ code: 'X', message: 'Export unavailable', statusCode: 500 }));
    wrap(<ProofReceipts />);
    expect(await screen.findByText('1–50 of 60')).toBeInTheDocument();
    expect(api.calls.some((c) => c.path === '/api/v1/proof/export')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('51–60 of 60')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Export auditor bundle' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Export failed: Export unavailable');
  });
});

describe('Run Trace', () => {
  it('opens a run and draws its steps in order with outcome and receipt', async () => {
    api.handler = (p) =>
      p.startsWith('/api/v1/observability/traces')
        ? Promise.resolve({ traces: [{ id: 'tr1', root_agent_id: 'intake', channel: 'whatsapp', status: 'completed', total_latency_ms: 900, total_tokens_input: 10, total_tokens_output: 5, total_cost_usd: 0.002, started_at: '2026-10-02T09:00:00Z' }] })
        : Promise.resolve({
            runId: 'run1', graphId: 'intake', status: 'completed', outcome: 'verified', totalDurationMs: 900, totalCostUsd: 0.002, totalTokens: 15, verifications: [],
            nodes: [
              { nodeId: 'classify', nodeKind: 'model', visit: 1, step: 1, latencyMs: 400, costUsd: 0.001, status: 'completed', actionSummary: 'Classified intent' },
              { nodeId: 'book', nodeKind: 'tool', visit: 1, step: 2, latencyMs: 500, costUsd: 0.001, status: 'completed', actionSummary: 'Booked slot', proofReceiptId: 'r9', verificationState: 'verified' },
            ],
          });
    wrap(<RunTrace />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open trace tr1' }));
    const steps = await screen.findByRole('list', { name: 'Steps taken' });
    const items = steps.querySelectorAll('li');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('model · classify');
    expect(items[1]).toHaveTextContent('tool · book');
    expect(items[1]).toHaveTextContent('receipt r9');
    expect(api.calls).toContainEqual({ path: '/api/v1/observability/decision-traces/tr1', method: 'GET' });
  });

  it('a run that cannot be loaded shows the error', async () => {
    api.handler = (p) =>
      p.startsWith('/api/v1/observability/traces') ? Promise.resolve({ traces: [] }) : Promise.reject(new ApiError({ code: 'NOT_FOUND', message: 'Run not found', statusCode: 404 }));
    wrap(<RunTrace />);
    fireEvent.change(await screen.findByLabelText('Run or trace id'), { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(await screen.findByText('Run not found')).toBeInTheDocument();
  });
});

const JOB = (over: Partial<VerificationJob>): VerificationJob => ({
  id: 'vj1', run_id: 'run_1', tool_slug: 'schedule_book', status: 'pending', attempts: 1, max_attempts: 5,
  deadline_at: '2099-01-01T00:00:00Z', next_check_at: '2099-01-01T00:00:00Z', error_message: null, ...over,
});

describe('Verification Queue', () => {
  it('a pending check past its deadline is overdue; verified or future-deadline ones are not', () => {
    const now = Date.parse('2026-10-02T12:00:00Z');
    expect(isOverdue(JOB({ deadline_at: '2026-10-02T11:00:00Z' }), now)).toBe(true);
    expect(isOverdue(JOB({ deadline_at: '2026-10-02T13:00:00Z' }), now)).toBe(false);
    expect(isOverdue(JOB({ status: 'verified', deadline_at: '2026-10-02T11:00:00Z' }), now)).toBe(false);
  });

  it('opens on mismatched + expired checks, with their reason', async () => {
    api.handler = () => Promise.resolve({ jobs: [JOB({ id: 'vj2', status: 'mismatch', error_message: 'Calendar shows 11:00, expected 10:00' })], total: 1, limit: 50, offset: 0, count: 1 });
    wrap(<VerificationQueue />);
    expect(await screen.findByText('Verification mismatch')).toBeInTheDocument();
    expect(screen.getByText('Calendar shows 11:00, expected 10:00')).toBeInTheDocument();
    expect(api.calls[0].path).toBe('/api/v1/verification/jobs?status=mismatch%2Cexpired&limit=50&offset=0');
  });

  it('pending checks are never green and are flagged once past deadline', async () => {
    api.handler = () => Promise.resolve({ jobs: [JOB({ deadline_at: '2020-01-01T00:00:00Z' })], total: 1, limit: 50, offset: 0, count: 1 });
    wrap(<VerificationQueue />);
    fireEvent.click(await screen.findByRole('button', { name: 'Awaiting confirmation' }));
    await waitFor(() => expect(api.calls.some((c) => c.path.startsWith('/api/v1/verification/jobs?status=pending'))).toBe(true));
    expect(await screen.findByText('Pending verification')).toHaveClass('badge-blue');
    expect(screen.getByText('Past deadline')).toHaveClass('badge-red');
    expect(document.querySelector('.badge-green')).toBeNull();
  });

  it('an API failure shows the error, not an empty queue', async () => {
    api.handler = () => Promise.reject(new ApiError({ code: 'FORBIDDEN', message: 'Missing permission', statusCode: 403 }));
    wrap(<VerificationQueue />);
    expect(await screen.findByText(/Access denied/)).toBeInTheDocument();
    expect(screen.queryByText('No mismatched or expired verifications.')).not.toBeInTheDocument();
  });
});
