import { useState, useCallback, useRef } from "react";
import type { WSMessageToSidecar, FlowExecutionEvent, NodeOutput, HistoryMessage } from "../lib/types";
import type { FlowDefinition } from "../lib/flow-types";

export type NodeExecState = "idle" | "running" | "streaming" | "completed" | "error";
export type FlowExecStatus = "idle" | "running" | "completed" | "error";

export interface NodeExecInfo {
  state: NodeExecState;
  streamingText: string;
  output?: NodeOutput;
  error?: string;
}

export interface FlowNodeMeta {
  id: string;
  kind: string;
  label: string;
}

export interface FlowExecutionState {
  status: FlowExecStatus;
  executionId: string | null;
  nodeStates: Record<string, NodeExecInfo>;
  nodeList: FlowNodeMeta[];
  flow: FlowDefinition | null;
  result: string | null;
  error: string | null;
}

const INITIAL_STATE: FlowExecutionState = {
  status: "idle",
  executionId: null,
  nodeStates: {},
  nodeList: [],
  flow: null,
  result: null,
  error: null,
};

export function useFlowExecution(send: (msg: WSMessageToSidecar) => void) {
  const [execState, setExecState] = useState<FlowExecutionState>(INITIAL_STATE);
  const execIdRef = useRef<string | null>(null);

  const runFlow = useCallback(
    (flow: FlowDefinition, input: string, history?: HistoryMessage[], sessionId?: string) => {
      // Reset state
      const freshNodeStates: Record<string, NodeExecInfo> = {};
      for (const node of flow.nodes) {
        freshNodeStates[node.id] = { state: "idle", streamingText: "" };
      }
      setExecState({
        status: "running",
        executionId: null,
        nodeStates: freshNodeStates,
        nodeList: flow.nodes.map((n) => ({ id: n.id, kind: n.kind, label: n.label })),
        flow,
        result: null,
        error: null,
      });
      // Ensure edge signals are derived from sourceHandle (fixes flows saved before signal fix)
      const normalizedFlow = {
        ...flow,
        edges: flow.edges.map((e) => ({
          ...e,
          signal: e.sourceHandle ?? e.signal ?? "default",
        })),
      };
      send({
        type: "execute_flow",
        flow: normalizedFlow,
        input,
        history: history?.length ? history : undefined,
        sessionId,
      });
    },
    [send],
  );

  const cancelFlow = useCallback(() => {
    if (execIdRef.current) {
      send({ type: "cancel_flow", executionId: execIdRef.current });
    }
    setExecState((prev) => ({
      ...prev,
      status: "error",
      error: "Cancelled by user",
    }));
  }, [send]);

  const resetFlow = useCallback(() => {
    execIdRef.current = null;
    setExecState(INITIAL_STATE);
  }, []);

  const handleFlowEvent = useCallback((event: FlowExecutionEvent) => {
    switch (event.type) {
      case "flow_started":
        execIdRef.current = event.executionId;
        setExecState((prev) => ({
          ...prev,
          executionId: event.executionId,
          status: "running",
        }));
        break;

      case "node_started":
        setExecState((prev) => ({
          ...prev,
          nodeStates: {
            ...prev.nodeStates,
            [event.nodeId]: { state: "running", streamingText: "" },
          },
        }));
        break;

      case "node_streaming":
        setExecState((prev) => {
          const existing = prev.nodeStates[event.nodeId];
          return {
            ...prev,
            nodeStates: {
              ...prev.nodeStates,
              [event.nodeId]: {
                ...existing,
                state: "streaming",
                streamingText: (existing?.streamingText ?? "") + event.delta,
              },
            },
          };
        });
        break;

      case "node_completed":
        setExecState((prev) => ({
          ...prev,
          nodeStates: {
            ...prev.nodeStates,
            [event.nodeId]: {
              state: "completed",
              streamingText: "",
              output: event.output,
            },
          },
        }));
        break;

      case "node_error":
        setExecState((prev) => ({
          ...prev,
          nodeStates: {
            ...prev.nodeStates,
            [event.nodeId]: {
              state: "error",
              streamingText: "",
              error: event.error,
            },
          },
        }));
        break;

      case "flow_completed":
        setExecState((prev) => ({
          ...prev,
          status: "completed",
          result: event.result,
        }));
        break;

      case "flow_error":
        setExecState((prev) => ({
          ...prev,
          status: "error",
          error: event.error,
        }));
        break;

      case "human_review_requested":
        // For MVP, auto-approve (the sidecar already does this)
        break;
    }
  }, []);

  return { execState, runFlow, cancelFlow, resetFlow, handleFlowEvent };
}
