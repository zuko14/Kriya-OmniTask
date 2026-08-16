import { describe, it, expect } from 'vitest';
import { OrganizationGraph } from '../../src/digitaltwin/graph/organizationGraph.js';
import { DigitalTwinEntityRecord, DigitalTwinRelationshipRecord } from '../../src/digitaltwin/types/digitalTwinTypes.js';

describe('Organization Graph Topology Unit Tests', () => {
  const mockEntities: DigitalTwinEntityRecord[] = [
    {
      id: 'ent_corp',
      tenant_id: 'tenant_1',
      organization_id: 'default',
      entity_type: 'department',
      name: 'Global Enterprise HQ',
      slug: 'global-hq',
      properties_json: JSON.stringify({ budgetUsd: 1000000 }),
      status: 'active',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
    {
      id: 'ent_sales_dept',
      tenant_id: 'tenant_1',
      organization_id: 'default',
      entity_type: 'department',
      name: 'Commercial Sales Department',
      slug: 'sales-dept',
      parent_entity_id: 'ent_corp',
      properties_json: '{}',
      status: 'active',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
    {
      id: 'ent_lead_team',
      tenant_id: 'tenant_1',
      organization_id: 'default',
      entity_type: 'department',
      name: 'Inbound Lead Qualification Team',
      slug: 'lead-team',
      parent_entity_id: 'ent_sales_dept',
      properties_json: '{}',
      status: 'active',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
    {
      id: 'ent_product_saas',
      tenant_id: 'tenant_1',
      organization_id: 'default',
      entity_type: 'product',
      name: 'Enterprise Cloud AI Suite',
      slug: 'ai-suite',
      properties_json: JSON.stringify({ tier: 'enterprise', basePriceMonthly: 499 }),
      status: 'active',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
  ];

  const mockRelationships: DigitalTwinRelationshipRecord[] = [
    {
      id: 'rel_1',
      tenant_id: 'tenant_1',
      source_entity_id: 'ent_sales_dept',
      target_entity_id: 'ent_product_saas',
      relationship_type: 'delivers',
      properties_json: '{}',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
    {
      id: 'rel_2',
      tenant_id: 'tenant_1',
      source_entity_id: 'ent_lead_team',
      target_entity_id: 'ent_sales_dept',
      relationship_type: 'reports_to',
      properties_json: '{}',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
  ];

  it('should construct topology graph with correct node counts and metadata', () => {
    const graph = new OrganizationGraph(mockEntities, mockRelationships);
    const view = graph.toGraphView();

    expect(view.totalEntities).toBe(4);
    expect(view.totalRelationships).toBe(2);
    expect(view.rootDepartments.length).toBe(1);
    expect(view.rootDepartments[0].name).toBe('Global Enterprise HQ');
  });

  it('should traverse upward escalation chain correctly', () => {
    const graph = new OrganizationGraph(mockEntities, mockRelationships);
    const chain = graph.getEscalationChain('ent_lead_team');

    expect(chain.length).toBe(3);
    expect(chain[0].id).toBe('ent_lead_team');
    expect(chain[1].id).toBe('ent_sales_dept');
    expect(chain[2].id).toBe('ent_corp');
  });

  it('should find delivered products/services contained by department', () => {
    const graph = new OrganizationGraph(mockEntities, mockRelationships);
    const delivered = graph.getContainedEntities('ent_sales_dept');

    expect(delivered.length).toBe(1);
    expect(delivered[0].id).toBe('ent_product_saas');
    expect(delivered[0].name).toBe('Enterprise Cloud AI Suite');
  });
});
