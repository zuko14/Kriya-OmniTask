import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TraceStep } from './TraceStep';

describe('TraceStep Primitive (§14.5, §18.5, M8)', () => {
  it('renders step number, actor, action, latency, and output summary', () => {
    render(
      <TraceStep
        stepNumber={1}
        timestamp="14:30:00.123"
        actor="Lead Qualification Agent"
        actorRole="Sales Specialist"
        action="rag:retrieve_pricing"
        status="succeeded"
        trustTier="A"
        latencyMs={45}
        tokens={240}
        inputSummary="Check annual pricing discount"
        outputSummary="Retrieved 15% annual discount tier"
        evidence={[
          { text: 'ERP Price Table', source: 'SAP ERP Master Data', trustTier: 'A' },
        ]}
      />
    );

    expect(screen.getByText('#1')).toBeInTheDocument();
    expect(screen.getByText('Lead Qualification Agent')).toBeInTheDocument();
    expect(screen.getByText('(Sales Specialist)')).toBeInTheDocument();
    expect(screen.getByText('rag:retrieve_pricing')).toBeInTheDocument();
    expect(screen.getByText('45ms')).toBeInTheDocument();
    expect(screen.getByText('240 tok')).toBeInTheDocument();
    expect(screen.getByText('Retrieved 15% annual discount tier')).toBeInTheDocument();
    expect(screen.getByText(/ERP Price Table/)).toBeInTheDocument();
  });
});
