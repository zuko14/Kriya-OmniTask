/**
 * Kriya AI — Organization Hierarchy Engine
 * Manages enterprise tree structures, department/squad hierarchies, cycle prevention, and subtree resolution.
 */

import { OrganizationUnit } from '../types/governanceTypes.js';

export class OrganizationHierarchyEngine {
  /**
   * Constructs a nested hierarchical tree from a flat list of organization units.
   */
  public static buildHierarchyTree(units: OrganizationUnit[]): OrganizationUnit[] {
    const unitMap = new Map<string, OrganizationUnit>();
    const roots: OrganizationUnit[] = [];

    // Clone and index
    for (const unit of units) {
      unitMap.set(unit.id, { ...unit, children: [] });
    }

    for (const unit of units) {
      const current = unitMap.get(unit.id)!;
      if (unit.parentUnitId && unitMap.has(unit.parentUnitId)) {
        const parent = unitMap.get(unit.parentUnitId)!;
        parent.children!.push(current);
      } else {
        roots.push(current);
      }
    }

    return roots;
  }

  /**
   * Checks if assigning a parent unit would create a circular dependency.
   */
  public static wouldCreateCycle(
    units: OrganizationUnit[],
    unitId: string,
    proposedParentId: string
  ): boolean {
    if (unitId === proposedParentId) return true;

    const unitMap = new Map<string, OrganizationUnit>();
    for (const u of units) {
      unitMap.set(u.id, u);
    }

    let currentParent = unitMap.get(proposedParentId);
    while (currentParent) {
      if (currentParent.id === unitId) {
        return true; // Cycle detected
      }
      if (!currentParent.parentUnitId) break;
      currentParent = unitMap.get(currentParent.parentUnitId);
    }

    return false;
  }

  /**
   * Retrieves all unit IDs belonging to a given unit and its complete descendant subtree.
   */
  public static getSubtreeUnitIds(units: OrganizationUnit[], rootUnitId: string): string[] {
    const result: string[] = [rootUnitId];
    const tree = this.buildHierarchyTree(units);

    function findAndCollect(nodes: OrganizationUnit[], targetId: string, isCollecting: boolean) {
      for (const node of nodes) {
        const collectThisBranch = isCollecting || node.id === targetId;
        if (collectThisBranch && node.id !== targetId) {
          result.push(node.id);
        }
        if (node.children && node.children.length > 0) {
          findAndCollect(node.children, targetId, collectThisBranch);
        }
      }
    }

    findAndCollect(tree, rootUnitId, false);
    return result;
  }
}
