import { WebSocket } from "ws";
import { query, type Options, type SDKMessage, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { executeFlow, cancelExecution, resolveHumanReview } from "./flow-engine.js";
import type { FlowDefinition } from "./flow-types.js";
import { mcpManager } from "./mcp-manager.js";
import { ContextAgentManager } from "./context-agent.js";

// Initialize MCP manager (server configs will be provided by the frontend)
console.log(`[agent] MCP manager ready (${mcpManager.listServers().length} servers)`);

// In-memory API key storage (will be replaced with secure storage)
let apiKey: string | null = null;

// Global project root — set when the user opens a folder in the file tree
let globalProjectRoot: string | null = null;

export function getGlobalProjectRoot(): string | null {
  return globalProjectRoot;
}

interface ImageAttachment {
  id: string;
  dataUrl: string;
  mimeType: string;
  name: string;
}

interface HistoryMessage {
  role: "user" | "assistant";
  content: string;
}

interface UserMessage {
  type: "user_message";
  content: string;
  images?: ImageAttachment[];
  history?: HistoryMessage[];
  sessionId?: string;
}

interface SetApiKeyMessage {
  type: "set_api_key";
  key: string;
}

interface CancelMessage {
  type: "cancel";
}

interface PingMessage {
  type: "ping";
}

interface ExecuteFlowMessage {
  type: "execute_flow";
  flow: FlowDefinition;
  input: string;
  history?: HistoryMessage[];
  sessionId?: string;
}

interface CancelFlowMessage {
  type: "cancel_flow";
  executionId: string;
}

interface SetProjectRootMessage {
  type: "set_project_root";
  path: string;
}

interface ResolveReviewMessage {
  type: "resolve_review";
  nodeId: string;
  approved: boolean;
}

type IncomingMessage =
  | UserMessage
  | SetApiKeyMessage
  | SetProjectRootMessage
  | CancelMessage
  | PingMessage
  | ExecuteFlowMessage
  | CancelFlowMessage
  | ResolveReviewMessage;

function send(ws: WebSocket, data: unknown): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

// Track active queries for cancellation
let activeAbortController: AbortController | null = null;

// Map frontend session IDs to SDK session IDs for conversation resumption
const sdkSessionMap = new Map<string, string>();

// Context Agent manager — one agent per session, used for flow execution
const contextManager = new ContextAgentManager();

export async function handleMessage(
  ws: WebSocket,
  message: IncomingMessage
): Promise<void> {
  switch (message.type) {
    case "ping":
      send(ws, { type: "pong" });
      break;

    case "set_api_key":
      apiKey = message.key;
      send(ws, { type: "status", status: "api_key_set" });
      console.log("[agent] API key configured");
      break;

    case "set_project_root":
      globalProjectRoot = message.path;
      send(ws, { type: "status", status: "project_root_set" });
      console.log(`[agent] Project root set to: ${message.path}`);
      break;

    case "cancel":
      if (activeAbortController) {
        activeAbortController.abort();
        activeAbortController = null;
      }
      send(ws, { type: "status", status: "cancelled" });
      break;

    case "user_message":
      await handleUserMessage(ws, message.content, message.images, message.history, message.sessionId);
      break;

    case "execute_flow":
      if (!apiKey) {
        send(ws, { type: "error", message: "No API key configured." });
      } else {
        // Get or create a Context Agent for this session (used for multi-turn flow context)
        const contextAgent = message.sessionId
          ? contextManager.getOrCreate(message.sessionId)
          : undefined;
        executeFlow(ws, message.flow, message.input, apiKey, message.history, message.sessionId, contextAgent).catch((err) => {
          console.error("[agent] Flow execution error:", err);
        });
      }
      break;

    case "cancel_flow":
      cancelExecution(message.executionId);
      break;

    case "resolve_review":
      resolveHumanReview(message.nodeId, message.approved);
      break;
  }
}

function parseDataUrl(dataUrl: string): { mediaType: string; data: string } | null {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return { mediaType: match[1], data: match[2] };
}

/**
 * Format conversation history into a text block for inclusion in the prompt.
 * Returns empty string if no history is present.
 */
function formatHistory(history?: HistoryMessage[]): string {
  if (!history || history.length === 0) return "";

  const turns = history.map((m) => {
    const role = m.role === "user" ? "User" : "Assistant";
    return `${role}: ${m.content}`;
  }).join("\n\n");

  return `<conversation_history>
${turns}
</conversation_history>

`;
}

async function handleUserMessage(
  ws: WebSocket,
  content: string,
  images?: ImageAttachment[],
  history?: HistoryMessage[],
  sessionId?: string,
): Promise<void> {
  if (!apiKey) {
    send(ws, {
      type: "error",
      message: "No API key configured. Please set your Anthropic API key in Settings.",
    });
    return;
  }

  const messageId = crypto.randomUUID();

  try {
    // Set the API key as environment variable for the Agent SDK
    process.env.ANTHROPIC_API_KEY = apiKey;

    activeAbortController = new AbortController();

    // Check if we have a prior SDK session to resume (multi-turn context)
    const sdkSid = sessionId ? sdkSessionMap.get(sessionId) : undefined;

    const options: Options = {
      model: "sonnet",
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      // Enable all SDK tools for direct chat when a project is open
      tools: { type: "preset" as const, preset: "claude_code" as const },
      // Set working directory to the user's project
      ...(globalProjectRoot ? { cwd: globalProjectRoot } : {}),
      // Load CLAUDE.md and project settings if available
      settingSources: ["project" as const],
      // Enable streaming partial messages
      includePartialMessages: true,
      abortController: activeAbortController,
      // SDK session management: resume if we have a prior session, otherwise persist
      ...(sdkSid
        ? { resume: sdkSid }
        : { persistSession: true }),
    };

    // When resuming an SDK session, send just the raw message (SDK has full history).
    // When starting fresh with no SDK session, use history prepend as fallback.
    let effectiveContent = content;
    if (!sdkSid) {
      const historyPrefix = formatHistory(history);
      if (historyPrefix) {
        effectiveContent = `${historyPrefix}${content}`;
      }
    }

    // Build the prompt — either a simple string or multi-part with images
    let prompt: string | AsyncIterable<SDKUserMessage>;

    if (images && images.length > 0) {
      // Build multi-part content blocks for the Anthropic API
      const contentBlocks: Array<Record<string, unknown>> = [];

      for (const img of images) {
        const parsed = parseDataUrl(img.dataUrl);
        if (parsed) {
          contentBlocks.push({
            type: "image",
            source: {
              type: "base64",
              media_type: parsed.mediaType,
              data: parsed.data,
            },
          });
        }
      }

      if (effectiveContent) {
        contentBlocks.push({ type: "text", text: effectiveContent });
      }

      // Wrap as an async iterable yielding a single SDKUserMessage
      async function* messageGenerator(): AsyncGenerator<SDKUserMessage> {
        yield {
          type: "user",
          message: { role: "user", content: contentBlocks },
          parent_tool_use_id: null,
          session_id: "",
        } as SDKUserMessage;
      }
      prompt = messageGenerator();
    } else {
      prompt = effectiveContent;
    }

    // Track tool call start times for duration calculation
    const toolStartTimes = new Map<string, number>();

    // Use the Claude Agent SDK to handle the message
    for await (const event of query({ prompt, options })) {
      handleSDKEvent(ws, messageId, event, sessionId, toolStartTimes);
    }
  } catch (err) {
    console.error("[agent] Error:", err);

    send(ws, {
      type: "assistant_text",
      messageId,
      delta: `Error communicating with Claude API: ${err instanceof Error ? err.message : "Unknown error"}\n\nPlease check your API key and try again.`,
    });
    send(ws, {
      type: "assistant_text_done",
      messageId,
      model: "sonnet",
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
    });
  } finally {
    activeAbortController = null;
  }
}

/** Summarize an SDK event for debug logging */
function summarizeSDKEvent(event: SDKMessage): string {
  const e = event as Record<string, unknown>;
  switch (event.type) {
    case "assistant": {
      const content = (e.message as Record<string, unknown>)?.content;
      if (Array.isArray(content)) {
        const blockTypes = content.map((b: Record<string, unknown>) => b.type).join(", ");
        return `blocks: [${blockTypes}]`;
      }
      return "assistant message";
    }
    case "user": {
      const parentId = e.parent_tool_use_id as string | null;
      if (parentId) return `tool_result for ${parentId}`;
      return "user message";
    }
    case "result":
      return `${e.subtype} | turns=${e.num_turns} | cost=$${(e.total_cost_usd as number)?.toFixed(4) ?? "?"}`;
    case "system":
      return `${e.subtype}${e.model ? ` | model=${e.model}` : ""}${e.tools ? ` | tools=${(e.tools as string[]).length}` : ""}`;
    case "tool_progress":
      return `${e.tool_name} (${e.tool_use_id}) ${e.elapsed_time_seconds}s`;
    case "tool_use_summary":
      return `${(e.preceding_tool_use_ids as string[])?.length ?? 0} tools: ${(e.summary as string)?.slice(0, 200)}`;
    default:
      return JSON.stringify(e, null, 2).slice(0, 300);
  }
}

/** Send a debug log entry to the frontend */
function emitDebugLog(ws: WebSocket, source: string, message: string, detail?: string): void {
  send(ws, {
    type: "debug_log",
    entry: {
      id: `dbg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
      level: "debug",
      source,
      message,
      detail: detail?.slice(0, 2000),
      status: "complete",
    },
  });
}

function handleSDKEvent(ws: WebSocket, messageId: string, event: SDKMessage, frontendSessionId?: string, toolStartTimes?: Map<string, number>): void {
  // Debug log every event type
  const eventType = event.type;
  const subtype = (event as Record<string, unknown>).subtype as string | undefined;
  const label = subtype ? `${eventType}:${subtype}` : eventType;

  // Skip stream_event text deltas from debug log (too noisy)
  if (eventType !== "stream_event") {
    const debugDetail = summarizeSDKEvent(event);
    console.log(`[sdk-event] ${label}${debugDetail ? ` | ${debugDetail}` : ""}`);
    emitDebugLog(ws, `sdk:${label}`, debugDetail || label);
  }

  switch (event.type) {
    case "stream_event": {
      // SDKPartialAssistantMessage — streaming deltas
      const streamEvent = event.event;

      // Log non-text stream events for debug (content_block_start, content_block_stop, etc.)
      if (streamEvent.type !== "content_block_delta") {
        const streamDetail = JSON.stringify(streamEvent, null, 2).slice(0, 500);
        console.log(`[sdk-event] stream_event:${streamEvent.type}`);
        emitDebugLog(ws, `sdk:stream:${streamEvent.type}`, streamDetail);
      }

      if (
        streamEvent.type === "content_block_delta" &&
        "delta" in streamEvent &&
        streamEvent.delta.type === "text_delta"
      ) {
        send(ws, {
          type: "assistant_text",
          messageId,
          delta: streamEvent.delta.text,
        });
      }
      break;
    }

    case "assistant": {
      // SDKAssistantMessage — complete message with all content blocks
      // We primarily use stream_event for text, but extract tool use from here
      if (event.message?.content) {
        for (const block of event.message.content) {
          if (block.type === "tool_use") {
            const startedAt = Date.now();
            toolStartTimes?.set(block.id, startedAt);
            send(ws, {
              type: "tool_call_start",
              messageId,
              toolCall: {
                id: block.id,
                name: block.name,
                args: block.input as Record<string, unknown>,
                status: "loading" as const,
                startedAt,
              },
            });
          }
        }
      }
      break;
    }

    case "user": {
      // SDKUserMessage — tool result after SDK executed a tool
      if (event.parent_tool_use_id) {
        let resultText = "";
        let isError = false;

        // Extract result from tool_use_result (raw result from tool execution)
        const raw = (event as Record<string, unknown>).tool_use_result;
        if (typeof raw === "string") {
          resultText = raw;
        } else if (raw != null) {
          resultText = JSON.stringify(raw, null, 2);
        }

        // Check message.content for is_error flag and fallback result extraction
        const msgContent = (event.message as Record<string, unknown>)?.content;
        if (Array.isArray(msgContent)) {
          for (const block of msgContent) {
            const b = block as Record<string, unknown>;
            if (b.type === "tool_result" && b.tool_use_id === event.parent_tool_use_id) {
              if (b.is_error) isError = true;
              if (!resultText && b.content != null) {
                resultText = typeof b.content === "string"
                  ? b.content
                  : JSON.stringify(b.content, null, 2);
              }
            }
          }
        }

        const startTime = toolStartTimes?.get(event.parent_tool_use_id);
        const durationMs = startTime ? Date.now() - startTime : 0;
        toolStartTimes?.delete(event.parent_tool_use_id);

        send(ws, {
          type: "tool_call_done",
          messageId,
          toolCallId: event.parent_tool_use_id,
          result: resultText,
          status: isError ? ("error" as const) : ("success" as const),
          durationMs,
        });
      }
      break;
    }

    case "result": {
      // SDKResultMessage — final result with cost and usage
      if (event.subtype === "success") {
        // Capture SDK session ID for future resume (multi-turn context)
        const resultSessionId = (event as Record<string, unknown>).session_id as string | undefined;
        if (resultSessionId && frontendSessionId) {
          sdkSessionMap.set(frontendSessionId, resultSessionId);
          console.log(`[agent] SDK session mapped: ${frontendSessionId} -> ${resultSessionId}`);
        }

        send(ws, {
          type: "assistant_text_done",
          messageId,
          model: "sonnet",
          tokensIn: event.usage?.input_tokens ?? 0,
          tokensOut: event.usage?.output_tokens ?? 0,
          costUsd: event.total_cost_usd ?? 0,
        });
      }
      break;
    }
  }
}
