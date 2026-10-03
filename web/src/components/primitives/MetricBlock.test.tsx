import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MetricBlock } from './MetricBlock';

describe('MetricBlock Primitive (§14.3, M1)', () => {
  it('renders value, label, source, and timestamp when provided', () => {
    render(
      <MetricBlock
        label="Conversations Handled"
        value="4,812"
        delta="8.5%"
        deltaDirection="positive"
        source="conversation_gateway"
        timestamp="2026-08-20T08:00:00Z"
      />
    );

    expect(screen.getByText('Conversations Handled')).toBeInTheDocument();
    expect(screen.getByText('4,812')).toBeInTheDocument();
    expect(screen.getByText(/8.5%/)).toBeInTheDocument();
    expect(screen.getByText(/src: conversation_gateway/)).toBeInTheDocument();
    expect(screen.getByText(/2026-08-20T08:00:00Z/)).toBeInTheDocument();
  });

  it('renders external diamond marker when trust tier is C or D', () => {
    render(
      <MetricBlock
        label="Competitor Index"
        value="88.2"
        source="web_research_agent"
        timestamp="10m ago"
        trustTier="C"
      />
    );

    expect(screen.getByTitle(/External \/ Untrusted data provenance/i)).toBeInTheDocument();
  });

  it('throws an error in development if source or timestamp is omitted', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => {
      render(
        <MetricBlock
          label="Invalid Metric"
          value="100"
          source=""
          timestamp=""
        />
      );
    }).toThrow(/Critical governance violation/i);

    spy.mockRestore();
  });
});
