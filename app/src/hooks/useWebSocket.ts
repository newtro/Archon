import { useEffect, useRef, useState, useCallback } from "react";
import type { WSMessageToSidecar, WSMessageFromSidecar, ChatMessage, FlowExecutionEvent, LogEntryEvent, LogEntry } from "../lib/types";

interface UseWebSocketOptions {
  onMessage: (msg: ChatMessage) => void;
  onStatusChange: (connected: boolean) => void;
  onFlowEvent?: (event: FlowExecutionEvent) => void;
  onConnect?: (send: (msg: WSMessageToSidecar) => void) => void;
  onLogEntry?: (entry: LogEntryEvent) => void;
}

const SIDECAR_PORT = 9399;
const RECONNECT_DELAY_MS = 2000;
const MAX_RECONNECT_ATTEMPTS = 10;

function getToolLogSummary(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case "Read": return `Read ${(args.file_path as string)?.split(/[/\\]/).pop() ?? "file"}`;
    case "Write": return `Write ${(args.file_path as string)?.split(/[/\\]/).pop() ?? "file"}`;
    case "Edit": return `Edit ${(args.file_path as string)?.split(/[/\\]/).pop() ?? "file"}`;
    case "Bash": return `$ ${((args.command as string) ?? "").slice(0, 80)}`;
    case "Glob": return `Glob ${(args.pattern as string) ?? ""}`;
    case "Grep": return `Grep "${(args.pattern as string) ?? ""}"`;
    case "Task": return `Task: ${(args.description as string) ?? ""}`;
    case "TodoWrite": return "TodoWrite";
    case "WebSearch": return `Search: ${(args.query as string) ?? ""}`;
    case "WebFetch": return `Fetch: ${(args.url as string) ?? ""}`;
    default: return name;
  }
}

