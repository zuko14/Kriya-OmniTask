import { describe, it, expect } from 'vitest';
import { OrganizationHierarchyEngine } from '../../src/governance/org/organizationHierarchyEngine.js';
import { OrganizationUnit } from '../../src/governance/types/governanceTypes.js';

describe('OrganizationHierarchyEngine Unit Tests', () => {
  const sampleUnits: OrganizationUnit[] = [
    {
      id: 'unit_div_sales',
      tenantId: 'tenant_1',
      name: 'Global Sales Division',
      code: 'DIV_SALES',
      unitType: 'division',
      metadata: {},
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 'unit_dept_na',
      tenantId: 'tenant_1',
      parentUnitId: 'unit_div_sales',
      name: 'North America Enterprise',
      code: 'DEPT_NA',
      unitType: 'department',
      metadata: {},
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
    {
      id: 'unit_squad_sdr',
      tenantId: 'tenant_1',
      parentUnitId: 'unit_dept_na',
      name: 'Inbound SDR Squad',
      code: 'SQ_SDR',
      unitType: 'squad',
      metadata: {},
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
  ];

  it('should construct a multi-level hierarchy tree from flat unit records', () => {
    const tree = OrganizationHierarchyEngine.buildHierarchyTree(sampleUnits);
    expect(tree.length).toBe(1);
    expect(tree[0].id).toBe('unit_div_sales');
    expect(tree[0].children?.length).toBe(1);
    expect(tree[0].children![0].id).toBe('unit_dept_na');
    expect(tree[0].children![0].children?.length).toBe(1);
    expect(tree[0].children![0].children![0].id).toBe('unit_squad_sdr');
  });

  it('should detect and prevent circular hierarchy dependencies', () => {
    const isCycle = OrganizationHierarchyEngine.wouldCreateCycle(
      sampleUnits,
      'unit_div_sales',
      'unit_squad_sdr' // Attempting to make squad the parent of the top-level division
    );
    expect(isCycle).toBe(true);

    const isNotCycle = OrganizationHierarchyEngine.wouldCreateCycle(
      sampleUnits,
      'unit_new_team',
      'unit_squad_sdr'
    );
    expect(isNotCycle).toBe(false);
  });

  it('should resolve all descendant unit IDs within a subtree', () => {
    const descendantIds = OrganizationHierarchyEngine.getSubtreeUnitIds(sampleUnits, 'unit_div_sales');
    expect(descendantIds).toContain('unit_div_sales');
    expect(descendantIds).toContain('unit_dept_na');
    expect(descendantIds).toContain('unit_squad_sdr');
    expect(descendantIds.length).toBe(3);
  });
});
