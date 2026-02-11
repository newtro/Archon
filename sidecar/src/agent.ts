import { WebSocket } from "ws";
import { query, type Options, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { executeFlow, cancelExecution, resolveHumanReview } from "./flow-engine.js";
import type { FlowDefinition } from "./flow-types.js";
import { mcpManager } from "./mcp-manager.js";

// Initialize MCP manager (server configs will be provided by the frontend)
console.log(`[agent] MCP manager ready (${mcpManager.listServers().length} servers)`);

// In-memory API key storage (will be replaced with secure storage)
let apiKey: string | null = null;

// Global project root — set when the user opens a folder in the file tree
let globalProjectRoot: string | null = null;

export function getGlobalProjectRoot(): string | null {
  return globalProjectRoot;
}

interface UserMessage {
  type: "user_message";
  content: string;
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
      await handleUserMessage(ws, message.content);
      break;

    case "execute_flow":
      if (!apiKey) {
        send(ws, { type: "error", message: "No API key configured." });
      } else {
        executeFlow(ws, message.flow, message.input, apiKey).catch((err) => {
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

async function handleUserMessage(ws: WebSocket, content: string): Promise<void> {
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
    };

    // Use the Claude Agent SDK to handle the message
    for await (const event of query({ prompt: content, options })) {
      handleSDKEvent(ws, messageId, event);
    }

    send(ws, {
      type: "assistant_text_done",
      messageId,
      model: "sonnet",
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
    });
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

function handleSDKEvent(ws: WebSocket, messageId: string, event: SDKMessage): void {
  switch (event.type) {
    case "stream_event": {
      // SDKPartialAssistantMessage — streaming deltas
      const streamEvent = event.event;
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
            send(ws, {
              type: "tool_call_start",
              messageId,
              toolCallId: block.id,
              name: block.name,
              args: block.input as Record<string, unknown>,
            });
          }
        }
      }
      break;
    }

    case "result": {
      // SDKResultMessage — final result with cost and usage
      if (event.subtype === "success") {
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
