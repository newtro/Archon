import { useMemo, useCallback } from "react";
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
import type { FlowExecutionState, NodeExecState } from "../../hooks/useFlowExecution";

interface FlowExecutionDiagramProps {
  flow: FlowDefinition;
  execState: FlowExecutionState;
}

export function FlowExecutionDiagram({ flow, execState }: FlowExecutionDiagramProps) {
  const handleInit = useCallback((instance: ReactFlowInstance) => {
    // Fit view once on mount; avoids re-fitting on every streaming update
    instance.fitView({ padding: 0.2 });
  }, []);

  const nodes: Node[] = useMemo(() => {
    return flow.nodes.map((n) => {
      const nodeExec = execState.nodeStates[n.id];
      return {
        id: n.id,
        type: n.kind,
        position: { x: n.x, y: n.y },
        data: {
          kind: n.kind,
          label: n.label,
          config: n.config,
          execState: nodeExec?.state as NodeExecState | undefined,
          streamingText: nodeExec?.streamingText,
          durationMs: nodeExec?.output?.durationMs,
        } satisfies FlowNodeData & { execState?: NodeExecState; streamingText?: string; durationMs?: number },
        draggable: false,
        connectable: false,
        selectable: false,
      };
    });
  }, [flow.nodes, execState.nodeStates]);

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
  );
}
