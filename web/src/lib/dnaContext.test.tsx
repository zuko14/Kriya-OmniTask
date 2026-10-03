/**
 * Kriya Omnitask — Business DNA Context & Sidebar Navigation Tests (§3, §4, §18)
 * Verifies dynamic vocabulary, capability gating, and absent features in UI navigation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router';
import { DnaProvider, useBusinessDna, ResolvedTenantDna } from './dnaContext';
import { Sidebar } from '../shell/Sidebar';

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

const mockRetailDna: ResolvedTenantDna = {
  tenantId: 'tenant_retail_test',
  activeManifest: {
    id: 'manifest_v1_retail',
    tenant_id: 'tenant_retail_test',
    version: 1,
    dna_profile_id: 'dna_retail_commerce',
    dna_profile_version: '1.0.0',
    entity_vocabulary: {
      customer: 'Shopper',
      customer_plural: 'Shoppers',
      item: 'Product',
      item_plural: 'Products',
      transaction: 'Order',
      transaction_plural: 'Orders',
      appointment: 'Delivery Slot',
      agent_term: 'Store Assistant',
      custom_labels: { cart: 'Shopping Bag' },
    },
    capabilities: ['product_catalog', 'order_tracking', 'returns_management', 'lead_qualification'],
    lifecycle_stages: ['discovery', 'evaluation', 'order_placed'],
    agents: [
      {
        id: 'agent_1',
        slug: 'customer_support',
        name: 'Store & Order Assistant',
        role: 'Customer Support Specialist',
        description: 'Handles product inquiries',
        min_model_tier: 'T2',
        ceiling_autonomy: 'L2',
        skills: ['catalog_search'],
        tools: ['inventory_lookup'],
        forbidden_actions: [],
        escalation_defaults: [],
        is_optional: false,
        is_active: true,
      },
    ],
    checksum: 'sha256_mock_retail_checksum',
    status: 'active',
    created_by: 'usr_operator',
    created_at: new Date().toISOString(),
  },
  dnaProfile: {
    id: 'dna_retail_commerce',
    version: '1.0.0',
    business_type: 'retail_commerce',
    display_name: 'Retail & Digital Commerce',
    description: 'Retail commerce operations',
    lifecycle_model: {
      stages: ['discovery', 'evaluation', 'order_placed'],
      initial_stage: 'discovery',
      terminal_stages: [],
    },
    entity_vocabulary: {
      customer: 'Shopper',
      customer_plural: 'Shoppers',
      item: 'Product',
      item_plural: 'Products',
      transaction: 'Order',
      transaction_plural: 'Orders',
      appointment: 'Delivery Slot',
      agent_term: 'Store Assistant',
      custom_labels: { cart: 'Shopping Bag' },
    },
    capabilities: ['product_catalog', 'order_tracking', 'returns_management', 'lead_qualification'],
    required_agents: [],
    optional_agents: [],
    forbidden_actions: [],
    compliance_profile: {},
    default_kpis: [{ id: 'gmv', label: 'Daily GMV', unit: '₹', format: 'currency' }],
    knowledge_schema: [],
    escalation_defaults: [],
    skill_grants: [],
    external_retrieval_policy: { allowed: true, allowed_domains: [] },
    min_tier_requirements: {},
    is_active: true,
  },
  vocabulary: {
    customer: 'Shopper',
    customer_plural: 'Shoppers',
    item: 'Product',
    item_plural: 'Products',
    transaction: 'Order',
    transaction_plural: 'Orders',
    appointment: 'Delivery Slot',
    agent_term: 'Store Assistant',
    custom_labels: { cart: 'Shopping Bag' },
  },
  capabilities: ['product_catalog', 'order_tracking', 'returns_management', 'lead_qualification'],
  lifecycleStages: ['discovery', 'evaluation', 'order_placed'],
  agents: [
    {
      id: 'agent_1',
      slug: 'customer_support',
      name: 'Store & Order Assistant',
      role: 'Customer Support Specialist',
      description: 'Handles product inquiries',
      min_model_tier: 'T2',
      ceiling_autonomy: 'L2',
      skills: ['catalog_search'],
      tools: ['inventory_lookup'],
      forbidden_actions: [],
      escalation_defaults: [],
      is_optional: false,
      is_active: true,
    },
  ],
  kpis: [{ id: 'gmv', label: 'Daily GMV', unit: '₹', format: 'currency' }],
};

const mockAutomotiveDna: ResolvedTenantDna = {
  ...mockRetailDna,
  vocabulary: {
    customer: 'Vehicle Owner',
    customer_plural: 'Vehicle Owners',
    item: 'Vehicle',
    item_plural: 'Vehicles',
    transaction: 'Deal',
    transaction_plural: 'Deals',
    appointment: 'Test Drive / Service Booking',
    agent_term: 'Dealership Concierge',
    custom_labels: { service_bay: 'Workshop Bay' },
  },
  capabilities: ['vehicle_inventory', 'test_drive_scheduling', 'service_appointment_booking', 'lead_qualification'],
};

function DummyDnaConsumer() {
  const { vocabulary, hasCapability } = useBusinessDna();
  return (
    <div>
      <div data-testid="customer-label">{vocabulary.customer}</div>
      <div data-testid="customer-plural">{vocabulary.customer_plural}</div>
      <div data-testid="item-label">{vocabulary.item}</div>
      <div data-testid="has-returns">{String(hasCapability('returns_management'))}</div>
      <div data-testid="has-vehicles">{String(hasCapability('vehicle_inventory'))}</div>
    </div>
  );
}

describe('Business DNA Frontend Integration (§3, §4, §18)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves Retail DNA vocabulary and capability checks', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.includes('/dna')) {
          return Promise.resolve(jsonResponse(mockRetailDna));
        }
        return Promise.resolve(jsonResponse({}, false, 404));
      })
    );

    render(
      <DnaProvider tenantId="tenant_retail_test">
        <DummyDnaConsumer />
      </DnaProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('customer-label').textContent).toBe('Shopper');
      expect(screen.getByTestId('customer-plural').textContent).toBe('Shoppers');
      expect(screen.getByTestId('item-label').textContent).toBe('Product');
      expect(screen.getByTestId('has-returns').textContent).toBe('true');
      expect(screen.getByTestId('has-vehicles').textContent).toBe('false');
    });
  });

  it('dynamically adapts Sidebar navigation to Automotive vocabulary (§18)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.includes('/dna')) {
          return Promise.resolve(jsonResponse(mockAutomotiveDna));
        }
        return Promise.resolve(jsonResponse({}, false, 404));
      })
    );

    render(
      <BrowserRouter>
        <DnaProvider tenantId="tenant_auto_test">
          <Sidebar plane="client" isOpen={false} />
        </DnaProvider>
      </BrowserRouter>
    );

    // Sidebar navigation link label is dynamically transformed from "Customers" to "Vehicle Owners"
    expect(await screen.findByText('Vehicle Owners')).toBeInTheDocument();
    expect(screen.getByText('Today')).toBeInTheDocument();
    expect(screen.getByText('Workforce')).toBeInTheDocument();
  });
});
