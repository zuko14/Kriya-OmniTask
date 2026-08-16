/**
 * Xylarc AI — Organizational Graph Topology Engine
 * In-memory graph adjacency model for department hierarchies, service delivery paths, and escalation chains (§13 of CLAUDE.md).
 */

import {
  DigitalTwinEntityRecord,
  DigitalTwinRelationshipRecord,
  OrganizationGraphNode,
  OrganizationGraphEdge,
  OrganizationGraphView,
} from '../types/digitalTwinTypes.js';

export class OrganizationGraph {
  private nodes: Map<string, OrganizationGraphNode> = new Map();
  private outgoingEdges: Map<string, OrganizationGraphEdge[]> = new Map();
  private incomingEdges: Map<string, OrganizationGraphEdge[]> = new Map();

  constructor(entities: DigitalTwinEntityRecord[] = [], relationships: DigitalTwinRelationshipRecord[] = []) {
    this.buildGraph(entities, relationships);
  }

  /**
   * Constructs the in-memory graph from relational entities and edges.
   */
  public buildGraph(entities: DigitalTwinEntityRecord[], relationships: DigitalTwinRelationshipRecord[]): void {
    this.nodes.clear();
    this.outgoingEdges.clear();
    this.incomingEdges.clear();

    for (const entity of entities) {
      let properties = {};
      try {
        properties = JSON.parse(entity.properties_json || '{}');
      } catch {}

      const node: OrganizationGraphNode = {
        id: entity.id,
        name: entity.name,
        slug: entity.slug,
        type: entity.entity_type,
        parentEntityId: entity.parent_entity_id,
        properties,
        status: entity.status,
      };

      this.nodes.set(node.id, node);
      this.outgoingEdges.set(node.id, []);
      this.incomingEdges.set(node.id, []);
    }

    for (const rel of relationships) {
      let properties = {};
      try {
        properties = JSON.parse(rel.properties_json || '{}');
      } catch {}

      const edge: OrganizationGraphEdge = {
        id: rel.id,
        source: rel.source_entity_id,
        target: rel.target_entity_id,
        type: rel.relationship_type,
        properties,
      };

      if (this.outgoingEdges.has(edge.source)) {
        this.outgoingEdges.get(edge.source)!.push(edge);
      }
      if (this.incomingEdges.has(edge.target)) {
        this.incomingEdges.get(edge.target)!.push(edge);
      }
    }
  }

  /**
   * Retrieves a node by entity ID.
   */
  public getNode(id: string): OrganizationGraphNode | undefined {
    return this.nodes.get(id);
  }

  /**
   * Finds the hierarchical escalation chain upwards (e.g. Employee -> Team -> Department -> Executive).
   */
  public getEscalationChain(startEntityId: string): OrganizationGraphNode[] {
    const chain: OrganizationGraphNode[] = [];
    const visited = new Set<string>();
    let currentId: string | undefined = startEntityId;

    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      const node = this.nodes.get(currentId);
      if (!node) break;
      chain.push(node);

      // Check 'reports_to' relationship or parentEntityId
      const edges: OrganizationGraphEdge[] = this.outgoingEdges.get(currentId) || [];
      const reportsToEdge: OrganizationGraphEdge | undefined = edges.find(
        (e) => e.type === 'reports_to'
      );

      if (reportsToEdge) {
        currentId = reportsToEdge.target;
      } else if (node.parentEntityId) {
        currentId = node.parentEntityId;
      } else {
        currentId = undefined;
      }
    }

    return chain;
  }

  /**
   * Finds all sub-entities (children, services, products, teams) owned or contained by a department.
   */
  public getContainedEntities(departmentId: string): OrganizationGraphNode[] {
    const results: OrganizationGraphNode[] = [];
    const visited = new Set<string>();
    const queue = [departmentId];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);

      const edges = this.outgoingEdges.get(current) || [];
      for (const edge of edges) {
        if (edge.type === 'contains' || edge.type === 'produces' || edge.type === 'delivers') {
          const targetNode = this.nodes.get(edge.target);
          if (targetNode && !visited.has(targetNode.id)) {
            results.push(targetNode);
            queue.push(targetNode.id);
          }
        }
      }
    }

    return results;
  }

  /**
   * Exports full organizational topology view.
   */
  public toGraphView(): OrganizationGraphView {
    const allNodes = Array.from(this.nodes.values());
    const allEdges: OrganizationGraphEdge[] = [];
    for (const edges of this.outgoingEdges.values()) {
      allEdges.push(...edges);
    }

    const rootDepartments = allNodes.filter(
      (n) => n.type === 'department' && !n.parentEntityId
    );

    return {
      nodes: allNodes,
      edges: allEdges,
      rootDepartments,
      totalEntities: allNodes.length,
      totalRelationships: allEdges.length,
    };
  }
}
