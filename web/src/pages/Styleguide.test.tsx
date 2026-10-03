import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Styleguide } from './Styleguide';

describe('Styleguide Page Component (§14, §23 M8)', () => {
  it('renders design system title and token hierarchy on tokens tab', () => {
    render(<Styleguide />);
    expect(screen.getByText(/Design Tokens & Component Primitives/i)).toBeInTheDocument();
    expect(screen.getByText(/Ground Color Hierarchy/i)).toBeInTheDocument();
    expect(screen.getByText(/Signal Colors & Provenance/i)).toBeInTheDocument();
    // Documents the shipped Kriya tokens, not the retired slate palette (WP-7.4).
    expect(screen.getByText('--bg')).toBeInTheDocument();
    expect(screen.getByText('#040A11')).toBeInTheDocument();
    expect(screen.queryByText('#0E141B')).not.toBeInTheDocument();
    expect(screen.queryByText('--ink')).not.toBeInTheDocument();
  });

  it('renders typography scale on typography tab', () => {
    render(<Styleguide />);
    const typoTab = screen.getByRole('button', { name: /typography/i });
    fireEvent.click(typoTab);

    expect(screen.getByText('IBM Plex Sans')).toBeInTheDocument();
    expect(screen.getByText('IBM Plex Sans Regular')).toBeInTheDocument();
    expect(screen.getByText('System monospace')).toBeInTheDocument();
    expect(screen.queryByText(/Archivo|Public Sans/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Type Scale/i)).toBeInTheDocument();
  });

  it('renders all §14 primitives on primitives tab', () => {
    render(<Styleguide />);
    const primitivesTab = screen.getByRole('button', { name: /primitives/i });
    fireEvent.click(primitivesTab);

    // Signature RosterRow
    expect(screen.getByText(/RosterRow — Signature Fleet Component/i)).toBeInTheDocument();
    expect(screen.getByText('Workforce Orchestrator')).toBeInTheDocument();
    expect(screen.getAllByText('Lead Qualification Agent').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('CANARY')).toBeInTheDocument();

    // TraceStep
    expect(screen.getByText(/TraceStep — Decision Trace Elements/i)).toBeInTheDocument();
    expect(screen.getByText('#1')).toBeInTheDocument();

    // AttentionCard
    expect(screen.getByText(/AttentionCard — Human Attention Center/i)).toBeInTheDocument();
    expect(screen.getByText(/Data Conflict: Pricing Mismatch/i)).toBeInTheDocument();

    // MetricBlock
    expect(screen.getByText(/MetricBlock with Strict Provenance/i)).toBeInTheDocument();
    expect(screen.getByText('8,421')).toBeInTheDocument();
  });
});
