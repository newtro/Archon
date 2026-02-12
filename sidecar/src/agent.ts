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
      // Change process CWD so the Agent SDK resolves project settings
      // (CLAUDE.md, .claude/) from the user's project, not the sidecar directory
      try { process.chdir(message.path); } catch { /* ignore if path doesn't exist yet */ }
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

    // Build a system prompt that clearly scopes the AI to the user's loaded project
    const projectSystemPrompt = globalProjectRoot
      ? `You are an AI coding assistant embedded in an IDE. The user has opened the project located at: ${globalProjectRoot}

When the user says "this app", "the project", "this codebase", or similar, they are referring to THEIR project at that path — not the IDE application itself.

Focus exclusively on the user's project. Use your tools to explore and understand it before answering questions about it.`
      : undefined;

    const options: Options = {
      model: "sonnet",
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      // Enable all SDK tools for direct chat when a project is open
      tools: { type: "preset" as const, preset: "claude_code" as const },
      // Set working directory to the user's project
      ...(globalProjectRoot ? { cwd: globalProjectRoot } : {}),
      // System prompt scopes the AI to the loaded project (not the IDE)
      ...(projectSystemPrompt ? { systemPrompt: projectSystemPrompt } : {}),
      // Load CLAUDE.md from the user's project if available
      ...(globalProjectRoot ? { settingSources: ["project" as const] } : {}),
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

    // Track tool calls, turns, and emit debug info
    const tracker = createQueryTracker();

    emitDebugLog(ws, "agent", `Starting query | messageId=${messageId} | cwd=${globalProjectRoot ?? "(none)"} | resuming=${!!sdkSid}`);
    console.log(`[agent] Starting query | cwd=${globalProjectRoot} | resuming=${!!sdkSid}`);

    // Use the Claude Agent SDK to handle the message
    let eventCount = 0;
    for await (const event of query({ prompt, options })) {
      eventCount++;
      handleSDKEvent(ws, messageId, event, sessionId, tracker);
    }

    emitDebugLog(ws, "agent", `Query complete | ${eventCount} events | ${tracker.turnCount} turns | ${tracker.emittedToolIds.size} tools`);
    console.log(`[agent] Query complete | ${eventCount} events | ${tracker.turnCount} turns | ${tracker.emittedToolIds.size} tools`);
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
      detail: detail?.slice(0, 4000),
      status: "complete",
    },
  });
}

/** Safely serialize an object for debug, redacting large fields */
function debugJson(obj: unknown, maxLen = 2000): string {
  try {
    return JSON.stringify(obj, (_key, val) => {
      // Truncate long strings (file contents, base64, etc.)
      if (typeof val === "string" && val.length > 500) {
        return val.slice(0, 500) + `... (${val.length} chars)`;
      }
      return val;
    }, 2).slice(0, maxLen);
  } catch {
    return String(obj).slice(0, maxLen);
  }
}

/** State tracker for a single query — tracks tool calls, turns, emitted IDs */
interface QueryTracker {
  toolStartTimes: Map<string, number>;
  emittedToolIds: Set<string>;
  turnCount: number;
}

function createQueryTracker(): QueryTracker {
  return {
    toolStartTimes: new Map(),
    emittedToolIds: new Set(),
    turnCount: 0,
  };
}

