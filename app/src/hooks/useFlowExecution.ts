import { useState, useCallback, useRef } from "react";
import type { WSMessageToSidecar, FlowExecutionEvent, NodeOutput, HistoryMessage } from "../lib/types";
import type { FlowDefinition } from "../lib/flow-types";

export type NodeExecState = "idle" | "running" | "streaming" | "completed" | "error" | "review";
export type FlowExecStatus = "idle" | "running" | "completed" | "error";

export interface ToolCallInfo {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result?: string;
  status: "loading" | "success" | "error";
  durationMs?: number;
}

export interface NodeExecInfo {
  state: NodeExecState;
  streamingText: string;
  input?: string;
  inputPreview?: string;
  output?: NodeOutput;
  error?: string;
  toolCalls?: ToolCallInfo[];
}

export interface EdgeExecInfo {
  edgeId: string;
  sourceNodeId: string;
  targetNodeId: string;
  signal: string;
  dataPreview: string;
  dataFull: string;
  sourceKind: string;
  sourceLabel: string;
  targetKind: string;
  targetLabel: string;
  timestamp: number;
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
  edgeStates: Record<string, EdgeExecInfo>;
  nodeList: FlowNodeMeta[];
  flow: FlowDefinition | null;
  result: string | null;
  error: string | null;
}

const INITIAL_STATE: FlowExecutionState = {
  status: "idle",
  executionId: null,
  nodeStates: {},
  edgeStates: {},
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
        edgeStates: {},
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
            [event.nodeId]: {
              state: "running",
              streamingText: "",
              input: event.input,
              inputPreview: event.inputPreview,
            },
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
        setExecState((prev) => {
          const existing = prev.nodeStates[event.nodeId];
          return {
            ...prev,
            nodeStates: {
              ...prev.nodeStates,
              [event.nodeId]: {
                ...existing,
                state: "completed",
                streamingText: "",
                output: event.output,
              },
            },
          };
        });
        break;

      case "node_error":
        setExecState((prev) => {
          const existing = prev.nodeStates[event.nodeId];
          return {
            ...prev,
            nodeStates: {
              ...prev.nodeStates,
              [event.nodeId]: {
                ...existing,
                state: "error",
                streamingText: "",
                error: event.error,
              },
            },
          };
        });
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

      case "node_tool_call":
        setExecState((prev) => {
          const existing = prev.nodeStates[event.nodeId];
          const newToolCall: ToolCallInfo = {
            id: event.toolCall.id,
            name: event.toolCall.name,
            args: event.toolCall.args,
            status: "loading",
          };
          return {
            ...prev,
            nodeStates: {
              ...prev.nodeStates,
              [event.nodeId]: {
                ...existing,
                toolCalls: [...(existing?.toolCalls ?? []), newToolCall],
              },
            },
          };
        });
        break;

      case "node_tool_result":
        setExecState((prev) => {
          const existing = prev.nodeStates[event.nodeId];
          const updatedCalls = (existing?.toolCalls ?? []).map((tc) =>
            tc.id === event.toolCallId
              ? { ...tc, result: event.result, status: event.status as "success" | "error", durationMs: event.durationMs }
              : tc,
          );
          return {
            ...prev,
            nodeStates: {
              ...prev.nodeStates,
              [event.nodeId]: {
                ...existing,
                toolCalls: updatedCalls,
              },
            },
          };
        });
        break;

      case "edge_traversed":
        setExecState((prev) => ({
          ...prev,
          edgeStates: {
            ...prev.edgeStates,
            [event.edgeId]: {
              edgeId: event.edgeId,
              sourceNodeId: event.sourceNodeId,
              targetNodeId: event.targetNodeId,
              signal: event.signal,
              dataPreview: event.dataPreview,
              dataFull: event.dataFull,
              sourceKind: event.sourceKind,
              sourceLabel: event.sourceLabel,
              targetKind: event.targetKind,
              targetLabel: event.targetLabel,
              timestamp: event.timestamp,
            },
          },
        }));
        break;

      case "human_review_requested":
        setExecState((prev) => {
          const existing = prev.nodeStates[event.nodeId];
          return {
            ...prev,
            nodeStates: {
              ...prev.nodeStates,
              [event.nodeId]: {
                ...existing,
                state: "review",
                streamingText: "",
              },
            },
          };
        });
        break;
    }
  }, []);

  return { execState, runFlow, cancelFlow, resetFlow, handleFlowEvent };
}
