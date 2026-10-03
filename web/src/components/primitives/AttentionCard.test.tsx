import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AttentionCard } from './AttentionCard';

describe('AttentionCard Primitive (§14.5, M8)', () => {
  it('renders priority, title, description, SLA, and handles inline actions', () => {
    const onApprove = vi.fn();
    const onReject = vi.fn();
    const onClaim = vi.fn();

    render(
      <AttentionCard
        item={{
          id: 'att_test_1',
          title: 'High-Value Pricing Override',
          description: 'Client requested 20% discount which exceeds autonomous threshold.',
          priority: 'P1_HIGH',
          status: 'pending',
          sourceAgentId: 'sales_agent',
          channel: 'whatsapp',
          slaExpiresAt: '25m remaining',
          recommendedAction: 'Approve if annual contract commits to 12 months minimum.',
        }}
        onApprove={onApprove}
        onReject={onReject}
        onClaim={onClaim}
      />
    );

    expect(screen.getByText('P1 · HIGH')).toBeInTheDocument();
    expect(screen.getByText('PENDING')).toBeInTheDocument();
    expect(screen.getByText('High-Value Pricing Override')).toBeInTheDocument();
    expect(screen.getByText(/Client requested 20% discount/)).toBeInTheDocument();
    expect(screen.getByText(/Approve if annual contract commits/)).toBeInTheDocument();
    expect(screen.getByText(/SLA: 25m remaining/)).toBeInTheDocument();

    // Claim button
    const claimBtn = screen.getByRole('button', { name: /Claim Item/i });
    fireEvent.click(claimBtn);
    expect(onClaim).toHaveBeenCalledTimes(1);

    // Approve button
    const approveBtn = screen.getByRole('button', { name: /Approve/i });
    fireEvent.click(approveBtn);
    expect(onApprove).toHaveBeenCalledTimes(1);

    // Reject button
    const rejectBtn = screen.getByRole('button', { name: /Reject/i });
    fireEvent.click(rejectBtn);
    expect(onReject).toHaveBeenCalledTimes(1);
  });
});
