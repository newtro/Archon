import { WebSocket } from "ws";
import { query, type Options, type SDKMessage, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { executeFlow, cancelExecution, resolveHumanReview, getRawMessages } from "./flow-engine.js";
import type { FlowDefinition } from "./flow-types.js";
import { mcpManager } from "./mcp-manager.js";
import { ContextAgentManager } from "./context-agent.js";
import { countTokenBreakdown, resetTokenCounterClient } from "./token-counter.js";
import { flowToolsServer, setFlowToolsWs, handleFlowToolResponse } from "./flow-tools.js";
import * as gitManager from "./git-manager.js";

// Initialize MCP manager (server configs will be provided by the frontend)
console.log(`[agent] MCP manager ready (${mcpManager.listServers().length} servers)`);

// In-memory API key storage (will be replaced with secure storage)
let apiKey: string | null = null;
let openrouterApiKey: string | null = null;

export function getOpenRouterApiKey(): string | null {
  return openrouterApiKey;
}

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

interface SetOpenRouterKeyMessage {
  type: "set_openrouter_key";
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

interface GetContextRawMessage {
  type: "get_context_raw";
  executionId: string;
  nodeId: string;
}

interface FlowToolResponseMessage {
  type: "flow_tool_response";
  requestId: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

// Git message types
interface GitStatusMessage { type: "git_status" }
interface GitDiffMessage { type: "git_diff"; file?: string; staged?: boolean }
interface GitLogMessage { type: "git_log"; page: number; pageSize: number }
interface GitBranchesMessage { type: "git_branches" }
interface GitStageMessage { type: "git_stage"; files: string[] }
interface GitUnstageMessage { type: "git_unstage"; files: string[] }
interface GitCommitMessage { type: "git_commit"; message: string }
interface GitPushMessage { type: "git_push"; remote?: string; branch?: string }
interface GitPullMessage { type: "git_pull"; remote?: string; branch?: string }
interface GitCheckoutMessage { type: "git_checkout"; branch: string }
interface GitCreateBranchMessage { type: "git_create_branch"; name: string; startPoint?: string }
interface GitRemotesMessage { type: "git_remotes" }
interface GitAddRemoteMessage { type: "git_add_remote"; name: string; url: string }
interface GitRemoveRemoteMessage { type: "git_remove_remote"; name: string }
interface GitInitMessage { type: "git_init" }
interface GitDiscardMessage { type: "git_discard"; files: string[] }
interface GitStartWatchingMessage { type: "git_start_watching" }
interface GitStopWatchingMessage { type: "git_stop_watching" }
interface GitGenerateCommitMsgMessage { type: "git_generate_commit_msg" }
interface GitShowMessage { type: "git_show"; hash: string }

type GitMessage =
  | GitStatusMessage | GitDiffMessage | GitLogMessage | GitBranchesMessage
  | GitStageMessage | GitUnstageMessage | GitCommitMessage
  | GitPushMessage | GitPullMessage
  | GitCheckoutMessage | GitCreateBranchMessage
  | GitRemotesMessage | GitAddRemoteMessage | GitRemoveRemoteMessage
  | GitInitMessage | GitDiscardMessage
  | GitStartWatchingMessage | GitStopWatchingMessage
  | GitGenerateCommitMsgMessage | GitShowMessage;

type IncomingMessage =
  | UserMessage
  | SetApiKeyMessage
  | SetOpenRouterKeyMessage
  | SetProjectRootMessage
  | CancelMessage
  | PingMessage
  | ExecuteFlowMessage
  | CancelFlowMessage
  | ResolveReviewMessage
  | GetContextRawMessage
  | FlowToolResponseMessage
  | GitMessage;

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

// Cumulative stats for chat-mode context view
interface ChatCumulativeStats {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
}
const chatSessionStats = new Map<string, ChatCumulativeStats>();

export async function handleMessage(
  ws: WebSocket,
  message: IncomingMessage
): Promise<void> {
  // Keep flow tools' WebSocket reference current
  setFlowToolsWs(ws);

  switch (message.type) {
    case "ping":
      send(ws, { type: "pong" });
      break;

    case "set_api_key":
      apiKey = message.key;
      send(ws, { type: "status", status: "api_key_set" });
      console.log("[agent] API key configured");
      break;

    case "set_openrouter_key":
      openrouterApiKey = (message as SetOpenRouterKeyMessage).key;
      send(ws, { type: "status", status: "openrouter_key_set" });
      console.log("[agent] OpenRouter API key configured");
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

    case "get_context_raw": {
      const raw = getRawMessages(message.executionId, message.nodeId);
      send(ws, {
        type: "context_raw_response",
        nodeId: message.nodeId,
        executionId: message.executionId,
        messages: raw ?? [],
      });
      break;
    }

    case "flow_tool_response":
      // Route response from frontend back to the pending flow tool request
      handleFlowToolResponse(message.requestId, {
        success: message.success,
        data: message.data,
        error: message.error,
      });
      break;

    // ── Git operations ────────────────────────────────────────────
    case "git_status":
      await handleGitCommand(ws, "git_status", async () => {
        const data = await gitManager.getStatus();
        send(ws, { type: "git_status_response", data });
      });
      break;

    case "git_diff":
      await handleGitCommand(ws, "git_diff", async () => {
        const data = message.staged
          ? await gitManager.getDiffStaged(message.file)
          : await gitManager.getDiff(message.file);
        send(ws, { type: "git_diff_response", data });
      });
      break;

    case "git_log":
      await handleGitCommand(ws, "git_log", async () => {
        const data = await gitManager.getLog(message.page, message.pageSize);
        send(ws, { type: "git_log_response", data });
      });
      break;

    case "git_branches":
      await handleGitCommand(ws, "git_branches", async () => {
        const data = await gitManager.getBranches();
        send(ws, { type: "git_branches_response", data });
      });
      break;

    case "git_stage":
      await handleGitCommand(ws, "git_stage", async () => {
        await gitManager.stage(message.files);
        send(ws, { type: "git_operation_complete", operation: "stage", success: true });
        // Auto-refresh status after staging
        const data = await gitManager.getStatus();
        send(ws, { type: "git_status_response", data });
      });
      break;

    case "git_unstage":
      await handleGitCommand(ws, "git_unstage", async () => {
        await gitManager.unstage(message.files);
        send(ws, { type: "git_operation_complete", operation: "unstage", success: true });
        const data = await gitManager.getStatus();
        send(ws, { type: "git_status_response", data });
      });
      break;

    case "git_commit":
      await handleGitCommand(ws, "git_commit", async () => {
        const hash = await gitManager.commit(message.message);
        send(ws, { type: "git_operation_complete", operation: "commit", success: true, message: hash });
        const data = await gitManager.getStatus();
        send(ws, { type: "git_status_response", data });
      });
      break;

    case "git_push":
      await handleGitCommand(ws, "git_push", async () => {
        const result = await gitManager.push(message.remote, message.branch);
        send(ws, { type: "git_operation_complete", operation: "push", success: true, message: result });
        const data = await gitManager.getStatus();
        send(ws, { type: "git_status_response", data });
      });
      break;

    case "git_pull":
      await handleGitCommand(ws, "git_pull", async () => {
        const result = await gitManager.pull(message.remote, message.branch);
        send(ws, { type: "git_operation_complete", operation: "pull", success: true, message: result });
        const data = await gitManager.getStatus();
        send(ws, { type: "git_status_response", data });
      });
      break;

    case "git_checkout":
      await handleGitCommand(ws, "git_checkout", async () => {
        await gitManager.checkout(message.branch);
        send(ws, { type: "git_operation_complete", operation: "checkout", success: true });
        const data = await gitManager.getStatus();
        send(ws, { type: "git_status_response", data });
      });
      break;

    case "git_create_branch":
      await handleGitCommand(ws, "git_create_branch", async () => {
        await gitManager.createBranch(message.name, message.startPoint);
        send(ws, { type: "git_operation_complete", operation: "create_branch", success: true });
        const data = await gitManager.getStatus();
        send(ws, { type: "git_status_response", data });
      });
      break;

    case "git_remotes":
      await handleGitCommand(ws, "git_remotes", async () => {
        const data = await gitManager.getRemotes();
        send(ws, { type: "git_remotes_response", data });
      });
      break;

    case "git_add_remote":
      await handleGitCommand(ws, "git_add_remote", async () => {
        await gitManager.addRemote(message.name, message.url);
        send(ws, { type: "git_operation_complete", operation: "add_remote", success: true });
      });
      break;

    case "git_remove_remote":
      await handleGitCommand(ws, "git_remove_remote", async () => {
        await gitManager.removeRemote(message.name);
        send(ws, { type: "git_operation_complete", operation: "remove_remote", success: true });
      });
      break;

    case "git_init":
      await handleGitCommand(ws, "git_init", async () => {
        await gitManager.init();
        send(ws, { type: "git_operation_complete", operation: "init", success: true });
        const data = await gitManager.getStatus();
        send(ws, { type: "git_status_response", data });
      });
      break;

    case "git_discard":
      await handleGitCommand(ws, "git_discard", async () => {
        const git = (await import("simple-git")).default(globalProjectRoot!);
        await git.checkout(["--", ...message.files]);
        send(ws, { type: "git_operation_complete", operation: "discard", success: true });
        const data = await gitManager.getStatus();
        send(ws, { type: "git_status_response", data });
      });
      break;

    case "git_start_watching":
      gitManager.startWatching((status) => {
        send(ws, { type: "git_status_update", data: status });
      });
      send(ws, { type: "git_operation_complete", operation: "start_watching", success: true });
      break;

    case "git_stop_watching":
      gitManager.stopWatching();
      send(ws, { type: "git_operation_complete", operation: "stop_watching", success: true });
      break;

    case "git_generate_commit_msg":
      await handleGitCommand(ws, "git_generate_commit_msg", async () => {
        await generateCommitMessage(ws);
      });
      break;

    case "git_show":
      await handleGitCommand(ws, "git_show", async () => {
        const data = await gitManager.getCommitDiff(message.hash);
        send(ws, { type: "git_show_response", data });
      });
      break;
  }
}

/** Generate a commit message using Claude based on staged changes */
async function generateCommitMessage(ws: WebSocket): Promise<void> {
  if (!apiKey) {
    send(ws, { type: "git_error", error: "No API key configured", command: "git_generate_commit_msg" });
    return;
  }

  // Collect staged diff and recent commit messages for style reference
  const [stagedDiff, recentLog] = await Promise.all([
    gitManager.getDiffStaged(),
    gitManager.getLog(0, 5),
  ]);

  if (!stagedDiff.trim()) {
    send(ws, { type: "git_error", error: "No staged changes to describe", command: "git_generate_commit_msg" });
    return;
  }

  const recentMessages = recentLog.entries
    .map((e) => e.message)
    .join("\n");

  const prompt = `Based on the following staged git diff, generate a concise commit message. Follow the style of the recent commit messages shown below.

Rules:
- First line should be a short summary (max 72 characters)
- Use imperative mood ("Add feature" not "Added feature")
- Be specific about what changed
- If the diff is large, focus on the main purpose of the changes
- Return ONLY the commit message text, nothing else

Recent commit messages for style reference:
${recentMessages || "(no recent commits)"}

Staged diff:
${stagedDiff.slice(0, 8000)}${stagedDiff.length > 8000 ? "\n... (diff truncated)" : ""}`;

  try {
    process.env.ANTHROPIC_API_KEY = apiKey;

    let commitMessage = "";
    for await (const event of query({ prompt, options: { model: "haiku", permissionMode: "bypassPermissions", allowDangerouslySkipPermissions: true } })) {
      if (event.type === "assistant") {
        const content = event.message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === "text") {
              commitMessage += block.text;
            }
          }
        }
      }
    }

    // Clean up: remove quotes, trailing whitespace
    commitMessage = commitMessage.trim().replace(/^["']|["']$/g, "");

    send(ws, { type: "git_commit_msg_response", message: commitMessage });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    send(ws, { type: "git_error", error: `Failed to generate commit message: ${errMsg}`, command: "git_generate_commit_msg" });
  }
}

/** Helper to wrap git commands with error handling */
async function handleGitCommand(ws: WebSocket, command: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[agent] Git error (${command}):`, message);
    send(ws, { type: "git_error", error: message, command });
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

    // Collect git context for system prompt (fire-and-forget safe)
    let gitContext = "";
    if (globalProjectRoot) {
      try {
        const gitStatus = await gitManager.getStatus();
        if (gitStatus.isRepo) {
          const totalChanges = gitStatus.staged.length + gitStatus.unstaged.length + gitStatus.untracked.length;
          const recentLog = await gitManager.getLog(0, 5);
          const recentCommits = recentLog.entries
            .map((e) => `  ${e.hashShort} ${e.message}`)
            .join("\n");

          gitContext = `\n\nGit status:
- Branch: ${gitStatus.branch}${gitStatus.tracking ? ` (tracking ${gitStatus.tracking})` : ""}
- Ahead: ${gitStatus.ahead}, Behind: ${gitStatus.behind}
- Staged: ${gitStatus.staged.length}, Unstaged: ${gitStatus.unstaged.length}, Untracked: ${gitStatus.untracked.length} (${totalChanges} total changes)${gitStatus.staged.length > 0 ? `\n- Staged files: ${gitStatus.staged.map((f) => `${f.status} ${f.path}`).join(", ")}` : ""}${gitStatus.unstaged.length > 0 ? `\n- Modified files: ${gitStatus.unstaged.map((f) => `${f.status} ${f.path}`).join(", ")}` : ""}
- Recent commits:\n${recentCommits || "  (none)"}`;
        }
      } catch {
        // Git context is best-effort — don't fail the query
      }
    }

    // Build a system prompt that clearly scopes the AI to the user's loaded project
    const projectSystemPrompt = globalProjectRoot
      ? `You are an AI coding assistant embedded in an IDE. The user has opened the project located at: ${globalProjectRoot}

When the user says "this app", "the project", "this codebase", or similar, they are referring to THEIR project at that path — not the IDE application itself.

Focus exclusively on the user's project. Use your tools to explore and understand it before answering questions about it.

You also have flow management tools available. When the user asks you to create, modify, delete, list, or describe a flow, workflow, or pipeline, use the flow management tools (mcp__flow-tools__create_flow, mcp__flow-tools__update_flow, mcp__flow-tools__delete_flow, mcp__flow-tools__list_flows, mcp__flow-tools__get_flow). Flows are visual agent graphs with nodes and edges.${gitContext}`
      : undefined;

    const options: Options = {
      model: "sonnet",
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      // Enable all SDK tools for direct chat when a project is open
      tools: { type: "preset" as const, preset: "claude_code" as const },
      // Flow management tools via MCP server
      mcpServers: { "flow-tools": flowToolsServer },
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
        } as unknown as SDKUserMessage;
      }
      prompt = messageGenerator();
    } else {
      prompt = effectiveContent;
    }

    // Track tool calls, turns, and emit debug info
    const tracker = createQueryTracker();
    tracker.systemPrompt = projectSystemPrompt ?? "";
    tracker.effectivePrompt = typeof prompt === "string" ? prompt : effectiveContent;
    tracker.chatSessionId = sessionId;

    // Reset token counter client in case API key changed
    resetTokenCounterClient();

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
  /** System prompt text for context view token breakdown */
  systemPrompt?: string;
  /** Effective prompt sent (with history prepend) */
  effectivePrompt?: string;
  /** Frontend session ID for context view events */
  chatSessionId?: string;
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
      const streamEvent = event.event as unknown as Record<string, unknown>;
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
        const msgContent = (event.message as unknown as Record<string, unknown>)?.content;
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

      const resultInputTokens = event.usage?.input_tokens ?? 0;
      const resultOutputTokens = event.usage?.output_tokens ?? 0;
      const resultCost = event.total_cost_usd ?? 0;

      // Send assistant_text_done for both success and error results
      send(ws, {
        type: "assistant_text_done",
        messageId,
        model: "sonnet",
        tokensIn: resultInputTokens,
        tokensOut: resultOutputTokens,
        costUsd: resultCost,
      });

      // ── Emit context view events for chat mode (async, fire-and-forget) ──
      if (tracker?.chatSessionId) {
        emitChatContextEvents(ws, tracker, resultInputTokens, resultOutputTokens, resultCost, event.usage as Record<string, unknown> | undefined).catch((err) => {
          console.warn("[agent] Context event emission error:", err);
        });
      }

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

/**
 * Async helper to emit context_window_snapshot and token_usage_update
 * events for chat mode. Called fire-and-forget from the sync handleSDKEvent.
 */
async function emitChatContextEvents(
  ws: WebSocket,
  tracker: QueryTracker,
  inputTokens: number,
  outputTokens: number,
  cost: number,
  usage: Record<string, unknown> | undefined,
): Promise<void> {
  const sessionId = tracker.chatSessionId!;
  const nodeId = "chat";
  const nodeLabel = "Chat";
  const model = "sonnet";

  // Update cumulative session stats
  let cumulative = chatSessionStats.get(sessionId);
  if (!cumulative) {
    cumulative = { totalInputTokens: 0, totalOutputTokens: 0, totalCost: 0 };
    chatSessionStats.set(sessionId, cumulative);
  }
  cumulative.totalInputTokens += inputTokens;
  cumulative.totalOutputTokens += outputTokens;
  cumulative.totalCost += cost;

  // Build segments for token breakdown
  const segments: Array<{ key: string; text: string }> = [];
  if (tracker.systemPrompt) segments.push({ key: "systemPrompt", text: tracker.systemPrompt });
  if (tracker.effectivePrompt) segments.push({ key: "userPrompt", text: tracker.effectivePrompt });

  let breakdown: Record<string, number>;
  let estimatedTotal: number;
  try {
    breakdown = await countTokenBreakdown(model, segments);
    estimatedTotal = Object.values(breakdown).reduce((a, b) => a + b, 0);
  } catch {
    // Fallback to char estimates
    breakdown = {};
    for (const seg of segments) breakdown[seg.key] = Math.ceil(seg.text.length / 4);
    estimatedTotal = Object.values(breakdown).reduce((a, b) => a + b, 0);
  }

  // Infer tool definition tokens
  const toolDefTokens = Math.max(0, inputTokens - estimatedTotal);

  const maxTokens = 200_000;
  const percentFull = maxTokens > 0 ? (inputTokens / maxTokens) * 100 : 0;

  // Build sections array
  const sections: Array<{ name: string; tokenCount: number; summary: string; category: string }> = [];
  if (breakdown.systemPrompt) sections.push({ name: "System Prompt", tokenCount: breakdown.systemPrompt, summary: (tracker.systemPrompt ?? "").slice(0, 80), category: "system" });
  if (breakdown.userPrompt) sections.push({ name: "User Prompt", tokenCount: breakdown.userPrompt, summary: (tracker.effectivePrompt ?? "").slice(0, 80), category: "conversation" });
  if (toolDefTokens > 0) sections.push({ name: "Tool Definitions", tokenCount: toolDefTokens, summary: "Inferred from actual usage vs breakdown", category: "tools" });

  const cacheCreation = usage?.cache_creation_input_tokens as number | undefined;
  const cacheRead = usage?.cache_read_input_tokens as number | undefined;

  // Emit context window snapshot
  send(ws, {
    type: "context_window_snapshot",
    sessionId,
    executionId: sessionId,
    nodeId,
    nodeLabel,
    model,
    maxTokens,
    timestamp: Date.now(),
    breakdown: {
      systemPrompt: breakdown.systemPrompt ?? 0,
      briefing: 0,
      toolDefinitions: toolDefTokens,
      conversationHistory: breakdown.userPrompt ?? 0,
      toolResults: 0,
      fileContents: 0,
      other: 0,
    },
    totalInputTokens: inputTokens,
    percentFull,
    sections,
  });

  // Emit token usage update with estimated vs actual delta
  const delta = inputTokens - estimatedTotal;
  send(ws, {
    type: "token_usage_update",
    sessionId,
    executionId: sessionId,
    nodeId,
    timestamp: Date.now(),
    actual: {
      inputTokens,
      outputTokens,
      ...(cacheCreation != null ? { cacheCreationInputTokens: cacheCreation } : {}),
      ...(cacheRead != null ? { cacheReadInputTokens: cacheRead } : {}),
    },
    estimated: estimatedTotal,
    delta,
    cumulativeSession: { ...cumulative },
  });
}
