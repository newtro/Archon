import { useEffect, useRef, useState, useCallback } from "react";
import type { WSMessageToSidecar, WSMessageFromSidecar, ChatMessage, FlowExecutionEvent, LogEntryEvent, LogEntry, ContextViewEvent, ContextClassification } from "../lib/types";
import type { FlowDefinition } from "../lib/flow-types";
import { loadFlow, saveFlow, deleteFlow as deleteFlowFromDb, listFlowsWithCounts, getFlowByName, applyFlowPatch, saveFlowVersion, type FlowPatch } from "../lib/flow-storage";
import { autoLayoutFlow } from "../lib/flow-layout";

interface UseWebSocketOptions {
  onMessage: (msg: ChatMessage) => void;
  onStatusChange: (connected: boolean) => void;
  onFlowEvent?: (event: FlowExecutionEvent) => void;
  onConnect?: (send: (msg: WSMessageToSidecar) => void) => void;
  onLogEntry?: (entry: LogEntryEvent) => void;
  onContextViewEvent?: (event: ContextViewEvent) => void;
  onContextClassification?: (classification: ContextClassification) => void;
  onContextStateUpdate?: (state: unknown) => void;
  onContextRawResponse?: (nodeId: string, executionId: string, messages: unknown[]) => void;
  /** Called when the AI creates or updates a flow — for preview in chat */
  onFlowPreview?: (flow: FlowDefinition) => void;
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

export function useWebSocket({ onMessage, onStatusChange, onFlowEvent, onConnect, onLogEntry, onContextViewEvent, onContextClassification, onContextStateUpdate, onContextRawResponse, onFlowPreview }: UseWebSocketOptions) {
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
  const onContextViewEventRef = useRef(onContextViewEvent);
  const onContextClassificationRef = useRef(onContextClassification);
  const onContextStateUpdateRef = useRef(onContextStateUpdate);
  const onContextRawResponseRef = useRef(onContextRawResponse);
  const onFlowPreviewRef = useRef(onFlowPreview);
  onMessageRef.current = onMessage;
  onStatusChangeRef.current = onStatusChange;
  onFlowEventRef.current = onFlowEvent;
  onConnectRef.current = onConnect;
  onLogEntryRef.current = onLogEntry;
  onContextViewEventRef.current = onContextViewEvent;
  onContextClassificationRef.current = onContextClassification;
  onContextStateUpdateRef.current = onContextStateUpdate;
  onContextRawResponseRef.current = onContextRawResponse;
  onFlowPreviewRef.current = onFlowPreview;

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
        // Create streaming message if it doesn't exist (tool-only response with no text)
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
          streamingMessage.current.isStreaming = false;
          streamingMessage.current.model = data.model;
          streamingMessage.current.tokensIn = data.tokensIn;
          streamingMessage.current.tokensOut = data.tokensOut;
          streamingMessage.current.costUsd = data.costUsd;

          // Mark any remaining "loading" tool calls as "success" (safety net)
          for (const tc of streamingMessage.current.toolCalls ?? []) {
            if (tc.status === "loading") {
              tc.status = "success";
              tc.durationMs = tc.durationMs ?? Date.now() - tc.startedAt;
            }
          }

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

      case "node_tool_call": {
        // Tool call started during flow node execution — log it and forward to flow handler
        const tc = (data as FlowExecutionEvent & { type: "node_tool_call" }).toolCall;
        const toolSummary = getToolLogSummary(tc.name, tc.args);
        emitLog({
          id: `log-tool-${tc.id}`,
          timestamp: Date.now(),
          level: "tool",
          source: tc.name,
          message: toolSummary,
          detail: JSON.stringify(tc.args, null, 2),
          status: "pending",
          correlationId: tc.id,
        } satisfies LogEntry);
        onFlowEventRef.current?.(data as FlowExecutionEvent);
        break;
      }

      case "node_tool_result": {
        // Tool call completed during flow node execution — update log and forward
        const toolResult = data as FlowExecutionEvent & { type: "node_tool_result" };
        emitLog({
          update: true,
          correlationId: toolResult.toolCallId,
          patch: {
            detail: toolResult.result?.slice(0, 1000),
            durationMs: toolResult.durationMs,
            status: toolResult.status === "error" ? "error" : "complete",
            level: toolResult.status === "error" ? "error" : "tool",
          },
        });
        onFlowEventRef.current?.(data as FlowExecutionEvent);
        break;
      }

      case "node_streaming":
      case "human_review_requested":
        onFlowEventRef.current?.(data as FlowExecutionEvent);
        break;

      // Context Agent transparency events — emit to log stream AND context view
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
          // Forward to context view
          onContextClassificationRef.current?.({
            timestamp: Date.now(),
            intent: evt.intent,
            complexity: evt.complexity,
            routedTo: evt.routedTo,
            handleDirectly: evt.handleDirectly,
          });
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
          // Forward to context view
          onContextStateUpdateRef.current?.(evt.state);
        }
        break;
      }

      // Context View events — forward to context view handler
      case "context_window_snapshot":
      case "briefing_diff":
      case "token_usage_update":
        onContextViewEventRef.current?.(data as ContextViewEvent);
        break;

      // On-demand raw context response
      case "context_raw_response": {
        const raw = data as { type: "context_raw_response"; nodeId: string; executionId: string; messages: unknown[] };
        onContextRawResponseRef.current?.(raw.nodeId, raw.executionId, raw.messages);
        break;
      }

      // ── Flow tool requests from sidecar (AI agent) ─────────────────
      case "flow_tool_create":
        handleFlowToolCreate(data as Record<string, unknown>);
        break;

      case "flow_tool_get":
        handleFlowToolGet(data as Record<string, unknown>);
        break;

      case "flow_tool_list":
        handleFlowToolList(data as Record<string, unknown>);
        break;

      case "flow_tool_update":
        handleFlowToolUpdate(data as Record<string, unknown>);
        break;

      case "flow_tool_delete":
        handleFlowToolDelete(data as Record<string, unknown>);
        break;
    }
  };

  /** Send a flow tool response back to the sidecar */
  const sendFlowToolResponse = (requestId: string, success: boolean, data?: unknown, error?: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: "flow_tool_response",
        requestId,
        success,
        data,
        error,
      }));
    }
  };

  /** Handle flow_tool_create: create a new flow from AI-generated definition */
  const handleFlowToolCreate = async (msg: Record<string, unknown>) => {
    const requestId = msg.requestId as string;
    try {
      const flowData = msg.flow as Record<string, unknown>;
      const now = Date.now();
      const flowId = crypto.randomUUID();

      // Build serialized nodes with proper structure
      const rawNodes = flowData.nodes as Array<Record<string, unknown>>;
      const rawEdges = flowData.edges as Array<Record<string, unknown>>;

      const nodes = rawNodes.map(n => ({
        id: n.id as string,
        kind: n.kind as string,
        label: n.label as string,
        x: (n.x as number) ?? 0,
        y: (n.y as number) ?? 0,
        config: n.config as { kind: string; config: Record<string, unknown> },
      }));

      const edges = rawEdges.map((e, i) => ({
        id: `edge-${i}-${crypto.randomUUID().slice(0, 8)}`,
        source: e.source as string,
        target: e.target as string,
        sourceHandle: (e.sourceHandle as string) ?? null,
        targetHandle: (e.targetHandle as string) ?? null,
        signal: (e.signal as string) ?? "default",
      }));

      const flow: FlowDefinition = {
        id: flowId,
        name: flowData.name as string,
        description: (flowData.description as string) ?? "",
        nodes: nodes as FlowDefinition["nodes"],
        edges: edges as FlowDefinition["edges"],
        createdAt: now,
        updatedAt: now,
        ...(flowData.contextAgentConfig ? { contextAgentConfig: flowData.contextAgentConfig as FlowDefinition["contextAgentConfig"] } : {}),
      };

      // Apply auto-layout to compute final positions
      autoLayoutFlow(flow);

      // Save to database
      await saveFlow(flow);
      await saveFlowVersion(flowId, "create", `Created "${flow.name}"`, flow);

      // Emit preview
      onFlowPreviewRef.current?.(flow);

      sendFlowToolResponse(requestId, true, {
        flowId,
        name: flow.name,
        nodeCount: flow.nodes.length,
        edgeCount: flow.edges.length,
      });
    } catch (err) {
      sendFlowToolResponse(requestId, false, undefined, err instanceof Error ? err.message : "Unknown error");
    }
  };

  /** Handle flow_tool_get: retrieve a flow by ID or name */
  const handleFlowToolGet = async (msg: Record<string, unknown>) => {
    const requestId = msg.requestId as string;
    try {
      let flow: FlowDefinition | null = null;
      if (msg.flowId) {
        flow = await loadFlow(msg.flowId as string);
      } else if (msg.name) {
        flow = await getFlowByName(msg.name as string);
      }
      if (!flow) {
        sendFlowToolResponse(requestId, false, undefined, "Flow not found");
        return;
      }
      sendFlowToolResponse(requestId, true, flow);
    } catch (err) {
      sendFlowToolResponse(requestId, false, undefined, err instanceof Error ? err.message : "Unknown error");
    }
  };

  /** Handle flow_tool_list: list all flows */
  const handleFlowToolList = async (msg: Record<string, unknown>) => {
    const requestId = msg.requestId as string;
    try {
      const flows = await listFlowsWithCounts();
      sendFlowToolResponse(requestId, true, flows);
    } catch (err) {
      sendFlowToolResponse(requestId, false, undefined, err instanceof Error ? err.message : "Unknown error");
    }
  };

  /** Handle flow_tool_update: apply a patch to an existing flow */
  const handleFlowToolUpdate = async (msg: Record<string, unknown>) => {
    const requestId = msg.requestId as string;
    try {
      const flowId = msg.flowId as string;
      const patch = msg.patch as FlowPatch;
      const flow = await applyFlowPatch(flowId, patch);
      if (!flow) {
        sendFlowToolResponse(requestId, false, undefined, `Flow "${flowId}" not found`);
        return;
      }

      // Re-apply auto-layout after patch
      autoLayoutFlow(flow);
      flow.updatedAt = Date.now();
      await saveFlow(flow);

      // Emit preview
      onFlowPreviewRef.current?.(flow);

      sendFlowToolResponse(requestId, true, {
        flowId: flow.id,
        name: flow.name,
        nodeCount: flow.nodes.length,
        edgeCount: flow.edges.length,
      });
    } catch (err) {
      sendFlowToolResponse(requestId, false, undefined, err instanceof Error ? err.message : "Unknown error");
    }
  };

  /** Handle flow_tool_delete: delete a flow */
  const handleFlowToolDelete = async (msg: Record<string, unknown>) => {
    const requestId = msg.requestId as string;
    try {
      const flowId = msg.flowId as string;
      const flow = await loadFlow(flowId);
      if (!flow) {
        sendFlowToolResponse(requestId, false, undefined, `Flow "${flowId}" not found`);
        return;
      }

      // Save version before deletion
      await saveFlowVersion(flowId, "delete", `Deleted "${flow.name}"`, flow);
      await deleteFlowFromDb(flowId);

      sendFlowToolResponse(requestId, true, { deleted: true, name: flow.name });
    } catch (err) {
      sendFlowToolResponse(requestId, false, undefined, err instanceof Error ? err.message : "Unknown error");
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
