/** Core message types for the chat interface */

export type MessageRole = "user" | "assistant" | "system";

export interface ImageAttachment {
  id: string;
  dataUrl: string;
  mimeType: string;
  name: string;
}

export type ToolCallStatus = "loading" | "success" | "error";

export interface ToolCall {
  id: string;
  name: string;
  /** Tool arguments as passed to the tool */
  args: Record<string, unknown>;
  /** Tool result (populated when complete) */
  result?: string;
  /** Status of the tool call */
  status: ToolCallStatus;
  /** Duration in milliseconds */
  durationMs?: number;
  /** Start timestamp */
  startedAt: number;
}

export interface ThinkingBlock {
  id: string;
  content: string;
  isStreaming: boolean;
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: number;
  /** Tool calls associated with this message (assistant messages) */
  toolCalls?: ToolCall[];
  /** Thinking/reasoning blocks */
  thinking?: ThinkingBlock[];
  /** Whether this message is still being streamed */
  isStreaming?: boolean;
  /** Model that produced this message */
  model?: string;
  /** Token usage */
  tokensIn?: number;
  tokensOut?: number;
  /** Cost in USD */
  costUsd?: number;
  /** Image attachments (user messages) */
  images?: ImageAttachment[];
}

/** Log entry status for in-progress tracking */
export type LogEntryStatus = "pending" | "complete" | "error";

/** Real-time log entry captured from WebSocket events */
export interface LogEntry {
  id: string;
  timestamp: number;
  level: "info" | "tool" | "llm" | "error" | "flow" | "debug";
  source: string;
  message: string;
  detail?: string;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  durationMs?: number;
  /** Status for entries that get updated (tool calls, LLM calls) */
  status?: LogEntryStatus;
  /** Correlation ID for matching start/done pairs (toolCallId or messageId) */
  correlationId?: string;
}

/** Union type for log entry emission: either a new entry or an update to an existing one */
export type LogEntryEvent =
  | LogEntry
  | { update: true; correlationId: string; patch: Partial<LogEntry> };

/** Lightweight flow reference for the chat flow selector */
export interface FlowSummary {
  id: string;
  name: string;
}

/** Chat session summary for history dropdown */
export interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount?: number;
  preview?: string;
}

/** Lightweight message for sending conversation history to the sidecar */
export interface HistoryMessage {
  role: "user" | "assistant";
  content: string;
}

/** WebSocket message types between frontend and sidecar */

export type WSMessageToSidecar =
  | { type: "user_message"; content: string; images?: ImageAttachment[]; history?: HistoryMessage[]; sessionId?: string }
  | { type: "cancel" }
  | { type: "set_api_key"; key: string }
  | { type: "set_project_root"; path: string }
  | { type: "ping" }
  | { type: "execute_flow"; flow: unknown; input: string; history?: HistoryMessage[]; sessionId?: string }
  | { type: "cancel_flow"; executionId: string };

/** Context Agent transparency events */
export type ContextAgentEvent =
  | { type: "classification"; intent: string; complexity: string; routedTo: string; handleDirectly: boolean }
  | { type: "briefing_generated"; tokensSaved: number }
  | { type: "state_updated"; state: unknown };

export type WSMessageFromSidecar =
  | { type: "assistant_text"; messageId: string; delta: string }
  | { type: "assistant_text_done"; messageId: string; model: string; tokensIn: number; tokensOut: number; costUsd: number }
  | { type: "thinking_start"; messageId: string; thinkingId: string }
  | { type: "thinking_delta"; messageId: string; thinkingId: string; delta: string }
  | { type: "thinking_done"; messageId: string; thinkingId: string }
  | { type: "tool_call_start"; messageId: string; toolCall: ToolCall }
  | { type: "tool_call_done"; messageId: string; toolCallId: string; result: string; status: ToolCallStatus; durationMs: number }
  | { type: "debug_log"; entry: LogEntry }
  | { type: "error"; message: string }
  | { type: "status"; status: string }
  | { type: "pong" }
  // Context Agent events
  | { type: "context_agent_event"; sessionId: string; event: ContextAgentEvent }
  // Flow execution events
  | FlowExecutionEvent;

/** Flow execution events from sidecar */
export type FlowExecutionEvent =
  | { type: "flow_started"; executionId: string; flowId: string }
  | { type: "node_started"; executionId: string; nodeId: string; kind: string }
  | { type: "node_streaming"; executionId: string; nodeId: string; delta: string }
  | { type: "node_completed"; executionId: string; nodeId: string; output: NodeOutput }
  | { type: "node_error"; executionId: string; nodeId: string; error: string }
  | { type: "flow_completed"; executionId: string; result: string; state: unknown }
  | { type: "flow_error"; executionId: string; error: string }
  | { type: "human_review_requested"; executionId: string; nodeId: string; prompt: string };

/** Recent project entry for startup page */
export interface RecentProject {
  path: string;
  name: string;
  lastOpened: number;
}

export interface NodeOutput {
  nodeId: string;
  kind: string;
  result: string;
  signal: string;
  data?: Record<string, unknown>;
  durationMs: number;
}
