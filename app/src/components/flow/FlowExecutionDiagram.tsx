import { createContext, useMemo, useCallback, useRef, useEffect } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
  type Node,
  type Edge,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { nodeTypes } from "./nodes/BaseNode";
import {
  NODE_REGISTRY,
  CATEGORY_COLORS,
  type FlowNodeData,
  type FlowDefinition,
  type NodeKind,
} from "../../lib/flow-types";
import type { FlowExecutionState, NodeExecInfo } from "../../hooks/useFlowExecution";

/**
 * Context that provides per-node execution state to node components.
 * This decouples the React Flow nodes array (layout, stable) from the
 * rapidly-changing execution state so React Flow's internal store stays intact.
 */
export const ExecNodeStatesContext = createContext<Record<string, NodeExecInfo>>({});

interface FlowExecutionDiagramProps {
  flow: FlowDefinition;
  execState: FlowExecutionState;
}

export function FlowExecutionDiagram({ flow, execState }: FlowExecutionDiagramProps) {
  const rfRef = useRef<ReactFlowInstance | null>(null);
  const prevStatusRef = useRef(execState.status);

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
        animated: isActive,
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
      <div className="flow-exec-diagram">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          panOnDrag
          zoomOnScroll
          onInit={handleInit}
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
      </div>
    </ExecNodeStatesContext.Provider>
  );
}
