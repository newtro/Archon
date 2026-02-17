/**
 * Shared flow types between frontend and sidecar.
 * Mirrors app/src/lib/flow-types.ts serialization types.
 */

export type NodeKind =
  | "llm" | "intent" | "evaluator"
  | "tool" | "transformer"
  | "router" | "parallel" | "join" | "human-review" | "sub-flow"
  | "memory" | "handoff" | "project-context"
  | "ado-pr-read" | "ado-pr-write" | "webhook-trigger" | "webhook-response"
  | "start" | "end";

export type ToolPreset = "none" | "read-only" | "full-access";

export interface SerializedNode {
  id: string;
  kind: NodeKind;
  label: string;
  x: number;
  y: number;
  config: {
    kind: NodeKind;
    config: Record<string, unknown>;
  };
}

export interface SerializedEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle: string | null;
  targetHandle: string | null;
  signal: string;
}

export interface FlowDefinition {
  id: string;
  name: string;
  description: string;
  nodes: SerializedNode[];
  edges: SerializedEdge[];
  createdAt: number;
  updatedAt: number;
  /** Context Agent config for multi-turn orchestration */
  contextAgentConfig?: {
    enabled: boolean;
    model?: "haiku" | "sonnet" | "opus";
    systemPrompt?: string;
    extendedContext?: boolean;
  };
}

/** Lightweight conversation history message */
export interface HistoryMessage {
  role: "user" | "assistant";
  content: string;
}

/** Execution state tracked across the flow run */
export interface FlowState {
  task: string;
  taskStatus: "pending" | "in_progress" | "completed" | "failed";
  currentNodeId: string | null;
  nodeOutputs: Record<string, NodeOutput>;
  decisions: string[];
  errors: Array<{ nodeId: string; error: string; turn: number }>;
  turn: number;
  /** Project context output from project-context nodes — injected into LLM systemPrompts */
  projectContext?: string;
  /** Conversation history from the chat session — injected into LLM node prompts */
  conversationHistory?: HistoryMessage[];
  /** Context Agent instance (set when a session has a Context Agent) */
  contextAgent?: unknown;
}

export interface NodeOutput {
  nodeId: string;
  kind: NodeKind;
  result: string;
  signal: string; // "success" | "fail" | "default" | custom
  data?: Record<string, unknown>;
  durationMs: number;
}

/** Tool call info emitted during flow node execution */
export interface FlowToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: "loading";
  startedAt: number;
}

/** Messages sent from sidecar to frontend during flow execution */
export type FlowExecutionEvent =
  | { type: "flow_started"; executionId: string; flowId: string }
  | { type: "node_started"; executionId: string; nodeId: string; kind: NodeKind; input: string; inputPreview: string }
  | { type: "node_streaming"; executionId: string; nodeId: string; delta: string }
  | { type: "node_completed"; executionId: string; nodeId: string; output: NodeOutput }
  | { type: "node_error"; executionId: string; nodeId: string; error: string }
  | { type: "node_tool_call"; executionId: string; nodeId: string; toolCall: FlowToolCall }
  | { type: "node_tool_args_update"; executionId: string; nodeId: string; toolCallId: string; args: Record<string, unknown> }
  | { type: "node_tool_result"; executionId: string; nodeId: string; toolCallId: string; result: string; status: "success" | "error"; durationMs: number }
  | { type: "edge_traversed"; executionId: string; edgeId: string; sourceNodeId: string; targetNodeId: string; signal: string; dataPreview: string; dataFull: string; sourceKind: NodeKind; sourceLabel: string; targetKind: NodeKind; targetLabel: string; timestamp: number }
  | { type: "flow_completed"; executionId: string; result: string; state: FlowState }
  | { type: "flow_error"; executionId: string; error: string }
  | {
      type: "human_review_requested";
      executionId: string;
      nodeId: string;
      nodeLabel: string;
      prompt: string;
      content: string;
      contentType: "text" | "json" | "markdown";
    };

/** Patch model for updating flows via AI tools */
export interface FlowPatch {
  name?: string;
  description?: string;
  addNodes?: SerializedNode[];
  updateNodes?: Array<{
    id: string;
    label?: string;
    config?: { kind: NodeKind; config: Record<string, unknown> };
  }>;
  removeNodeIds?: string[];
  addEdges?: SerializedEdge[];
  removeEdgeIds?: string[];
  contextAgentConfig?: FlowDefinition["contextAgentConfig"];
}