export function useWebSocket({ onMessage, onStatusChange, onFlowEvent, onConnect, onLogEntry }: UseWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<string>("disconnected");
  const reconnectAttempts = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stable references for callbacks
  const onMessageRef = useRef(onMessage);
  const onStatusChangeRef = useRef(onStatusChange);
  const onFlowEventRef = useRef(onFlowEvent);
  const onConnectRef = useRef(onConnect);
  const onLogEntryRef = useRef(onLogEntry);
  onMessageRef.current = onMessage;
  onStatusChangeRef.current = onStatusChange;
  onFlowEventRef.current = onFlowEvent;
  onConnectRef.current = onConnect;
  onLogEntryRef.current = onLogEntry;

  // Accumulator for streaming assistant messages
  const streamingMessage = useRef<ChatMessage | null>(null);

  const emitLog = (entry: LogEntryEvent) => {
    onLogEntryRef.current?.(entry);
  };

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    setConnectionStatus("connecting");
    const ws = new WebSocket(`ws://localhost:${SIDECAR_PORT}`);

    ws.onopen = () => {
      setConnectionStatus("connected");
      onStatusChangeRef.current(true);
      reconnectAttempts.current = 0;

      emitLog({
        id: `log-ws-connect-${Date.now()}`,
        timestamp: Date.now(),
        level: "info",
        source: "system",
        message: "Connected to sidecar",
        status: "complete",
      } satisfies LogEntry);

      // Fire onConnect with a direct send bound to this ws instance
      onConnectRef.current?.((msg: WSMessageToSidecar) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(msg));
        }
      });
    };

    ws.onmessage = (event) => {
      try {
        const data: WSMessageFromSidecar = JSON.parse(event.data);
        handleSidecarMessage(data);
      } catch {
        console.error("Failed to parse WebSocket message:", event.data);
      }
    };

    ws.onclose = () => {
      setConnectionStatus("disconnected");
      onStatusChangeRef.current(false);
      wsRef.current = null;

      emitLog({
        id: `log-ws-disconnect-${Date.now()}`,
        timestamp: Date.now(),
        level: "error",
        source: "system",
        message: "Disconnected from sidecar",
        status: "error",
      } satisfies LogEntry);

      attemptReconnect();
    };

    ws.onerror = () => {
      ws.close();
    };

    wsRef.current = ws;
  }, []);

  const attemptReconnect = useCallback(() => {
    if (reconnectAttempts.current >= MAX_RECONNECT_ATTEMPTS) {
      setConnectionStatus("failed");
      return;
    }
    reconnectAttempts.current += 1;
    setConnectionStatus(`reconnecting (${reconnectAttempts.current}/${MAX_RECONNECT_ATTEMPTS})`);
    reconnectTimer.current = setTimeout(connect, RECONNECT_DELAY_MS);
  }, [connect]);

  const handleSidecarMessage = (data: WSMessageFromSidecar) => {
    switch (data.type) {
      case "assistant_text": {
        if (!streamingMessage.current || streamingMessage.current.id !== data.messageId) {
          streamingMessage.current = {
            id: data.messageId,
            role: "assistant",
            content: "",
            timestamp: Date.now(),
            isStreaming: true,
            toolCalls: [],
            thinking: [],
          };

          // Log LLM call start on first delta
          emitLog({
            id: `log-llm-${data.messageId}`,
            timestamp: Date.now(),
            level: "llm",
            source: "assistant",
            message: "LLM call started...",
            status: "pending",
            correlationId: data.messageId,
          } satisfies LogEntry);
        }
        const current = streamingMessage.current;
        current.content += data.delta;
        onMessageRef.current({ ...current });
        break;
      }

      case "assistant_text_done": {
        if (streamingMessage.current?.id === data.messageId) {
          streamingMessage.current.isStreaming = false;
          streamingMessage.current.model = data.model;
          streamingMessage.current.tokensIn = data.tokensIn;
          streamingMessage.current.tokensOut = data.tokensOut;
          streamingMessage.current.costUsd = data.costUsd;

          // Update LLM log entry with final stats
          emitLog({
            update: true,
            correlationId: data.messageId,
            patch: {
              message: `LLM response (${data.model})`,
              source: data.model,
              detail: streamingMessage.current.content?.slice(0, 500),
              tokensIn: data.tokensIn,
              tokensOut: data.tokensOut,
              costUsd: data.costUsd,
              status: "complete",
            },
          });

          onMessageRef.current({ ...streamingMessage.current });
          streamingMessage.current = null;
        }
        break;
      }

      case "thinking_start": {
        if (streamingMessage.current?.id === data.messageId) {
          streamingMessage.current.thinking = [
            ...(streamingMessage.current.thinking || []),
            { id: data.thinkingId, content: "", isStreaming: true },
          ];
          onMessageRef.current({ ...streamingMessage.current });

          emitLog({
            id: `log-think-${data.thinkingId}`,
            timestamp: Date.now(),
            level: "info",
            source: "thinking",
            message: "Extended thinking...",
            status: "pending",
            correlationId: `thinking-${data.thinkingId}`,
          } satisfies LogEntry);
        }
        break;
      }

      case "thinking_delta": {
        if (streamingMessage.current?.id === data.messageId) {
          const thinking = streamingMessage.current.thinking?.find((t) => t.id === data.thinkingId);
          if (thinking) {
            thinking.content += data.delta;
            onMessageRef.current({ ...streamingMessage.current });
          }
        }
        break;
      }

      case "thinking_done": {
        if (streamingMessage.current?.id === data.messageId) {
          const thinking = streamingMessage.current.thinking?.find((t) => t.id === data.thinkingId);
          if (thinking) {
            thinking.isStreaming = false;
            onMessageRef.current({ ...streamingMessage.current });

            emitLog({
              update: true,
              correlationId: `thinking-${data.thinkingId}`,
              patch: {
                message: "Thinking complete",
                detail: thinking.content?.slice(0, 500),
                status: "complete",
              },
            });
          }
        }
        break;
      }

      case "tool_call_start": {
        // Create streaming message if it doesn't exist yet (model started with tool use, no text)
        if (!streamingMessage.current || streamingMessage.current.id !== data.messageId) {
          streamingMessage.current = {
            id: data.messageId,
            role: "assistant",
            content: "",
            timestamp: Date.now(),
            isStreaming: true,
            toolCalls: [],
            thinking: [],
          };
        }
        if (streamingMessage.current.id === data.messageId) {
          streamingMessage.current.toolCalls = [
            ...(streamingMessage.current.toolCalls || []),
            data.toolCall,
          ];
          onMessageRef.current({ ...streamingMessage.current });

          const summary = getToolLogSummary(data.toolCall.name, data.toolCall.args);
          emitLog({
            id: `log-tool-${data.toolCall.id}`,
            timestamp: Date.now(),
            level: "tool",
            source: data.toolCall.name,
            message: summary,
            detail: JSON.stringify(data.toolCall.args, null, 2),
            status: "pending",
            correlationId: data.toolCall.id,
          } satisfies LogEntry);
        }
        break;
      }

      case "tool_call_done": {
        if (streamingMessage.current && streamingMessage.current.id === data.messageId) {
          const toolCall = streamingMessage.current.toolCalls?.find((t) => t.id === data.toolCallId);
          if (toolCall) {
            toolCall.result = data.result;
            toolCall.status = data.status;
            toolCall.durationMs = data.durationMs;
            onMessageRef.current({ ...streamingMessage.current });

            emitLog({
              update: true,
              correlationId: data.toolCallId,
              patch: {
                detail: data.result?.slice(0, 1000),
                durationMs: data.durationMs,
                status: data.status === "error" ? "error" : "complete",
                level: data.status === "error" ? "error" : "tool",
              },
            });
          }
        }
        break;
      }

      case "error": {
        onMessageRef.current({
          id: crypto.randomUUID(),
          role: "system",
          content: data.message,
          timestamp: Date.now(),
        });

        emitLog({
          id: `log-err-${crypto.randomUUID()}`,
          timestamp: Date.now(),
          level: "error",
          source: "system",
          message: data.message,
          status: "error",
        } satisfies LogEntry);
        break;
      }

      case "debug_log": {
        emitLog(data.entry);
        break;
      }

      case "pong":
        break;

      // Flow execution events — emit to both flow handler and log stream
      case "flow_started":
        emitLog({
          id: `log-flow-${data.executionId}`,
          timestamp: Date.now(),
          level: "flow",
          source: "flow",
          message: `Flow started (${data.flowId})`,
          status: "pending",
          correlationId: `flow-${data.executionId}`,
        } satisfies LogEntry);
        onFlowEventRef.current?.(data as FlowExecutionEvent);
        break;

      case "node_started":
        emitLog({
          id: `log-node-${data.nodeId}-${Date.now()}`,
          timestamp: Date.now(),
          level: "flow",
          source: data.kind,
          message: `Node started: ${data.nodeId}`,
          status: "pending",
          correlationId: `node-${data.executionId}-${data.nodeId}`,
        } satisfies LogEntry);
        onFlowEventRef.current?.(data as FlowExecutionEvent);
        break;

      case "node_completed":
        emitLog({
          update: true,
          correlationId: `node-${data.executionId}-${data.nodeId}`,
          patch: {
            message: `Node completed: ${data.nodeId}`,
            durationMs: data.output?.durationMs,
            detail: data.output?.result?.slice(0, 500),
            status: "complete",
          },
        });
        onFlowEventRef.current?.(data as FlowExecutionEvent);
        break;

      case "node_error":
        emitLog({
          update: true,
          correlationId: `node-${data.executionId}-${data.nodeId}`,
          patch: {
            message: `Node error: ${data.nodeId}`,
            detail: data.error,
            status: "error",
            level: "error",
          },
        });
        onFlowEventRef.current?.(data as FlowExecutionEvent);
        break;

      case "flow_completed":
        emitLog({
          update: true,
          correlationId: `flow-${data.executionId}`,
          patch: {
            message: "Flow completed",
            detail: data.result?.slice(0, 500),
            status: "complete",
          },
        });
        onFlowEventRef.current?.(data as FlowExecutionEvent);
        break;

      case "flow_error":
        emitLog({
          update: true,
          correlationId: `flow-${data.executionId}`,
          patch: {
            message: `Flow error: ${data.error}`,
            status: "error",
            level: "error",
          },
        });
        onFlowEventRef.current?.(data as FlowExecutionEvent);
        break;

      case "node_streaming":
      case "human_review_requested":
        onFlowEventRef.current?.(data as FlowExecutionEvent);
        break;

      // Context Agent transparency events — emit to log stream
      case "context_agent_event": {
        const evt = data.event;
        if (evt.type === "classification") {
          emitLog({
            id: `log-ctx-classify-${Date.now()}`,
            timestamp: Date.now(),
            level: "flow",
            source: "context-agent",
            message: `Intent: ${evt.intent} | Complexity: ${evt.complexity} | Route: ${evt.routedTo}${evt.handleDirectly ? " (direct)" : ""}`,
            status: "complete",
          } satisfies LogEntry);
        } else if (evt.type === "briefing_generated") {
          emitLog({
            id: `log-ctx-briefing-${Date.now()}`,
            timestamp: Date.now(),
            level: "flow",
            source: "context-agent",
            message: `Briefing generated (~${evt.tokensSaved} tokens saved)`,
            status: "complete",
          } satisfies LogEntry);
        } else if (evt.type === "state_updated") {
          emitLog({
            id: `log-ctx-state-${Date.now()}`,
            timestamp: Date.now(),
            level: "info",
            source: "context-agent",
            message: "Context state updated",
            detail: JSON.stringify(evt.state, null, 2).slice(0, 500),
            status: "complete",
          } satisfies LogEntry);
        }
        break;
      }
    }
  };

  const send = useCallback((msg: WSMessageToSidecar) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return { send, connectionStatus };
}
