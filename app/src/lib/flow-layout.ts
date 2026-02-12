/**
 * Auto-layout for flows using dagre.
 * Takes a FlowDefinition and computes optimal node positions.
 */
import dagre from "@dagrejs/dagre";
import type { FlowDefinition } from "./flow-types";

const NODE_WIDTH = 200;
const NODE_HEIGHT = 80;

/**
 * Apply dagre auto-layout to a flow definition.
 * Modifies node x/y positions in place and returns the flow.
 */
export function autoLayoutFlow(flow: FlowDefinition): FlowDefinition {
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: "LR",    // Left-to-right layout
    nodesep: 80,       // Vertical spacing between nodes
    ranksep: 150,      // Horizontal spacing between ranks
    marginx: 50,
    marginy: 50,
  });
  g.setDefaultEdgeLabel(() => ({}));

  // Add nodes
  for (const node of flow.nodes) {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }

  // Add edges
  for (const edge of flow.edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  // Apply computed positions back to flow nodes
  for (const node of flow.nodes) {
    const pos = g.node(node.id);
    if (pos) {
      // dagre returns center positions; adjust to top-left for React Flow
      node.x = pos.x - NODE_WIDTH / 2;
      node.y = pos.y - NODE_HEIGHT / 2;
    }
  }

  return flow;
}
