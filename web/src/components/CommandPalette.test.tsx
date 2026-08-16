import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { BrowserRouter } from 'react-router';
import { CommandPalette } from './CommandPalette';

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

describe('CommandPalette Component', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders command palette modal when open and displays static nav shortcuts', () => {
    const handleClose = vi.fn();

    render(
      <BrowserRouter>
        <CommandPalette isOpen={true} onClose={handleClose} />
      </BrowserRouter>
    );

    expect(screen.getByPlaceholderText(/Search commands, customers, agents, workflows/i)).toBeInTheDocument();
    expect(screen.getByText('Executive Overview')).toBeInTheDocument();
    expect(screen.getByText('Customer 360')).toBeInTheDocument();
    expect(screen.getByText('Platform Control Plane')).toBeInTheDocument();
  });

  it('does not render when isOpen is false', () => {
    render(
      <BrowserRouter>
        <CommandPalette isOpen={false} onClose={vi.fn()} />
      </BrowserRouter>
    );

    expect(screen.queryByPlaceholderText(/Search commands/i)).not.toBeInTheDocument();
  });

  it('filters static nav and calls onClose when backdrop is clicked', () => {
    const handleClose = vi.fn();

    render(
      <BrowserRouter>
        <CommandPalette isOpen={true} onClose={handleClose} />
      </BrowserRouter>
    );

    const input = screen.getByPlaceholderText(/Search commands/i);
    fireEvent.change(input, { target: { value: 'Security' } });

    expect(screen.getByText('Platform Security Center')).toBeInTheDocument();
    expect(screen.queryByText('Executive Overview')).not.toBeInTheDocument();

    const backdrop = screen.getByTestId('command-palette-backdrop');
    fireEvent.click(backdrop);
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('fetches dynamic entities on search input', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('/api/v1/customers')) {
        return Promise.resolve(jsonResponse({ customers: [{ id: 'cust_777', name: 'John Global', email: 'john@global.com' }] }));
      }
      if (url.includes('/api/v1/workforce/agents')) {
        return Promise.resolve(jsonResponse({ agents: [{ id: 'agent_999', name: 'Support Bot Alpha', role: 'support' }] }));
      }
      if (url.includes('/api/v1/workflows')) {
        return Promise.resolve(jsonResponse({ workflows: [{ id: 'wf_111', name: 'Onboarding Pipeline', slug: 'onboarding-pipeline' }] }));
      }
      return Promise.resolve(jsonResponse({}, false, 404));
    });

    vi.stubGlobal('fetch', fetchMock);

    render(
      <BrowserRouter>
        <CommandPalette isOpen={true} onClose={vi.fn()} />
      </BrowserRouter>
    );

    const input = screen.getByPlaceholderText(/Search commands/i);
    fireEvent.change(input, { target: { value: 'John' } });

    await waitFor(() => {
      expect(screen.getByText('John Global')).toBeInTheDocument();
    });

    expect(screen.getByText('Customers')).toBeInTheDocument();
  });
});
