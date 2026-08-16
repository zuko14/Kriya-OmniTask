/**
 * Xylarc AI — Distributed Waterfall Trace Visualizer
 * Hierarchical span tree builder with relative time-offset alignment and critical path bottleneck detection.
 */

import { ExecutionSpanRecord } from '../../observability/types/observabilityTypes.js';
import { WaterfallSpanNode, WaterfallTraceView } from '../types/sreTypes.js';

export class WaterfallTraceVisualizer {
  /**
   * Transforms a collection of flat spans into a structured waterfall visualization tree.
   */
  public static buildWaterfallView(traceId: string, spans: ExecutionSpanRecord[]): WaterfallTraceView {
    if (!spans || spans.length === 0) {
      return {
        traceId,
        rootSpanName: 'empty_trace',
        totalDurationMs: 0,
        spanCount: 0,
        criticalPathDurationMs: 0,
        tree: [],
      };
    }

    // Find earliest start time
    const startTimes = spans.map((s) => new Date(s.started_at).getTime());
    const minStartTime = Math.min(...startTimes);

    // Map spans to node objects
    const nodeMap = new Map<string, WaterfallSpanNode>();
    for (const span of spans) {
      const startOffsetMs = Math.max(0, new Date(span.started_at).getTime() - minStartTime);
      let attributes: Record<string, any> = {};
      try {
        if (span.attributes_json) {
          attributes = JSON.parse(span.attributes_json);
        }
      } catch {
        attributes = {};
      }

      nodeMap.set(span.id, {
        spanId: span.id,
        parentSpanId: span.parent_span_id,
        name: span.span_name,
        service: span.agent_id || 'xylarc-core',
        startOffsetMs,
        durationMs: span.latency_ms,
        isCriticalPath: false,
        status: span.status === 'error' ? 'error' : 'success',
        attributes,
        children: [],
      });
    }

    // Assemble parent-child tree
    const rootNodes: WaterfallSpanNode[] = [];
    for (const node of nodeMap.values()) {
      if (node.parentSpanId && nodeMap.has(node.parentSpanId)) {
        nodeMap.get(node.parentSpanId)!.children.push(node);
      } else {
        rootNodes.push(node);
      }
    }

    // Sort children by start offset
    for (const node of nodeMap.values()) {
      node.children.sort((a, b) => a.startOffsetMs - b.startOffsetMs);
    }

    // Calculate critical path duration and flag critical path nodes
    const criticalPathDurationMs = this.calculateCriticalPath(rootNodes);

    // Calculate overall trace duration
    const endOffsets = spans.map(
      (s) => new Date(s.started_at).getTime() - minStartTime + s.latency_ms
    );
    const totalDurationMs = Math.max(...endOffsets, 0);

    const rootName = rootNodes[0]?.name || spans[0]?.span_name || 'root_trace';

    return {
      traceId,
      rootSpanName: rootName,
      totalDurationMs,
      spanCount: spans.length,
      criticalPathDurationMs,
      tree: rootNodes,
    };
  }

  /**
   * Recursively computes the maximum critical path duration and flags bottleneck spans.
   */
  private static calculateCriticalPath(nodes: WaterfallSpanNode[]): number {
    let maxPath = 0;

    for (const node of nodes) {
      const childMax = node.children.length > 0 ? this.calculateCriticalPath(node.children) : 0;
      const nodeTotal = node.durationMs + childMax;

      if (nodeTotal >= maxPath) {
        maxPath = nodeTotal;
        node.isCriticalPath = true;
      }
    }

    return maxPath;
  }
}
