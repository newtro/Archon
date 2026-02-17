import { useMemo, useCallback, useRef, useEffect, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
  type Node,
  type Edge,
  type EdgeMouseHandler,
  type NodeMouseHandler,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { nodeTypes } from "./nodes/BaseNode";
import { ExecutionEdge } from "./ExecutionEdge";
import { EdgeDetailPanel } from "./EdgeDetailPanel";
import { NodeDetailPanel } from "./NodeDetailPanel";
import {
  ExecNodeStatesContext,
  ExecEdgeStatesContext,
} from "./execution-contexts";
import {
  NODE_REGISTRY,
  CATEGORY_COLORS,
  type FlowNodeData,
  type FlowDefinition,
  type NodeKind,
} from "../../lib/flow-types";
import type { FlowExecutionState, EdgeExecInfo, NodeExecInfo } from "../../hooks/useFlowExecution";

// Re-export for consumers that import from this file
export { ExecNodeStatesContext } from "./execution-contexts";

const edgeTypes = {
  execution: ExecutionEdge,
};

interface FlowExecutionDiagramProps {
  flow: FlowDefinition;
  execState: FlowExecutionState;
}

export interface NodeInspectInfo {
  nodeId: string;
  kind: string;
  label: string;
  execInfo: NodeExecInfo;
}

export function FlowExecutionDiagram({ flow, execState }: FlowExecutionDiagramProps) {
  const rfRef = useRef<ReactFlowInstance | null>(null);
  const prevStatusRef = useRef(execState.status);
  const [selectedEdge, setSelectedEdge] = useState<EdgeExecInfo | null>(null);
  const [selectedNode, setSelectedNode] = useState<NodeInspectInfo | null>(null);

  // Hover tooltip state (shared between edges and nodes)
  const [hoveredEdge, setHoveredEdge] = useState<EdgeExecInfo | null>(null);
  const [hoveredNode, setHoveredNode] = useState<NodeInspectInfo | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);
  const diagramRef = useRef<HTMLDivElement>(null);

  const handleInit = useCallback((instance: ReactFlowInstance) => {
    rfRef.current = instance;
    instance.fitView({ padding: 0.2 });
  }, []);

  // Re-fit when flow finishes so nodes with updated sizes (exec bars) stay visible
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = execState.status;
    if (prev === execState.status) return;
    if (execState.status === "completed" || execState.status === "error") {
      const t = setTimeout(() => rfRef.current?.fitView({ padding: 0.2 }), 200);
      return () => clearTimeout(t);
    }
  }, [execState.status]);

  const handleCloseEdgeDetail = useCallback(() => {
    setSelectedEdge(null);
  }, []);

  const handleCloseNodeDetail = useCallback(() => {
    setSelectedNode(null);
  }, []);

  // Build a node lookup map for resolving edge source/target info
  const nodeLookup = useMemo(() => {
    const map = new Map<string, { kind: string; label: string }>();
    for (const n of flow.nodes) {
      map.set(n.id, { kind: n.kind, label: n.label });
    }
    return map;
  }, [flow.nodes]);

  // Build a flow-edge lookup for resolving signal
  const flowEdgeLookup = useMemo(() => {
    const map = new Map<string, { signal: string; source: string; target: string }>();
    for (const e of flow.edges) {
      map.set(e.id, { signal: e.signal, source: e.source, target: e.target });
    }
    return map;
  }, [flow.edges]);

  // Resolve edge info: prefer exec data, fall back to flow definition
  const resolveEdgeInfo = useCallback(
    (edgeId: string): EdgeExecInfo | null => {
      const execInfo = execState.edgeStates[edgeId];
      if (execInfo) return execInfo;

      // Build from flow definition
      const fe = flowEdgeLookup.get(edgeId);
      if (!fe) return null;
      const src = nodeLookup.get(fe.source);
      const tgt = nodeLookup.get(fe.target);
      if (!src || !tgt) return null;

      return {
        edgeId,
        sourceNodeId: fe.source,
        targetNodeId: fe.target,
        signal: fe.signal,
        dataPreview: "Awaiting traversal data...",
        dataFull: "",
        sourceKind: src.kind,
        sourceLabel: src.label,
        targetKind: tgt.kind,
        targetLabel: tgt.label,
        timestamp: 0,
      };
    },
    [execState.edgeStates, flowEdgeLookup, nodeLookup],
  );

  // Edge click → open detail panel
  const handleEdgeClick: EdgeMouseHandler = useCallback(
    (_event, edge) => {
      const info = resolveEdgeInfo(edge.id);
      if (info) {
        setSelectedEdge(info);
        setHoveredEdge(null);
      }
    },
    [resolveEdgeInfo],
  );

  // Edge hover → show tooltip
  const handleEdgeMouseEnter: EdgeMouseHandler = useCallback(
    (event, edge) => {
      const info = resolveEdgeInfo(edge.id);
      if (info && diagramRef.current) {
        const rect = diagramRef.current.getBoundingClientRect();
        setTooltipPos({
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        });
        setHoveredEdge(info);
      }
    },
    [resolveEdgeInfo],
  );

  const handleEdgeMouseLeave: EdgeMouseHandler = useCallback(() => {
    setHoveredEdge(null);
    setTooltipPos(null);
  }, []);

  // Resolve node info for inspection
  const resolveNodeInfo = useCallback(
    (nodeId: string): NodeInspectInfo | null => {
      const meta = nodeLookup.get(nodeId);
      if (!meta) return null;
      const execInfo = execState.nodeStates[nodeId];
      if (!execInfo) return null;
      return { nodeId, kind: meta.kind, label: meta.label, execInfo };
    },
    [nodeLookup, execState.nodeStates],
  );

  // Node click → open detail panel
  const handleNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      const info = resolveNodeInfo(node.id);
      if (info) {
        setSelectedNode(info);
        setHoveredNode(null);
        setTooltipPos(null);
      }
    },
    [resolveNodeInfo],
  );

  // Node hover → show tooltip
  const handleNodeMouseEnter: NodeMouseHandler = useCallback(
    (event, node) => {
      const info = resolveNodeInfo(node.id);
      if (info && diagramRef.current) {
        const rect = diagramRef.current.getBoundingClientRect();
        setTooltipPos({
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        });
        setHoveredNode(info);
      }
    },
    [resolveNodeInfo],
  );

  const handleNodeMouseLeave: NodeMouseHandler = useCallback(() => {
    setHoveredNode(null);
    setTooltipPos(null);
  }, []);

  // Stable nodes — only recreated when the flow layout changes, NOT on every
  // streaming delta.  Node components read exec state from ExecNodeStatesContext.
  const nodes: Node[] = useMemo(() => {
    return flow.nodes.map((n) => ({
      id: n.id,
      type: n.kind,
      position: { x: n.x, y: n.y },
      data: {
        kind: n.kind,
        label: n.label,
        config: n.config,
      } satisfies FlowNodeData,
      draggable: false,
      connectable: false,
      selectable: false,
    }));
  }, [flow.nodes]);

  // Edges still react to exec state for visual feedback (animated / colored)
  const edges: Edge[] = useMemo(() => {
    return flow.edges.map((e) => {
      const sourceState = execState.nodeStates[e.source]?.state;
      const targetState = execState.nodeStates[e.target]?.state;
      const isActive =
        sourceState === "completed" &&
        (targetState === "running" || targetState === "streaming");
      const isCompleted =
        sourceState === "completed" && targetState === "completed";

      return {
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle,
        type: "execution",
        animated: isActive,
        data: {
          signal: e.signal,
          isActive,
          isCompleted,
        },
        style: {
          stroke: isActive
            ? "#6366f1"
            : isCompleted
              ? "#22c55e"
              : e.signal === "fail"
                ? "#ef4444"
                : e.signal === "success"
                  ? "#22c55e"
                  : "#64748b",
          strokeWidth: isActive ? 2.5 : 1.5,
          opacity: isActive || isCompleted ? 1 : 0.5,
        },
      };
    });
  }, [flow.edges, execState.nodeStates]);

  return (
    <ExecNodeStatesContext.Provider value={execState.nodeStates}>
      <ExecEdgeStatesContext.Provider value={execState.edgeStates}>
        <div className="flow-exec-diagram" ref={diagramRef}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            panOnDrag
            zoomOnScroll
            onInit={handleInit}
            onEdgeClick={handleEdgeClick}
            onEdgeMouseEnter={handleEdgeMouseEnter}
            onEdgeMouseLeave={handleEdgeMouseLeave}
            onNodeClick={handleNodeClick}
            onNodeMouseEnter={handleNodeMouseEnter}
            onNodeMouseLeave={handleNodeMouseLeave}
            proOptions={{ hideAttribution: true }}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={16}
              size={1}
              color="var(--border-secondary)"
            />
            <Controls
              className="flow-controls"
              showInteractive={false}
            />
            <MiniMap
              className="flow-minimap"
              nodeColor={(node) => {
                const d = node.data as unknown as FlowNodeData;
                const meta = NODE_REGISTRY[d.kind as NodeKind];
                return meta ? CATEGORY_COLORS[meta.category] : "#64748b";
              }}
              maskColor="rgba(0, 0, 0, 0.3)"
            />
          </ReactFlow>

          {/* Hover tooltip — rendered as HTML overlay positioned at mouse */}
          {hoveredEdge && tooltipPos && (
            <div
              className="exec-edge-tooltip"
              style={{
                position: "absolute",
                left: tooltipPos.x + 12,
                top: tooltipPos.y + 12,
                pointerEvents: "none",
              }}
            >
              <div className="exec-edge-tooltip-header">
                <span className="exec-edge-tooltip-signal" data-signal={hoveredEdge.signal}>
                  {hoveredEdge.signal}
                </span>
                <span className="exec-edge-tooltip-route">
                  {hoveredEdge.sourceLabel} → {hoveredEdge.targetLabel}
                </span>
              </div>
              {hoveredEdge.dataPreview && (
                <div className="exec-edge-tooltip-preview">
                  {hoveredEdge.dataPreview}
                </div>
              )}
              <div className="exec-edge-tooltip-hint">Click for full details</div>
            </div>
          )}

          {/* Node hover tooltip */}
          {hoveredNode && tooltipPos && !hoveredEdge && (
            <div
              className="exec-node-tooltip"
              style={{
                position: "absolute",
                left: tooltipPos.x + 12,
                top: tooltipPos.y + 12,
                pointerEvents: "none",
              }}
            >
              <div className="exec-node-tooltip-header">
                <span className="exec-node-tooltip-kind">
                  {NODE_REGISTRY[hoveredNode.kind as NodeKind]?.label ?? hoveredNode.kind}
                </span>
                <span className="exec-node-tooltip-label">{hoveredNode.label}</span>
              </div>
              <div className="exec-node-tooltip-state" data-state={hoveredNode.execInfo.state}>
                {hoveredNode.execInfo.state}
                {hoveredNode.execInfo.output?.durationMs != null && (
                  <span className="exec-node-tooltip-duration">
                    {" "}{(hoveredNode.execInfo.output.durationMs / 1000).toFixed(1)}s
                  </span>
                )}
              </div>
              {hoveredNode.execInfo.output?.signal && (
                <div className="exec-node-tooltip-signal">
                  Signal: {hoveredNode.execInfo.output.signal}
                </div>
              )}
              {hoveredNode.execInfo.inputPreview && (
                <div className="exec-node-tooltip-preview">
                  {hoveredNode.execInfo.inputPreview}
                </div>
              )}
              <div className="exec-node-tooltip-hint">Click for full details</div>
            </div>
          )}

          {/* Edge detail panel overlay */}
          {selectedEdge && (
            <EdgeDetailPanel edge={selectedEdge} onClose={handleCloseEdgeDetail} />
          )}

          {/* Node detail panel overlay */}
          {selectedNode && (
            <NodeDetailPanel node={selectedNode} onClose={handleCloseNodeDetail} />
          )}
        </div>
      </ExecEdgeStatesContext.Provider>
    </ExecNodeStatesContext.Provider>
  );
}
