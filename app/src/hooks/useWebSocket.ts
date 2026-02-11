import { useEffect, useRef, useState, useCallback } from "react";
import type { WSMessageToSidecar, WSMessageFromSidecar, ChatMessage, FlowExecutionEvent } from "../lib/types";

interface UseWebSocketOptions {
  onMessage: (msg: ChatMessage) => void;
  onStatusChange: (connected: boolean) => void;
  onFlowEvent?: (event: FlowExecutionEvent) => void;
  onConnect?: (send: (msg: WSMessageToSidecar) => void) => void;
}

const SIDECAR_PORT = 9399;
const RECONNECT_DELAY_MS = 2000;
const MAX_RECONNECT_ATTEMPTS = 10;

export function useWebSocket({ onMessage, onStatusChange, onFlowEvent, onConnect }: UseWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<string>("disconnected");
  const reconnectAttempts = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stable references for callbacks
  const onMessageRef = useRef(onMessage);
  const onStatusChangeRef = useRef(onStatusChange);
  const onFlowEventRef = useRef(onFlowEvent);
  const onConnectRef = useRef(onConnect);
  onMessageRef.current = onMessage;
  onStatusChangeRef.current = onStatusChange;
  onFlowEventRef.current = onFlowEvent;
  onConnectRef.current = onConnect;

  // Accumulator for streaming assistant messages
  const streamingMessage = useRef<ChatMessage | null>(null);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    setConnectionStatus("connecting");
    const ws = new WebSocket(`ws://localhost:${SIDECAR_PORT}`);

    ws.onopen = () => {
      setConnectionStatus("connected");
      onStatusChangeRef.current(true);
      reconnectAttempts.current = 0;
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
        }
        streamingMessage.current.content += data.delta;
        onMessageRef.current({ ...streamingMessage.current });
        break;
      }

      case "assistant_text_done": {
        if (streamingMessage.current?.id === data.messageId) {
          streamingMessage.current.isStreaming = false;
          streamingMessage.current.model = data.model;
          streamingMessage.current.tokensIn = data.tokensIn;
          streamingMessage.current.tokensOut = data.tokensOut;
          streamingMessage.current.costUsd = data.costUsd;
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
          }
        }
        break;
      }

      case "tool_call_start": {
        if (streamingMessage.current?.id === data.messageId) {
          streamingMessage.current.toolCalls = [
            ...(streamingMessage.current.toolCalls || []),
            data.toolCall,
          ];
          onMessageRef.current({ ...streamingMessage.current });
        }
        break;
      }

      case "tool_call_done": {
        if (streamingMessage.current?.id === data.messageId) {
          const toolCall = streamingMessage.current.toolCalls?.find((t) => t.id === data.toolCallId);
          if (toolCall) {
            toolCall.result = data.result;
            toolCall.status = data.status;
            toolCall.durationMs = data.durationMs;
            onMessageRef.current({ ...streamingMessage.current });
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
        break;
      }

      case "pong":
        break;

      // Flow execution events
      case "flow_started":
      case "node_started":
      case "node_streaming":
      case "node_completed":
      case "node_error":
      case "flow_completed":
      case "flow_error":
      case "human_review_requested":
        onFlowEventRef.current?.(data as FlowExecutionEvent);
        break;
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
