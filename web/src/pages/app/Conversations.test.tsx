import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router';
import { Conversations } from './Conversations';

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

describe('Conversations Page', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('renders outbound dispatch form and channel status', async () => {
    render(
      <BrowserRouter>
        <Conversations />
      </BrowserRouter>
    );

    expect(await screen.findByText('Channel Conversations & Outbound Dispatch')).toBeInTheDocument();
    expect(await screen.findByText('WhatsApp Cloud API')).toBeInTheDocument();
    expect(await screen.findByText('Voice WebRTC / SIP')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /Send Message/i })).toBeInTheDocument();
  });

  it('allows submitting outbound message to /api/v1/channels/send', async () => {
    const fetchMock = vi.fn((url: string, opts?: RequestInit) => {
      if (url.includes('/api/v1/channels/send') && opts?.method === 'POST') {
        return Promise.resolve(jsonResponse({ status: 'queued', messageId: 'msg_test_999' }));
      }
      return Promise.resolve(jsonResponse({}, false, 404));
    });

    vi.stubGlobal('fetch', fetchMock);

    render(
      <BrowserRouter>
        <Conversations />
      </BrowserRouter>
    );

    const recipientInput = screen.getByLabelText(/Recipient/i);
    fireEvent.change(recipientInput, { target: { value: '+14155551234' } });

    const messageInput = screen.getByLabelText(/Message Content/i);
    fireEvent.change(messageInput, { target: { value: 'Your scheduled appointment is confirmed.' } });

    const submitBtns = await screen.findAllByRole('button', { name: /Send Message/i });
    fireEvent.click(submitBtns[0]);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/channels/send'),
        expect.objectContaining({ method: 'POST' })
      );
    });

    expect(await screen.findByText(/Message dispatched successfully/i)).toBeInTheDocument();
  });
});