function handleSDKEvent(ws: WebSocket, messageId: string, event: SDKMessage, frontendSessionId?: string, tracker?: QueryTracker): void {
  const e = event as Record<string, unknown>;
  const eventType = event.type;
  const subtype = e.subtype as string | undefined;
  const label = subtype ? `${eventType}:${subtype}` : eventType;

  // ── Debug log EVERY event (skip only text_delta stream events — too noisy) ──
  const isTextDelta =
    eventType === "stream_event" &&
    (e.event as Record<string, unknown>)?.type === "content_block_delta" &&
    ((e.event as Record<string, unknown>)?.delta as Record<string, unknown>)?.type === "text_delta";

  if (!isTextDelta) {
    let detail: string;
    if (eventType === "stream_event") {
      detail = debugJson(e.event, 1500);
    } else if (eventType === "assistant") {
      // Show content block types and tool names, not full message
      const content = (e.message as Record<string, unknown>)?.content;
      const blocks = Array.isArray(content)
        ? content.map((b: Record<string, unknown>) => {
            if (b.type === "tool_use") return `tool_use(${b.name}, id=${b.id})`;
            if (b.type === "text") return `text(${((b.text as string) ?? "").slice(0, 100)}...)`;
            return String(b.type);
          })
        : [];
      detail = `turn ${tracker?.turnCount ?? "?"}, blocks: [${blocks.join(", ")}]`;
    } else if (eventType === "user") {
      const parentId = e.parent_tool_use_id;
      detail = parentId
        ? `tool_result for ${parentId}\n${debugJson(e.tool_use_result, 800)}`
        : `user message\n${debugJson(e.message, 800)}`;
    } else if (eventType === "result") {
      detail = `subtype=${e.subtype} turns=${e.num_turns} cost=$${(e.total_cost_usd as number)?.toFixed(4)} tokens_in=${(e.usage as Record<string, unknown>)?.input_tokens} tokens_out=${(e.usage as Record<string, unknown>)?.output_tokens}`;
      if (e.subtype !== "success") {
        detail += `\nerrors: ${debugJson((e as Record<string, unknown>).errors, 500)}`;
      }
    } else {
      detail = debugJson(e, 1500);
    }

    console.log(`[sdk] ${label} | ${detail.split("\n")[0]}`);
    emitDebugLog(ws, `sdk:${label}`, detail);
  }

  // ── Handle each event type ──────────────────────────────────────────────────

  switch (event.type) {
    case "stream_event": {
      const streamEvent = event.event as Record<string, unknown>;
      const streamType = streamEvent.type as string;

      // Detect tool_use blocks from content_block_start (earliest detection point)
      if (streamType === "content_block_start") {
        const contentBlock = streamEvent.content_block as Record<string, unknown> | undefined;
        if (contentBlock?.type === "tool_use" && contentBlock.id && contentBlock.name) {
          const toolId = contentBlock.id as string;
          if (tracker && !tracker.emittedToolIds.has(toolId)) {
            const startedAt = Date.now();
            tracker.emittedToolIds.add(toolId);
            tracker.toolStartTimes.set(toolId, startedAt);
            send(ws, {
              type: "tool_call_start",
              messageId,
              toolCall: {
                id: toolId,
                name: contentBlock.name as string,
                args: (contentBlock.input as Record<string, unknown>) ?? {},
                status: "loading" as const,
                startedAt,
              },
            });
            console.log(`[sdk] TOOL_START from stream: ${contentBlock.name} (${toolId})`);
          }
        }
      }

      // Stream text deltas to the frontend
      if (
        streamType === "content_block_delta" &&
        streamEvent.delta &&
        (streamEvent.delta as Record<string, unknown>).type === "text_delta"
      ) {
        send(ws, {
          type: "assistant_text",
          messageId,
          delta: (streamEvent.delta as Record<string, unknown>).text as string,
        });
      }
      break;
    }

    case "assistant": {
      // Increment turn counter
      if (tracker) tracker.turnCount++;

      // Extract tool_use blocks — emit only if not already emitted from stream_event
      if (event.message?.content) {
        for (const block of event.message.content) {
          if (block.type === "tool_use") {
            if (tracker && !tracker.emittedToolIds.has(block.id)) {
              const startedAt = Date.now();
              tracker.emittedToolIds.add(block.id);
              tracker.toolStartTimes.set(block.id, startedAt);
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
              console.log(`[sdk] TOOL_START from assistant: ${block.name} (${block.id})`);
            }
          }
        }
      }
      break;
    }

    case "user": {
      // Tool result — the SDK executed a tool and this is the result
      if (event.parent_tool_use_id) {
        let resultText = "";
        let isError = false;

        // Strategy 1: Extract from message.content (Anthropic API format)
        const msgContent = (event.message as Record<string, unknown>)?.content;
        if (Array.isArray(msgContent)) {
          for (const block of msgContent) {
            const b = block as Record<string, unknown>;
            if (b.type === "tool_result") {
              if (b.is_error) isError = true;
              const c = b.content;
              if (typeof c === "string") {
                resultText = c;
              } else if (Array.isArray(c)) {
                // content block array — extract text
                resultText = c
                  .filter((x: Record<string, unknown>) => x.type === "text")
                  .map((x: Record<string, unknown>) => x.text as string)
                  .join("\n");
              } else if (c != null) {
                resultText = JSON.stringify(c, null, 2);
              }
            }
          }
        }

        // Strategy 2: Fallback to tool_use_result field
        if (!resultText) {
          const raw = e.tool_use_result;
          if (typeof raw === "string") {
            resultText = raw;
          } else if (raw != null) {
            resultText = JSON.stringify(raw, null, 2);
          }
        }

        // Strategy 3: If message is a plain string
        if (!resultText && typeof msgContent === "string") {
          resultText = msgContent;
        }

        const startTime = tracker?.toolStartTimes.get(event.parent_tool_use_id);
        const durationMs = startTime ? Date.now() - startTime : 0;
        tracker?.toolStartTimes.delete(event.parent_tool_use_id);

        send(ws, {
          type: "tool_call_done",
          messageId,
          toolCallId: event.parent_tool_use_id,
          result: resultText,
          status: isError ? ("error" as const) : ("success" as const),
          durationMs,
        });

        console.log(`[sdk] TOOL_DONE: ${event.parent_tool_use_id} ${isError ? "ERROR" : "OK"} (${durationMs}ms, ${resultText.length} chars)`);
      }
      break;
    }

    case "result": {
      // Capture SDK session ID for future resume
      const resultSessionId = e.session_id as string | undefined;
      if (resultSessionId && frontendSessionId) {
        sdkSessionMap.set(frontendSessionId, resultSessionId);
      }

      // Send assistant_text_done for both success and error results
      send(ws, {
        type: "assistant_text_done",
        messageId,
        model: "sonnet",
        tokensIn: event.usage?.input_tokens ?? 0,
        tokensOut: event.usage?.output_tokens ?? 0,
        costUsd: event.total_cost_usd ?? 0,
      });

      if (event.subtype !== "success") {
        // Also show error message in chat
        const errors = (e.errors as string[]) ?? [];
        const errMsg = errors.length > 0 ? errors.join("\n") : `Agent stopped: ${event.subtype}`;
        send(ws, {
          type: "assistant_text",
          messageId,
          delta: `\n\n---\n**Agent stopped** (${event.subtype}): ${errMsg}`,
        });
      }

      console.log(`[sdk] RESULT: ${event.subtype} | ${tracker?.turnCount ?? 0} turns | $${event.total_cost_usd?.toFixed(4)}`);
      break;
    }

    // Handle additional event types for observability
    case "system": {
      // SDK init event — log tools, model, cwd
      const tools = (e.tools as string[]) ?? [];
      const model = e.model as string;
      const cwd = e.cwd as string;
      console.log(`[sdk] SYSTEM:${subtype} model=${model} cwd=${cwd} tools=[${tools.join(",")}]`);
      break;
    }

    default:
      // Log any unhandled event types
      console.log(`[sdk] UNHANDLED: ${label}`);
      break;
  }
}
