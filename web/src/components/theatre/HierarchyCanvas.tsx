import React from 'react';
import styles from './HierarchyCanvas.module.css';

export interface HierarchyAgentNode {
  id: string;
  name: string;
  role: string;
  depth: number;
  state: 'live' | 'idle' | 'attention' | 'halt' | 'learning' | 'info';
  load: number; // 0 to 1
  isCanary?: boolean;
  parentId?: string;
  x: number;
  y: number;
}

export interface LiveDelegationEdge {
  fromId: string;
  toId: string;
  status: 'delegating' | 'failing' | 'repairing' | 'idle';
}

export interface HierarchyCanvasProps {
  nodes?: HierarchyAgentNode[];
  edges?: LiveDelegationEdge[];
  selectedAgentId?: string | null;
  onSelectAgent?: (agentId: string) => void;
}

// Default roster hierarchy layout if not passed explicitly
const DEFAULT_HIERARCHY_NODES: HierarchyAgentNode[] = [
  { id: 'orchestrator', name: 'Orchestrator', role: 'Executive Dispatcher', depth: 0, state: 'live', load: 0.8, x: 250, y: 55 },
  { id: 'supervisor_sales', name: 'Sales Sup.', role: 'Revenue Lead', depth: 1, parentId: 'orchestrator', state: 'live', load: 0.7, x: 100, y: 155 },
  { id: 'supervisor_support', name: 'Support Sup.', role: 'Care Lead', depth: 1, parentId: 'orchestrator', state: 'live', load: 0.9, x: 250, y: 155 },
  { id: 'supervisor_ops', name: 'Ops Sup.', role: 'Fulfillment Lead', depth: 1, parentId: 'orchestrator', state: 'live', load: 0.4, x: 400, y: 155 },
  { id: 'lead_qual', name: 'Lead Qual', role: 'BANT Specialist', depth: 2, parentId: 'supervisor_sales', state: 'live', load: 0.85, x: 50, y: 265 },
  { id: 'booking', name: 'Booking', role: 'Calendar Specialist', depth: 2, parentId: 'supervisor_sales', state: 'live', load: 0.5, x: 150, y: 265 },
  { id: 'support_care', name: 'Customer Care', role: 'Omnichannel Agent', depth: 2, parentId: 'supervisor_support', state: 'live', load: 0.95, x: 250, y: 265 },
  { id: 'retention', name: 'Retention', role: 'Churn Specialist', depth: 2, parentId: 'supervisor_ops', isCanary: true, state: 'learning', load: 0.3, x: 350, y: 265 },
  { id: 'insights', name: 'Insights', role: 'BI Analytics', depth: 2, parentId: 'supervisor_ops', state: 'idle', load: 0.1, x: 450, y: 265 },
];

const DEFAULT_EDGES: LiveDelegationEdge[] = [
  { fromId: 'orchestrator', toId: 'supervisor_sales', status: 'delegating' },
  { fromId: 'orchestrator', toId: 'supervisor_support', status: 'idle' },
  { fromId: 'orchestrator', toId: 'supervisor_ops', status: 'idle' },
  { fromId: 'supervisor_sales', toId: 'lead_qual', status: 'delegating' },
  { fromId: 'supervisor_sales', toId: 'booking', status: 'idle' },
  { fromId: 'supervisor_support', toId: 'support_care', status: 'idle' },
  { fromId: 'supervisor_ops', toId: 'retention', status: 'idle' },
  { fromId: 'supervisor_ops', toId: 'insights', status: 'idle' },
];

export function HierarchyCanvas({
  nodes = DEFAULT_HIERARCHY_NODES,
  edges = DEFAULT_EDGES,
  selectedAgentId,
  onSelectAgent,
}: HierarchyCanvasProps) {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  const getSignalColor = (state: string) => {
    switch (state) {
      case 'live':
        return 'var(--green)';
      case 'attention':
        return 'var(--amber)';
      case 'halt':
        return 'var(--red)';
      case 'learning':
        return 'var(--purple)';
      case 'info':
        return 'var(--accent)';
      default:
        return 'var(--text3)';
    }
  };

  return (
    <div className={styles.canvasContainer} data-testid="hierarchy-canvas">
      <div className={styles.canvasHeader}>
        <span>Hierarchy Canvas · Live Delegation</span>
        <span>{nodes.length} Nodes</span>
      </div>

      <svg
        className={styles.svgViewport}
        viewBox="0 0 500 330"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Agent delegation and hierarchy graph"
      >
        {/* Render Edges */}
        <g className="edges-layer">
          {edges.map((edge) => {
            const from = nodeMap.get(edge.fromId);
            const to = nodeMap.get(edge.toId);
            if (!from || !to) return null;

            const edgeKey = `${edge.fromId}->${edge.toId}`;
            const pathData = `M ${from.x} ${from.y + 14} C ${from.x} ${(from.y + to.y) / 2}, ${to.x} ${(from.y + to.y) / 2}, ${to.x} ${to.y - 14}`;

            return (
              <g key={edgeKey}>
                {/* Base passive wire */}
                <path d={pathData} className={styles.edgeBase} />

                {/* Animated delegation light (supervisor -> specialist) */}
                {edge.status === 'delegating' && (
                  <path d={pathData} className={styles.edgeDelegation} data-testid={`delegation-edge-${edgeKey}`} />
                )}

                {/* Animated failure cascade upward (specialist -> supervisor) */}
                {(edge.status === 'failing' || edge.status === 'repairing') && (
                  <path d={pathData} className={styles.edgeFailureCascade} data-testid={`failure-edge-${edgeKey}`} />
                )}
              </g>
            );
          })}
        </g>

        {/* Render Nodes */}
        <g className="nodes-layer">
          {nodes.map((node) => {
            const isSelected = selectedAgentId === node.id;
            const isExecuting = node.load > 0.4 && node.state === 'live';
            const radius = 12 + Math.round(node.load * 8); // dynamic size by load
            const fill = getSignalColor(node.state);

            return (
              <g
                key={node.id}
                className={styles.nodeGroup}
                tabIndex={0}
                role="button"
                aria-label={`Agent ${node.name}, state ${node.state}, load ${Math.round(node.load * 100)} percent`}
                onClick={() => onSelectAgent?.(node.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelectAgent?.(node.id);
                  }
                }}
                data-testid={`node-${node.id}`}
              >
                {/* Canary dashed halo */}
                {node.isCanary && (
                  <circle cx={node.x} cy={node.y} r={radius + 5} className={styles.nodeCanaryRing} />
                )}

                {/* Selected highlight ring */}
                {isSelected && (
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={radius + 4}
                    stroke="var(--border2)"
                    strokeWidth="2"
                    fill="none"
                  />
                )}

                {/* Main agent circle node */}
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={radius}
                  fill={fill}
                  stroke={isSelected ? 'var(--text)' : 'var(--border)'}
                  className={`${styles.nodeCircle} ${isExecuting ? styles.nodePulse : ''}`}
                />

                {/* Text Label */}
                <text x={node.x} y={node.y + radius + 14} className={styles.nodeLabel}>
                  {node.name}
                </text>

                {/* State glyph & role */}
                <text x={node.x} y={node.y + radius + 26} className={styles.nodeMeta}>
                  {node.role} · {Math.round(node.load * 100)}%
                </text>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
