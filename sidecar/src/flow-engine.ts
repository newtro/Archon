import { WebSocket } from "ws";
import { query, type Options } from "@anthropic-ai/claude-agent-sdk";
import type {
  FlowDefinition,
  FlowState,
  NodeOutput,
  SerializedNode,
  SerializedEdge,
  FlowExecutionEvent,
  ToolPreset,
  HistoryMessage,
} from "./flow-types.js";
import { getGlobalProjectRoot, getOpenRouterApiKey } from "./agent.js";
import { runOpenRouterAgent } from "./openrouter-runner.js";
import { runClaudeCodeAgent, type ClaudeCodeOptions } from "./claude-code-runner.js";
import { loadProjectContext } from "./context-loader.js";
import type { ContextAgent } from "./context-agent.js";
import { countTokenBreakdown, resetTokenCounterClient } from "./token-counter.js";
import { fetchPrData, writePrReview, type AdoPrWriteInput } from "./ado-client.js";

// ── Node Input Schema Registry (JSON Schema) ──────────────────────
// Maps node kinds to their expected input JSON Schema.
// When an LLM node has outgoing edges to a node with an inputSchema,
// the schema is injected into the LLM's system prompt.
const NODE_INPUT_SCHEMAS: Partial<Record<string, Record<string, unknown>>> = {
  "ado-pr-write": {
    type: "object",
    description: "Structured code review output for posting to Azure DevOps",
    properties: {
      pullRequestId: { type: "number", description: "PR number to write to (pass through from PR Read output)" },
      summary: { type: "string", description: "Overall review summary comment" },
      vote: { type: "string", enum: ["approve", "approve-with-suggestions", "wait-for-author", "reject", "no-vote"], description: "Vote decision" },
      inlineComments: {
        type: "array",
        description: "Inline comments on specific code lines",
        items: {
          type: "object",
          properties: {
            filePath: { type: "string", description: "File path relative to repo root" },
            lineStart: { type: "number", description: "Starting line number" },
            lineEnd: { type: "number", description: "Ending line number (optional)" },
            content: { type: "string", description: "Review comment text" },
            severity: { type: "string", enum: ["info", "warning", "critical"], description: "Comment severity" },
          },
          required: ["filePath", "lineStart", "content"],
        },
      },
    },
    required: ["pullRequestId"],
  },
};

/** Resolve a tool preset to the SDK `tools` option */
function resolveToolPreset(preset: ToolPreset | undefined): Options["tools"] {
  switch (preset) {
    case "none":
      return [];
    case "read-only":
      return ["Read", "Glob", "Grep"];
    case "full-access":
      return { type: "preset", preset: "claude_code" };
    default:
      return ["Read", "Glob", "Grep"]; // default to read-only
  }
}

/** Resolve cwd for a node: node config > global project root > process.cwd() */
function resolveNodeCwd(cfg: Record<string, unknown>): string {
  const nodeCwd = cfg.cwd as string | undefined;
  if (nodeCwd) return nodeCwd;
  const globalRoot = getGlobalProjectRoot();
  if (globalRoot) return globalRoot;
  return process.cwd();
}

function send(ws: WebSocket, data: unknown): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function emitEvent(ws: WebSocket, event: FlowExecutionEvent): void {
  send(ws, event);
}

// ── Graph helpers ─────────────────────────────────────────────

function findNode(flow: FlowDefinition, id: string): SerializedNode | undefined {
  return flow.nodes.find((n) => n.id === id);
}

function findStartNode(flow: FlowDefinition): SerializedNode | undefined {
  // webhook-trigger nodes act as alternative entry points
  return flow.nodes.find((n) => n.kind === "start" || n.kind === "webhook-trigger");
}

function getOutgoingEdges(flow: FlowDefinition, nodeId: string, signal?: string): SerializedEdge[] {
  return flow.edges.filter(
    (e) => e.source === nodeId && (!signal || e.signal === signal || e.signal === "default")
  );
}

function getNextNodes(flow: FlowDefinition, nodeId: string, signal: string): SerializedNode[] {
  const allEdges = flow.edges.filter((e) => e.source === nodeId);
  console.log(`[flow-engine] getNextNodes: nodeId=${nodeId}, signal="${signal}", edges=[${allEdges.map((e) => `"${e.signal}"->${e.target}`).join(", ")}]`);
  // First try edges matching the specific signal
  let edges = allEdges.filter((e) => e.signal === signal);
  // Fall back to edges with "default" signal (single-output nodes)
  if (edges.length === 0) {
    edges = allEdges.filter((e) => e.signal === "default");
  }
  console.log(`[flow-engine] -> matched ${edges.length} edge(s): [${edges.map((e) => `${e.signal}->${e.target}`).join(", ")}]`);
  return edges
    .map((e) => findNode(flow, e.target))
    .filter((n): n is SerializedNode => n !== undefined);
}

// ── Schema Injection ──────────────────────────────────────────

/**
 * Build schema injection text for an LLM node by inspecting its downstream nodes.
 * If any downstream node has an inputSchema in NODE_INPUT_SCHEMAS,
 * return instruction text to inject into the LLM's system prompt.
 */
function buildSchemaInjection(flow: FlowDefinition, nodeId: string): string | null {
  // Node kinds that pass data through without changing format requirements.
  // We traverse through these to find schema-bearing nodes further downstream.
  const passthroughKinds = new Set(["human-review", "transformer", "memory", "handoff", "start", "end"]);
  const visited = new Set<string>();
  const schemaTexts: string[] = [];

  function findSchemas(currentNodeId: string): void {
    if (visited.has(currentNodeId)) return;
    visited.add(currentNodeId);

    const outEdges = flow.edges.filter((e) => e.source === currentNodeId);
    for (const edge of outEdges) {
      const targetNode = flow.nodes.find((n) => n.id === edge.target);
      if (!targetNode) continue;

      const schema = NODE_INPUT_SCHEMAS[targetNode.kind];
      if (schema) {
        schemaTexts.push(
          `CRITICAL OUTPUT FORMAT REQUIREMENT:
Your ENTIRE response must be a single valid JSON object conforming to the schema below. This JSON will be consumed by the downstream node "${targetNode.label}" (type: ${targetNode.kind}).

\`\`\`json
${JSON.stringify(schema, null, 2)}
\`\`\`

Rules:
- Output ONLY the raw JSON object — no markdown fences, no explanation, no preamble.
- Do NOT write "I'll investigate" or any other text before or after the JSON.
- Do NOT use tools to explore or investigate — just produce the JSON from the information already provided to you.
- The very first character of your response must be \`{\` and the very last must be \`}\`.`
        );
      } else if (passthroughKinds.has(targetNode.kind)) {
        // Traverse through passthrough nodes to find schema requirements further downstream
        findSchemas(targetNode.id);
      }
    }
  }

  findSchemas(nodeId);
  return schemaTexts.length > 0 ? schemaTexts.join("\n\n") : null;
}

// ── Flow Execution ────────────────────────────────────────────

const activeExecutions = new Map<string, AbortController>();

// ── Cumulative session stats (per execution) ──────────────────
interface CumulativeSessionStats {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
}
const executionStats = new Map<string, CumulativeSessionStats>();

// ── Raw message cache for on-demand context retrieval ────────
const rawMessageCache = new Map<string, unknown[]>();  // key: `${executionId}:${nodeId}`

// ── Human Review pending promises ────────────────────────────
interface ReviewResolution {
  approved: boolean;
  feedback?: string;
  editedContent?: string;
}

const pendingReviews = new Map<string, { resolve: (resolution: ReviewResolution) => void }>();

// ── Subscription auth env (per execution) ───────────────────
// When running in claude-code mode (Max subscription) without an API key,
// we store a clean env (without ANTHROPIC_API_KEY) keyed by executionId.
// Each SDK query() call checks this map and passes the env to force subscription auth.
const subscriptionEnvMap = new Map<string, Record<string, string>>();

function getSubscriptionEnv(executionId: string): Record<string, string> | undefined {
  return subscriptionEnvMap.get(executionId);
}

/**
 * Resolve a pending human review by node ID.
 * Called from agent.ts when the frontend sends a `resolve_review` message.
 */
export function resolveHumanReview(
  nodeId: string,
  approved: boolean,
  feedback?: string,
  editedContent?: string,
): void {
  const pending = pendingReviews.get(nodeId);
  if (pending) {
    pending.resolve({ approved, feedback, editedContent });
    pendingReviews.delete(nodeId);
  } else {
    console.warn(`[flow-engine] No pending review found for node ${nodeId}`);
  }
}

/** Auto-detect content type for display in the human review modal. */
function detectContentType(text: string): "text" | "json" | "markdown" {
  const trimmed = text.trim();
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      JSON.parse(trimmed);
      return "json";
    } catch { /* not valid JSON */ }
  }
  if (/^#{1,6}\s/m.test(trimmed) || /```/.test(trimmed) || /^\*\*/.test(trimmed)) {
    return "markdown";
  }
  return "text";
}

/** Retrieve cached raw messages for a node (on-demand context view). */
export function getRawMessages(executionId: string, nodeId: string): unknown[] | null {
  return rawMessageCache.get(`${executionId}:${nodeId}`) ?? null;
}

export function cancelExecution(executionId: string): void {
  const controller = activeExecutions.get(executionId);
  if (controller) {
    controller.abort();
    activeExecutions.delete(executionId);
  }
}

export async function executeFlow(
  ws: WebSocket,
  flow: FlowDefinition,
  userInput: string,
  apiKey: string | null,
  history?: HistoryMessage[],
  _sessionId?: string,
  contextAgent?: ContextAgent,
  chatProvider?: "sdk" | "claude-code",
): Promise<FlowState> {
  const executionId = crypto.randomUUID();
  const abortController = new AbortController();
  activeExecutions.set(executionId, abortController);
  executionStats.set(executionId, { totalInputTokens: 0, totalOutputTokens: 0, totalCost: 0 });

  // Reset the Anthropic client when API key may have changed
  resetTokenCounterClient();

  // When in claude-code mode without an API key, build a clean env for subscription auth.
  // Each SDK query() call in node executors will pick this up via getSubscriptionEnv().
  if (chatProvider === "claude-code" && !apiKey) {
    const cleanEnv: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (key !== "ANTHROPIC_API_KEY" && key !== "CLAUDECODE" && value !== undefined) {
        cleanEnv[key] = value;
      }
    }
    subscriptionEnvMap.set(executionId, cleanEnv);
  }

  const state: FlowState = {
    task: userInput,
    taskStatus: "in_progress",
    currentNodeId: null,
    nodeOutputs: {},
    decisions: [],
    errors: [],
    turn: 0,
    conversationHistory: history,
    contextAgent,
  };

  emitEvent(ws, { type: "flow_started", executionId, flowId: flow.id });

  try {
    if (apiKey) {
      process.env.ANTHROPIC_API_KEY = apiKey;
    }

    const startNode = findStartNode(flow);
    if (!startNode) {
      throw new Error("Flow has no Start node");
    }

    // Execute from start node
    await executeNode(ws, flow, startNode, state, userInput, executionId, abortController);

    state.taskStatus = "completed";
    const lastOutput = Object.values(state.nodeOutputs).pop();
    emitEvent(ws, {
      type: "flow_completed",
      executionId,
      result: lastOutput?.result ?? "",
      state,
    });
  } catch (err) {
    if (abortController.signal.aborted) {
      emitEvent(ws, { type: "flow_error", executionId, error: "Execution cancelled" });
    } else {
      state.taskStatus = "failed";
      const errMsg = err instanceof Error ? err.message : String(err);
      emitEvent(ws, { type: "flow_error", executionId, error: errMsg });
    }
  } finally {
    activeExecutions.delete(executionId);
    executionStats.delete(executionId);
    subscriptionEnvMap.delete(executionId);
    // Clean up raw message cache entries for this execution
    for (const key of rawMessageCache.keys()) {
      if (key.startsWith(`${executionId}:`)) rawMessageCache.delete(key);
    }
  }

  return state;
}

async function executeNode(
  ws: WebSocket,
  flow: FlowDefinition,
  node: SerializedNode,
  state: FlowState,
  input: string,
  executionId: string,
  abortController: AbortController,
): Promise<void> {
  if (abortController.signal.aborted) return;

  state.currentNodeId = node.id;
  state.turn++;

  const inputPreview = input.length > 200 ? input.slice(0, 200) + "..." : input;
  emitEvent(ws, { type: "node_started", executionId, nodeId: node.id, kind: node.kind, input, inputPreview });

  const startTime = Date.now();
  let output: NodeOutput;

  try {
    const cfg = node.config.config;

    switch (node.kind) {
      case "start":
      case "webhook-trigger":
        output = { nodeId: node.id, kind: node.kind, result: input, signal: "success", durationMs: 0 };
        break;

      case "end":
        output = { nodeId: node.id, kind: node.kind, result: input, signal: "success", durationMs: 0 };
        break;

      case "llm":
        output = await executeLLMNode(ws, flow, node, cfg, input, executionId, abortController, state.projectContext, state.conversationHistory, state.contextAgent as import("./context-agent.js").ContextAgent | undefined);
        break;

      case "project-context":
        output = await executeProjectContextNode(node, cfg, executionId);
        // Store context output in state for downstream LLM nodes
        state.projectContext = output.result;
        break;

      case "intent":
        output = await executeIntentNode(ws, node, cfg, input, executionId, abortController);
        break;

      case "evaluator":
        output = await executeEvaluatorNode(ws, node, cfg, input, executionId, abortController);
        break;

      case "tool":
        output = await executeToolNode(ws, node, cfg, input, executionId, abortController);
        break;

      case "transformer":
        output = executeTransformerNode(node, cfg, input);
        break;

      case "router":
        output = await executeRouterNode(ws, node, cfg, input, state, executionId, abortController);
        break;

      case "parallel":
        output = await executeParallelNode(ws, flow, node, cfg, input, state, executionId, abortController);
        break;

      case "human-review":
        output = await executeHumanReviewNode(ws, node, cfg, input, executionId);
        break;

      case "memory":
        output = executeMemoryNode(node, cfg, input, state);
        break;

      case "handoff":
        output = await executeHandoffNode(ws, node, cfg, input, state, executionId, abortController);
        break;

      case "sub-flow":
        output = await executeSubFlowNode(ws, node, cfg, input, state, executionId, abortController);
        break;

      case "ado-pr-read":
        output = await executeAdoPrReadNode(ws, node, cfg, input, executionId);
        break;

      case "ado-pr-write":
        output = await executeAdoPrWriteNode(ws, node, cfg, input, executionId);
        break;

      case "webhook-response":
        output = executeWebhookResponseNode(node, cfg, input);
        break;

      default:
        output = { nodeId: node.id, kind: node.kind, result: input, signal: "success", durationMs: 0 };
    }

    output.durationMs = Date.now() - startTime;
    state.nodeOutputs[node.id] = output;

    emitEvent(ws, { type: "node_completed", executionId, nodeId: node.id, output });

    // Follow edges to next nodes
    if (node.kind !== "end") {
      const nextNodes = getNextNodes(flow, node.id, output.signal);
      for (const next of nextNodes) {
        // Find the edge connecting source → target for the edge_traversed event
        const traversedEdge = flow.edges.find(
          (e) => e.source === node.id && e.target === next.id &&
            (e.signal === output.signal || e.signal === "default")
        );
        if (traversedEdge) {
          // Build a short preview (first 120 chars) and the full data payload
          const dataPreview = output.result.length > 120
            ? output.result.slice(0, 120) + "..."
            : output.result;
          emitEvent(ws, {
            type: "edge_traversed",
            executionId,
            edgeId: traversedEdge.id,
            sourceNodeId: node.id,
            targetNodeId: next.id,
            signal: output.signal,
            dataPreview,
            dataFull: output.result,
            sourceKind: node.kind,
            sourceLabel: node.label,
            targetKind: next.kind,
            targetLabel: next.label,
            timestamp: Date.now(),
          });
        }
        await executeNode(ws, flow, next, state, output.result, executionId, abortController);
      }
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    state.errors.push({ nodeId: node.id, error: errMsg, turn: state.turn });
    emitEvent(ws, { type: "node_error", executionId, nodeId: node.id, error: errMsg });
    throw err;
  }
}

// ── Node Executors ────────────────────────────────────────────

async function executeLLMNode(
  ws: WebSocket,
  flow: FlowDefinition,
  node: SerializedNode,
  cfg: Record<string, unknown>,
  input: string,
  executionId: string,
  abortController: AbortController,
  contextOutput?: string,
  history?: HistoryMessage[],
  contextAgent?: import("./context-agent.js").ContextAgent,
): Promise<NodeOutput> {
  let model = (cfg.model as string) ?? "sonnet";
  const systemPrompt = (cfg.systemPrompt as string) ?? "";
  const toolPreset = cfg.toolPreset as ToolPreset | undefined;
  const extraTools = (cfg.tools as string[]) ?? [];

  // Schema injection: check if downstream nodes expect a specific input format
  const schemaInjection = buildSchemaInjection(flow, node.id);

  // Build system prompt: node's own + project context + project root info + schema injection
  const projectRoot = resolveNodeCwd(cfg);
  const jsonOutputMode = !!schemaInjection; // When true, strip tools and force JSON-only output
  const systemParts = [
    systemPrompt,
    contextOutput,
    // Skip the "use your tools" instruction when in JSON output mode — the LLM has no tools
    jsonOutputMode ? undefined : `You are an AI coding assistant embedded in an IDE. The user's project is located at: ${projectRoot}

When the user says "this app", "the project", "this codebase", or similar, they are referring to THEIR project at that path — not the IDE application itself.

Use your tools (Read, Glob, Grep, etc.) to explore and understand this project. Do NOT rely on prior knowledge about other projects.`,
    schemaInjection,
  ].filter(Boolean);
  const fullSystemPrompt = systemParts.join("\n\n---\n\n");

  // Resolve tools from preset + any extra tools.
  // When in JSON output mode (downstream node requires structured input),
  // strip all tools so the LLM produces only a JSON response.
  const resolvedTools = jsonOutputMode ? [] : resolveToolPreset(toolPreset);

  // Context Agent: classify intent and generate briefing
  // NOTE: handleDirectly is NOT used in flow context — it sends assistant_text
  // events that would create a duplicate message alongside the flow's node_streaming.
  let prompt = input;
  if (contextAgent) {
    try {
      const classification = await contextAgent.classifyIntent(input, ws, abortController);

      // Override model based on Context Agent routing
      model = classification.routeToModel;

      // Generate a curated briefing instead of raw history
      const briefing = await contextAgent.generateBriefing(input, classification, ws, abortController);
      prompt = briefing.context;
    } catch (err) {
      console.warn("[flow-engine] Context Agent error, falling back to raw history:", err);
      // Fall through to raw history prepend below
      if (history && history.length > 0) {
        const turns = history.map((m) => {
          const role = m.role === "user" ? "User" : "Assistant";
          return `${role}: ${m.content}`;
        }).join("\n\n");
        prompt = `<conversation_history>\n${turns}\n</conversation_history>\n\n${input}`;
      }
    }
  } else if (history && history.length > 0) {
    // Fallback: raw history prepend when no Context Agent
    const turns = history.map((m) => {
      const role = m.role === "user" ? "User" : "Assistant";
      return `${role}: ${m.content}`;
    }).join("\n\n");
    prompt = `<conversation_history>\n${turns}\n</conversation_history>\n\n${input}`;
  }

  // ── Provider branch: OpenRouter models get their own execution path ──
  const provider = (cfg.provider as string) ?? "claude";
  if (provider === "openrouter") {
    return await executeOpenRouterLLMNode(
      ws, node, cfg, prompt, fullSystemPrompt,
      jsonOutputMode ? "none" : toolPreset, // Strip tools in JSON output mode
      executionId, abortController, contextAgent,
    );
  }

  // ── Provider branch: Claude Code CLI (subscription-based, no API key needed) ──
  if (provider === "claude-code") {
    const ccStartTime = Date.now();
    try {
      return await executeClaudeCodeLLMNode(
        ws, node, cfg, prompt, fullSystemPrompt,
        jsonOutputMode ? "none" : toolPreset,
        executionId, abortController, contextAgent,
      );
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const isNotInstalled = errMsg.includes("Failed to spawn") || errMsg.includes("ENOENT");
      const userMessage = isNotInstalled
        ? "Claude Code CLI is not installed. Install: curl -fsSL https://claude.ai/install.sh | bash && claude login"
        : `Claude Code CLI error: ${errMsg}`;
      console.error(`[flow-engine:claude-code] Node ${node.id} failed:`, errMsg);
      return {
        nodeId: node.id,
        kind: "llm",
        result: "",
        signal: "error",
        data: { error: userMessage, provider: "claude-code" },
        durationMs: Date.now() - ccStartTime,
      };
    }
  }

  // ── Claude Agent SDK path ───────────────────────────────────────
  const hasProjectRoot = !!getGlobalProjectRoot();
  const subEnv = getSubscriptionEnv(executionId);
  const options: Options = {
    model: model as "haiku" | "sonnet" | "opus",
    cwd: resolveNodeCwd(cfg),
    tools: resolvedTools,
    // Also auto-allow any extra MCP/custom tools specified on the node (disabled in JSON output mode)
    allowedTools: jsonOutputMode ? [] : (extraTools.length > 0 ? extraTools : []),
    systemPrompt: fullSystemPrompt || undefined,
    // Only load project settings when a real project root is set (avoids picking up IDE settings)
    ...(hasProjectRoot ? { settingSources: ["project" as const] } : {}),
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    includePartialMessages: true,
    abortController,
    // Subscription auth: pass clean env without ANTHROPIC_API_KEY to force Max subscription
    ...(subEnv ? { env: subEnv } : {}),
  };

  let result = "";
  let totalCost = 0;

  // Track tool calls for the frontend
  const emittedToolIds = new Set<string>();
  const toolStartTimes = new Map<string, number>();
  const blockIndexToToolId = new Map<number, string>();
  const toolInputJsonAccum = new Map<string, string>();
  let lastToolDoneTime: number | undefined;
  const eventTypeCounts = new Map<string, number>();

  for await (const event of query({ prompt, options })) {
    eventTypeCounts.set(event.type, (eventTypeCounts.get(event.type) ?? 0) + 1);

    if (event.type === "stream_event") {
      const streamEvent = event.event as unknown as Record<string, unknown>;
      const streamType = streamEvent.type as string;

      // Detect tool_use blocks from content_block_start (earliest detection point)
      if (streamType === "content_block_start") {
        const blockIndex = streamEvent.index as number | undefined;
        const contentBlock = streamEvent.content_block as Record<string, unknown> | undefined;
        if (contentBlock?.type === "tool_use" && contentBlock.id && contentBlock.name) {
          const toolId = contentBlock.id as string;
          // Track block index → tool ID mapping for input_json_delta correlation
          if (blockIndex != null) {
            blockIndexToToolId.set(blockIndex, toolId);
            toolInputJsonAccum.set(toolId, "");
          }
          if (!emittedToolIds.has(toolId)) {
            const startedAt = Date.now();
            emittedToolIds.add(toolId);
            toolStartTimes.set(toolId, startedAt);
            emitEvent(ws, {
              type: "node_tool_call",
              executionId,
              nodeId: node.id,
              toolCall: {
                id: toolId,
                name: contentBlock.name as string,
                args: (contentBlock.input as Record<string, unknown>) ?? {},
                status: "loading" as const,
                startedAt,
              },
            });
            console.log(`[flow-engine] TOOL_START: ${contentBlock.name} (${toolId})`);
          }
        }
      }

      // Accumulate input_json_delta for tool arguments
      if (streamType === "content_block_delta" && streamEvent.delta) {
        const delta = streamEvent.delta as Record<string, unknown>;
        if (delta.type === "input_json_delta" && typeof delta.partial_json === "string") {
          const blockIndex = streamEvent.index as number | undefined;
          if (blockIndex != null) {
            const toolId = blockIndexToToolId.get(blockIndex);
            if (toolId) {
              const prev = toolInputJsonAccum.get(toolId) ?? "";
              toolInputJsonAccum.set(toolId, prev + delta.partial_json);
            }
          }
        }
      }

      // On content_block_stop, parse accumulated JSON and send args update
      if (streamType === "content_block_stop") {
        const blockIndex = streamEvent.index as number | undefined;
        if (blockIndex != null) {
          const toolId = blockIndexToToolId.get(blockIndex);
          if (toolId) {
            const jsonStr = toolInputJsonAccum.get(toolId);
            if (jsonStr) {
              try {
                const fullArgs = JSON.parse(jsonStr) as Record<string, unknown>;
                emitEvent(ws, {
                  type: "node_tool_args_update",
                  executionId,
                  nodeId: node.id,
                  toolCallId: toolId,
                  args: fullArgs,
                });
                console.log(`[flow-engine] TOOL_ARGS updated: ${toolId}`);
              } catch {
                // JSON parse failed — args will come from assistant event
              }
            }
            toolInputJsonAccum.delete(toolId);
            blockIndexToToolId.delete(blockIndex);
          }
        }
      }

      // Stream text deltas to the frontend
      if (
        streamType === "content_block_delta" &&
        streamEvent.delta &&
        (streamEvent.delta as Record<string, unknown>).type === "text_delta"
      ) {
        const text = (streamEvent.delta as Record<string, unknown>).text as string;
        result += text;
        emitEvent(ws, {
          type: "node_streaming",
          executionId,
          nodeId: node.id,
          delta: text,
        });
      }

      // Keep the execution cursor fresh on every stream event so that when the
      // first user (tool-result) event arrives, lastToolDoneTime is as close
      // to tool-execution-start as possible.
      lastToolDoneTime = Date.now();
    } else if (event.type === "assistant") {
      // Set the execution cursor to now — the first tool starts executing here.
      lastToolDoneTime = Date.now();

      // Extract tool_use blocks — emit start if not already emitted,
      // or send args update if already emitted from stream
      if (event.message?.content) {
        for (const block of event.message.content) {
          if (block.type === "tool_use") {
            if (!emittedToolIds.has(block.id)) {
              // Not yet emitted — send full node_tool_call
              const startedAt = Date.now();
              emittedToolIds.add(block.id);
              toolStartTimes.set(block.id, startedAt);
              emitEvent(ws, {
                type: "node_tool_call",
                executionId,
                nodeId: node.id,
                toolCall: {
                  id: block.id,
                  name: block.name,
                  args: block.input as Record<string, unknown>,
                  status: "loading" as const,
                  startedAt,
                },
              });
              console.log(`[flow-engine] TOOL_START (fallback): ${block.name} (${block.id})`);
            } else {
              // Already emitted — send args update as fallback
              const fullArgs = block.input as Record<string, unknown>;
              if (fullArgs && Object.keys(fullArgs).length > 0) {
                emitEvent(ws, {
                  type: "node_tool_args_update",
                  executionId,
                  nodeId: node.id,
                  toolCallId: block.id,
                  args: fullArgs,
                });
              }
            }
          }
        }
      }
    } else if (event.type === "user") {
      // Tool result — the SDK executed a tool and this is the result.
      // Extract tool results from message content blocks (each has its own tool_use_id).
      // We do NOT gate on event.parent_tool_use_id because it may be null/missing in some SDK versions.
      const e = event as unknown as Record<string, unknown>;
      const msgContent = (event.message as unknown as Record<string, unknown>)?.content;
      let handledToolResult = false;

      if (Array.isArray(msgContent)) {
        for (const block of msgContent) {
          const b = block as Record<string, unknown>;
          if (b.type === "tool_result") {
            // Use tool_use_id from the block itself, fall back to event-level parent_tool_use_id
            const toolUseId = (b.tool_use_id as string) ?? (e.parent_tool_use_id as string);
            if (!toolUseId) {
              console.warn(`[flow-engine] tool_result block without tool_use_id, skipping:`, JSON.stringify(b).slice(0, 200));
              continue;
            }

            const isError = !!b.is_error;
            let resultText = "";
            const c = b.content;
            if (typeof c === "string") {
              resultText = c;
            } else if (Array.isArray(c)) {
              resultText = c
                .filter((x: Record<string, unknown>) => x.type === "text")
                .map((x: Record<string, unknown>) => x.text as string)
                .join("\n");
            } else if (c != null) {
              resultText = JSON.stringify(c, null, 2);
            }

            // Per-tool timing using execution cursor
            const now = Date.now();
            const cursorTime = lastToolDoneTime;
            const fallbackTime = toolStartTimes.get(toolUseId);
            const startRef = cursorTime ?? fallbackTime;
            const durationMs = startRef ? now - startRef : 0;
            lastToolDoneTime = now;
            toolStartTimes.delete(toolUseId);

            emitEvent(ws, {
              type: "node_tool_result",
              executionId,
              nodeId: node.id,
              toolCallId: toolUseId,
              result: resultText,
              status: isError ? ("error" as const) : ("success" as const),
              durationMs,
            });
            console.log(`[flow-engine] TOOL_DONE: ${toolUseId} ${isError ? "ERROR" : "OK"} (${durationMs}ms)`);
            handledToolResult = true;
          }
        }
      }

      // Fallback: use event-level parent_tool_use_id + tool_use_result if no content blocks matched
      if (!handledToolResult && e.parent_tool_use_id) {
        const parentId = e.parent_tool_use_id as string;
        let resultText = "";
        const raw = e.tool_use_result;
        if (typeof raw === "string") resultText = raw;
        else if (raw != null) resultText = JSON.stringify(raw, null, 2);
        if (!resultText && typeof msgContent === "string") resultText = msgContent;

        const now = Date.now();
        const startRef = lastToolDoneTime ?? toolStartTimes.get(parentId);
        const durationMs = startRef ? now - startRef : 0;
        lastToolDoneTime = now;
        toolStartTimes.delete(parentId);

        emitEvent(ws, {
          type: "node_tool_result",
          executionId,
          nodeId: node.id,
          toolCallId: parentId,
          result: resultText,
          status: "success" as const,
          durationMs,
        });
        console.log(`[flow-engine] TOOL_DONE (fallback): ${parentId} OK (${durationMs}ms)`);
      }

      if (!handledToolResult && !e.parent_tool_use_id) {
        console.log(`[flow-engine] USER event with no tool results: keys=${Object.keys(e).join(",")}, parent_tool_use_id=${e.parent_tool_use_id}, content_type=${Array.isArray(msgContent) ? "array" : typeof msgContent}`);
      }
    } else if (event.type === "result") {
      totalCost = event.total_cost_usd ?? 0;
      const usage = event.usage as { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number } | undefined;
      const inputTokens = usage?.input_tokens ?? 0;
      const outputTokens = usage?.output_tokens ?? 0;
      const cacheCreation = usage?.cache_creation_input_tokens;
      const cacheRead = usage?.cache_read_input_tokens;

      // Update cumulative session stats
      const cumulative = executionStats.get(executionId);
      if (cumulative) {
        cumulative.totalInputTokens += inputTokens;
        cumulative.totalOutputTokens += outputTokens;
        cumulative.totalCost += totalCost;
      }

      // Get accurate token breakdown via countTokens API
      const segments: Array<{ key: string; text: string }> = [];
      if (fullSystemPrompt) segments.push({ key: "systemPrompt", text: fullSystemPrompt });
      if (contextAgent && prompt) segments.push({ key: "briefing", text: prompt });
      if (!contextAgent && history?.length) {
        const histText = history.map((m) => `${m.role}: ${m.content}`).join("\n");
        segments.push({ key: "conversationHistory", text: histText });
      }
      if (contextOutput) segments.push({ key: "fileContents", text: contextOutput });
      if (!contextAgent && prompt !== input) segments.push({ key: "other", text: prompt });

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

      // Compute the unaccounted tokens (tool defs, tool results, etc.)
      const toolDefTokens = Math.max(0, inputTokens - estimatedTotal);

      const maxTokens = 200_000; // All current Claude models
      const percentFull = maxTokens > 0 ? (inputTokens / maxTokens) * 100 : 0;

      // Build sections array
      const sections: Array<{ name: string; tokenCount: number; summary: string; category: "system" | "briefing" | "tools" | "conversation" | "files" | "other" }> = [];
      if (breakdown.systemPrompt) sections.push({ name: "System Prompt", tokenCount: breakdown.systemPrompt, summary: systemPrompt?.slice(0, 80) || "Default system prompt", category: "system" });
      if (breakdown.briefing) sections.push({ name: "Briefing", tokenCount: breakdown.briefing, summary: prompt.slice(0, 80), category: "briefing" });
      if (toolDefTokens > 0) sections.push({ name: "Tool Definitions", tokenCount: toolDefTokens, summary: `Inferred from actual usage vs breakdown`, category: "tools" });
      if (breakdown.conversationHistory) sections.push({ name: "Conversation History", tokenCount: breakdown.conversationHistory, summary: `${history?.length ?? 0} messages`, category: "conversation" });
      if (breakdown.fileContents) sections.push({ name: "Project Context", tokenCount: breakdown.fileContents, summary: `${contextOutput?.length ?? 0} chars of project context`, category: "files" });
      if (breakdown.other) sections.push({ name: "Other", tokenCount: breakdown.other, summary: "Additional prompt content", category: "other" });

      // Cache raw messages for on-demand retrieval
      const rawMessages: unknown[] = [
        { role: "system", content: fullSystemPrompt },
        { role: "user", content: prompt },
      ];
      rawMessageCache.set(`${executionId}:${node.id}`, rawMessages);

      // Emit context window snapshot
      send(ws, {
        type: "context_window_snapshot",
        sessionId: executionId,
        executionId,
        nodeId: node.id,
        nodeLabel: node.label,
        model,
        maxTokens,
        timestamp: Date.now(),
        breakdown: {
          systemPrompt: breakdown.systemPrompt ?? 0,
          briefing: breakdown.briefing ?? 0,
          toolDefinitions: toolDefTokens,
          conversationHistory: breakdown.conversationHistory ?? 0,
          toolResults: 0,
          fileContents: breakdown.fileContents ?? 0,
          other: breakdown.other ?? 0,
        },
        totalInputTokens: inputTokens,
        percentFull,
        sections,
      });

      // Emit token usage update with estimated vs actual delta
      const delta = inputTokens - estimatedTotal;
      send(ws, {
        type: "token_usage_update",
        sessionId: executionId,
        executionId,
        nodeId: node.id,
        timestamp: Date.now(),
        actual: {
          inputTokens,
          outputTokens,
          ...(cacheCreation != null ? { cacheCreationInputTokens: cacheCreation } : {}),
          ...(cacheRead != null ? { cacheReadInputTokens: cacheRead } : {}),
        },
        estimated: estimatedTotal,
        delta,
        cumulativeSession: cumulative
          ? { ...cumulative }
          : { totalInputTokens: inputTokens, totalOutputTokens: outputTokens, totalCost: totalCost },
      });
    }
  }

  // Log event type summary for debugging
  const eventSummary = Array.from(eventTypeCounts.entries()).map(([k, v]) => `${k}=${v}`).join(", ");
  console.log(`[flow-engine] SDK event summary for node ${node.id}: ${eventSummary} | tools emitted: ${emittedToolIds.size}`);

  // Context Agent: ingest result to update structured state
  if (contextAgent) {
    try {
      await contextAgent.ingestResult(result, [], model, ws, abortController);
    } catch (err) {
      console.warn("[flow-engine] Context Agent ingestion error:", err);
    }
  }

  return {
    nodeId: node.id,
    kind: "llm",
    result,
    signal: "success",
    data: { model, costUsd: totalCost },
    durationMs: 0,
  };
}

// ── OpenRouter LLM Node Execution ────────────────────────────────

async function executeOpenRouterLLMNode(
  ws: WebSocket,
  node: SerializedNode,
  cfg: Record<string, unknown>,
  prompt: string,
  systemPrompt: string,
  toolPreset: ToolPreset | undefined,
  executionId: string,
  abortController: AbortController,
  contextAgent?: import("./context-agent.js").ContextAgent,
): Promise<NodeOutput> {
  const openrouterKey = getOpenRouterApiKey();
  if (!openrouterKey) {
    throw new Error("OpenRouter API key not configured. Set it in Settings.");
  }

  const orModel = cfg.openrouterModel as string;
  if (!orModel) {
    throw new Error(
      "No OpenRouter model selected. Configure the model in the LLM node.",
    );
  }

  let result = "";
  const startTime = Date.now();

  const { result: finalResult, totalCost } = await runOpenRouterAgent(
    prompt,
    {
      apiKey: openrouterKey,
      model: orModel,
      systemPrompt,
      toolPreset: toolPreset ?? "read-only",
      temperature: (cfg.temperature as number) ?? 0.7,
      maxTokens: (cfg.maxTokens as number) ?? 4096,
      cwd: resolveNodeCwd(cfg),
      abortSignal: abortController.signal,
    },
    {
      onTextDelta: (text) => {
        result += text;
        emitEvent(ws, {
          type: "node_streaming",
          executionId,
          nodeId: node.id,
          delta: text,
        });
      },
      onToolCallStart: (id, name, args) => {
        emitEvent(ws, {
          type: "node_tool_call",
          executionId,
          nodeId: node.id,
          toolCall: {
            id,
            name,
            args,
            status: "loading" as const,
            startedAt: Date.now(),
          },
        });
        console.log(`[flow-engine:openrouter] TOOL_START: ${name} (${id})`);
      },
      onToolCallDone: (id, toolResult, isError, durationMs) => {
        emitEvent(ws, {
          type: "node_tool_result",
          executionId,
          nodeId: node.id,
          toolCallId: id,
          result: toolResult,
          status: isError ? ("error" as const) : ("success" as const),
          durationMs,
        });
        console.log(
          `[flow-engine:openrouter] TOOL_DONE: ${id} ${isError ? "ERROR" : "OK"} (${durationMs}ms)`,
        );
      },
    },
  );

  result = finalResult;
  const durationMs = Date.now() - startTime;

  // Update cumulative execution stats
  const cumulative = executionStats.get(executionId);
  if (cumulative) {
    cumulative.totalCost += totalCost;
  }

  // Context Agent: ingest result (model-agnostic)
  if (contextAgent) {
    try {
      await contextAgent.ingestResult(
        result,
        [],
        orModel,
        ws,
        abortController,
      );
    } catch (err) {
      console.warn("[flow-engine:openrouter] Context Agent ingestion error:", err);
    }
  }

  return {
    nodeId: node.id,
    kind: "llm",
    result,
    signal: "success",
    data: { model: orModel, provider: "openrouter", costUsd: totalCost },
    durationMs,
  };
}

/**
 * Execute an LLM node using the Claude Code CLI (subscription-based).
 * No API key required — uses the user's Anthropic Max subscription via CLI auth.
 */
async function executeClaudeCodeLLMNode(
  ws: WebSocket,
  node: SerializedNode,
  cfg: Record<string, unknown>,
  prompt: string,
  systemPrompt: string,
  toolPreset: ToolPreset | undefined,
  executionId: string,
  abortController: AbortController,
  contextAgent?: import("./context-agent.js").ContextAgent,
): Promise<NodeOutput> {
  let result = "";
  const startTime = Date.now();

  // Map tool preset to Claude Code permission mode
  let permissionMode: ClaudeCodeOptions["permissionMode"] = "bypassPermissions";
  if (toolPreset === "none" || toolPreset === "read-only") {
    permissionMode = "default";
  }

  const ccModel = (cfg.claudeCodeModel as string) ?? (cfg.model as string) ?? "sonnet";

  // Track tool calls for Context Agent
  const toolCallLog: Array<{ name: string; args: Record<string, unknown>; result?: string }> = [];

  const { result: finalResult, totalCost, inputTokens, outputTokens } = await runClaudeCodeAgent(
    prompt,
    {
      model: ccModel,
      appendSystemPrompt: systemPrompt,
      cwd: resolveNodeCwd(cfg),
      abortSignal: abortController.signal,
      maxTurns: (cfg.maxTurns as number) ?? 50,
      permissionMode,
      timeoutMs: (cfg.timeoutMs as number) ?? 10 * 60 * 1000,
    },
    {
      onTextDelta: (text) => {
        result += text;
        emitEvent(ws, {
          type: "node_streaming",
          executionId,
          nodeId: node.id,
          delta: text,
        });
      },
      onToolCallStart: (id, name, args) => {
        toolCallLog.push({ name, args });
        emitEvent(ws, {
          type: "node_tool_call",
          executionId,
          nodeId: node.id,
          toolCall: {
            id,
            name,
            args,
            status: "loading" as const,
            startedAt: Date.now(),
          },
        });
        console.log(`[flow-engine:claude-code] TOOL_START: ${name} (${id})`);
      },
      onToolCallDone: (id, toolResult, isError, durationMs) => {
        // Update the last matching tool call entry with its result
        const entry = toolCallLog.findLast((t) => !t.result);
        if (entry) entry.result = toolResult;
        emitEvent(ws, {
          type: "node_tool_result",
          executionId,
          nodeId: node.id,
          toolCallId: id,
          result: toolResult,
          status: isError ? ("error" as const) : ("success" as const),
          durationMs,
        });
        console.log(
          `[flow-engine:claude-code] TOOL_DONE: ${id} ${isError ? "ERROR" : "OK"} (${durationMs}ms)`,
        );
      },
    },
  );

  result = finalResult;
  const durationMs = Date.now() - startTime;

  // Update cumulative execution stats
  const cumulative = executionStats.get(executionId);
  if (cumulative) {
    cumulative.totalCost += totalCost;
    cumulative.totalInputTokens += inputTokens;
    cumulative.totalOutputTokens += outputTokens;
  }

  // Context Agent: ingest result with tool history
  if (contextAgent) {
    try {
      await contextAgent.ingestResult(
        result,
        toolCallLog,
        ccModel,
        ws,
        abortController,
      );
    } catch (err) {
      console.warn("[flow-engine:claude-code] Context Agent ingestion error:", err);
    }
  }

  return {
    nodeId: node.id,
    kind: "llm",
    result,
    signal: "success",
    data: { model: ccModel, provider: "claude-code", costUsd: totalCost },
    durationMs,
  };
}

async function executeIntentNode(
  _ws: WebSocket,
  node: SerializedNode,
  cfg: Record<string, unknown>,
  input: string,
  executionId: string,
  abortController: AbortController,
): Promise<NodeOutput> {
  // Support both old string[] and new { name, instructions }[] formats
  const rawClassifications = cfg.classifications as Array<string | { name: string; instructions?: string }> | undefined;
  const classifications = (rawClassifications ?? [
    { name: "feature", instructions: "" },
    { name: "bug", instructions: "" },
    { name: "question", instructions: "" },
  ]).map((c) => typeof c === "string" ? { name: c, instructions: "" } : c);

  const classificationNames = classifications.map((c) => c.name);
  const classificationDetails = classifications
    .filter((c) => c.instructions)
    .map((c) => `- ${c.name}: ${c.instructions}`)
    .join("\n");

  const prompt = `Classify the following user message into exactly one of these categories: ${classificationNames.join(", ")}.
${classificationDetails ? `\nCategory descriptions:\n${classificationDetails}\n` : ""}
User message: "${input}"

Respond with ONLY the category name, nothing else.`;

  const subEnvIntent = getSubscriptionEnv(executionId);
  const options: Options = {
    model: "haiku",
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    allowedTools: [],
    abortController,
    ...(subEnvIntent ? { env: subEnvIntent } : {}),
  };

  let result = "";
  for await (const event of query({ prompt, options })) {
    if (event.type === "assistant") {
      for (const block of event.message?.content ?? []) {
        if ("text" in block) result += block.text;
      }
    }
  }

  const classified = result.trim().toLowerCase();
  const matched = classificationNames.find((name) => classified.includes(name.toLowerCase())) ?? classificationNames[0];

  return {
    nodeId: node.id,
    kind: "intent",
    result: input,
    signal: matched,
    data: { classification: matched, rawResponse: classified },
    durationMs: 0,
  };
}

async function executeEvaluatorNode(
  _ws: WebSocket,
  node: SerializedNode,
  cfg: Record<string, unknown>,
  input: string,
  executionId: string,
  abortController: AbortController,
): Promise<NodeOutput> {
  const criteria = (cfg.criteria as string) ?? "Evaluate quality.";
  const passThreshold = (cfg.passThreshold as number) ?? 70;

  const prompt = `${criteria}

Content to evaluate:
${input}

Respond with a JSON object containing:
- "score": a number from 0-100
- "reasoning": a brief explanation
- "passed": true if score >= ${passThreshold}

Respond ONLY with the JSON.`;

  const subEnvEval = getSubscriptionEnv(executionId);
  const options: Options = {
    model: "haiku",
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    allowedTools: [],
    abortController,
    ...(subEnvEval ? { env: subEnvEval } : {}),
  };

  let result = "";
  for await (const event of query({ prompt, options })) {
    if (event.type === "assistant") {
      for (const block of event.message?.content ?? []) {
        if ("text" in block) result += block.text;
      }
    }
  }

  let score = 0;
  let passed = false;
  try {
    const parsed = JSON.parse(result.trim());
    score = parsed.score ?? 0;
    passed = score >= passThreshold;
  } catch {
    passed = true; // default to pass if parsing fails
    score = passThreshold;
  }

  return {
    nodeId: node.id,
    kind: "evaluator",
    result: input, // pass through the input
    signal: passed ? "success" : "fail",
    data: { score, passed },
    durationMs: 0,
  };
}

async function executeToolNode(
  _ws: WebSocket,
  node: SerializedNode,
  cfg: Record<string, unknown>,
  input: string,
  executionId: string,
  abortController: AbortController,
): Promise<NodeOutput> {
  const toolName = (cfg.toolName as string) ?? "";

  if (!toolName) {
    return {
      nodeId: node.id,
      kind: "tool",
      result: input,
      signal: "success",
      durationMs: 0,
    };
  }

  // Use the Claude Agent SDK with a targeted prompt to invoke the tool
  const prompt = `Execute the following tool: ${toolName}

Context from the previous step:
${input}

Run the tool and return the result.`;

  const subEnvTool = getSubscriptionEnv(executionId);
  const options: Options = {
    model: "haiku",
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    allowedTools: [toolName],
    abortController,
    ...(subEnvTool ? { env: subEnvTool } : {}),
  };

  let result = "";
  for await (const event of query({ prompt, options })) {
    if (event.type === "assistant") {
      for (const block of event.message?.content ?? []) {
        if ("text" in block) result += block.text;
      }
    }
  }

  return {
    nodeId: node.id,
    kind: "tool",
    result: result || input,
    signal: "success",
    durationMs: 0,
  };
}

function executeTransformerNode(
  node: SerializedNode,
  cfg: Record<string, unknown>,
  input: string,
): NodeOutput {
  const template = (cfg.template as string) ?? "{{input}}";
  const result = template.replace(/\{\{input\}\}/g, input);

  return {
    nodeId: node.id,
    kind: "transformer",
    result,
    signal: "success",
    durationMs: 0,
  };
}

async function executeRouterNode(
  _ws: WebSocket,
  node: SerializedNode,
  cfg: Record<string, unknown>,
  input: string,
  state: FlowState,
  executionId: string,
  abortController: AbortController,
): Promise<NodeOutput> {
  const mode = (cfg.mode as string) ?? "rules";
  const rules = (cfg.rules as Array<{ condition: string; output: string }>) ?? [];

  if (mode === "rules" && rules.length > 0) {
    // Simple rule matching
    const inputLower = input.toLowerCase();
    for (const rule of rules) {
      if (inputLower.includes(rule.condition.toLowerCase())) {
        state.decisions.push(`Router: matched rule "${rule.condition}" -> ${rule.output}`);
        return {
          nodeId: node.id,
          kind: "router",
          result: input,
          signal: rule.output,
          data: { matchedRule: rule.condition },
          durationMs: 0,
        };
      }
    }
    // Default to first rule if no match
    const defaultRoute = rules[0]?.output ?? "default";
    return {
      nodeId: node.id,
      kind: "router",
      result: input,
      signal: defaultRoute,
      durationMs: 0,
    };
  }

  // LLM-based routing
  const llmOutputs = (cfg.llmOutputs as string[]) ?? [];
  const llmPrompt = (cfg.llmPrompt as string) ?? "";
  const routeOptions = llmOutputs.length > 0 ? llmOutputs : rules.map((r) => r.output);
  if (routeOptions.length === 0) {
    return { nodeId: node.id, kind: "router", result: input, signal: "default", durationMs: 0 };
  }

  const prompt = `${llmPrompt ? llmPrompt + "\n\n" : ""}Based on the following input, choose the best route from: ${routeOptions.join(", ")}.

Input: "${input}"

Respond with ONLY the route name, nothing else.`;

  const subEnvRouter = getSubscriptionEnv(executionId);
  const options: Options = {
    model: "haiku",
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    allowedTools: [],
    abortController,
    ...(subEnvRouter ? { env: subEnvRouter } : {}),
  };

  let result = "";
  for await (const event of query({ prompt, options })) {
    if (event.type === "assistant") {
      for (const block of event.message?.content ?? []) {
        if ("text" in block) result += block.text;
      }
    }
  }

  const classified = result.trim().toLowerCase();
  const matched = routeOptions.find((o) => classified.includes(o.toLowerCase())) ?? routeOptions[0];
  state.decisions.push(`Router (LLM): chose "${matched}"`);

  return {
    nodeId: node.id,
    kind: "router",
    result: input,
    signal: matched,
    durationMs: 0,
  };
}

async function executeParallelNode(
  ws: WebSocket,
  flow: FlowDefinition,
  node: SerializedNode,
  cfg: Record<string, unknown>,
  input: string,
  state: FlowState,
  executionId: string,
  abortController: AbortController,
): Promise<NodeOutput> {
  const mergeStrategy = (cfg.mergeStrategy as string) ?? "all";
  const outEdges = getOutgoingEdges(flow, node.id);
  const targetNodes = outEdges
    .map((e) => findNode(flow, e.target))
    .filter((n): n is SerializedNode => n !== undefined);

  if (targetNodes.length === 0) {
    return { nodeId: node.id, kind: "parallel", result: input, signal: "success", durationMs: 0 };
  }

  // Execute all branches concurrently
  const branchPromises = targetNodes.map(async (target) => {
    const branchState: FlowState = { ...state, nodeOutputs: { ...state.nodeOutputs } };
    await executeNode(ws, flow, target, branchState, input, executionId, abortController);
    return branchState.nodeOutputs[target.id];
  });

  const results = await Promise.allSettled(branchPromises);
  const outputs = results
    .filter((r): r is PromiseFulfilledResult<NodeOutput> => r.status === "fulfilled" && !!r.value)
    .map((r) => r.value);

  let merged: string;
  switch (mergeStrategy) {
    case "first":
      merged = outputs[0]?.result ?? input;
      break;
    case "majority":
    case "all":
    default:
      merged = outputs.map((o) => o.result).join("\n\n---\n\n");
      break;
  }

  return {
    nodeId: node.id,
    kind: "parallel",
    result: merged,
    signal: "success",
    data: { branchCount: outputs.length },
    durationMs: 0,
  };
}

async function executeHumanReviewNode(
  ws: WebSocket,
  node: SerializedNode,
  cfg: Record<string, unknown>,
  input: string,
  executionId: string,
): Promise<NodeOutput> {
  const prompt = (cfg.prompt as string) ?? "Please review and approve.";
  const contentType = detectContentType(input);

  emitEvent(ws, {
    type: "human_review_requested",
    executionId,
    nodeId: node.id,
    nodeLabel: node.label,
    prompt,
    content: input,
    contentType,
  });

  // Pause execution until the frontend sends a resolve_review message
  const resolution = await new Promise<ReviewResolution>((resolve) => {
    pendingReviews.set(node.id, { resolve });
  });

  // Use edited content if provided, otherwise pass through original input
  const resultContent = resolution.editedContent ?? input;

  return {
    nodeId: node.id,
    kind: "human-review",
    result: resultContent,
    signal: resolution.approved ? "success" : "fail",
    data: {
      approved: resolution.approved,
      ...(resolution.feedback ? { feedback: resolution.feedback } : {}),
      ...(resolution.editedContent ? { edited: true } : {}),
    },
    durationMs: 0,
  };
}

function executeMemoryNode(
  node: SerializedNode,
  cfg: Record<string, unknown>,
  input: string,
  state: FlowState,
): NodeOutput {
  const operation = (cfg.operation as string) ?? "read";
  const key = (cfg.key as string) ?? "";

  if (operation === "write" || operation === "read-write") {
    // Store the input in state
    (state as unknown as Record<string, unknown>)[key] = input;
  }

  let result = input;
  if (operation === "read" || operation === "read-write") {
    result = String((state as unknown as Record<string, unknown>)[key] ?? input);
  }

  return {
    nodeId: node.id,
    kind: "memory",
    result,
    signal: "success",
    durationMs: 0,
  };
}

async function executeHandoffNode(
  _ws: WebSocket,
  node: SerializedNode,
  cfg: Record<string, unknown>,
  input: string,
  state: FlowState,
  executionId: string,
  abortController: AbortController,
): Promise<NodeOutput> {
  const briefingPrompt = (cfg.briefingPrompt as string) ?? "Summarize the current state.";
  const includeFields = (cfg.includeFields as string[]) ?? ["task", "decisions"];

  // Build context from state
  const stateContext = includeFields
    .map((field) => {
      const value = (state as unknown as Record<string, unknown>)[field];
      if (value !== undefined) {
        return `${field}: ${JSON.stringify(value)}`;
      }
      return null;
    })
    .filter(Boolean)
    .join("\n");

  const prompt = `${briefingPrompt}

Current state:
${stateContext}

Recent output:
${input}

Generate a focused briefing for the next agent.`;

  const subEnvHandoff = getSubscriptionEnv(executionId);
  const options: Options = {
    model: "haiku",
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    allowedTools: [],
    abortController,
    ...(subEnvHandoff ? { env: subEnvHandoff } : {}),
  };

  let result = "";
  for await (const event of query({ prompt, options })) {
    if (event.type === "assistant") {
      for (const block of event.message?.content ?? []) {
        if ("text" in block) result += block.text;
      }
    }
  }

  return {
    nodeId: node.id,
    kind: "handoff",
    result: result || input,
    signal: "success",
    durationMs: 0,
  };
}

async function executeProjectContextNode(
  node: SerializedNode,
  cfg: Record<string, unknown>,
  _executionId: string,
): Promise<NodeOutput> {
  const files = (cfg.files as string[]) ?? [];
  const includePatterns = (cfg.includePatterns as string[]) ?? [];
  const excludePatterns = (cfg.excludePatterns as string[]) ?? [];
  const respectGitignore = (cfg.respectGitignore as boolean) ?? true;
  const maxTokens = (cfg.maxTokens as number) ?? 50000;
  const outputFormat = (cfg.outputFormat as string) ?? "tree-and-contents";

  const projectRoot = getGlobalProjectRoot() || process.cwd();

  const result = await loadProjectContext({
    projectRoot,
    files,
    includePatterns,
    excludePatterns,
    respectGitignore,
    maxTokens,
    outputFormat,
  });

  return {
    nodeId: node.id,
    kind: "project-context",
    result,
    signal: "success",
    durationMs: 0,
  };
}

// ── Sub-flow execution ───────────────────────────────────────

/**
 * Execute a sub-flow inline. If `cfg.embeddedFlow` contains a FlowDefinition,
 * run it by finding its start node and executing nodes recursively.
 * Otherwise emit an error since we cannot load flows from DB in the sidecar.
 */
async function executeSubFlowNode(
  ws: WebSocket,
  node: SerializedNode,
  cfg: Record<string, unknown>,
  input: string,
  _state: FlowState,
  executionId: string,
  abortController: AbortController,
): Promise<NodeOutput> {
  const embeddedFlow = cfg.embeddedFlow as FlowDefinition | undefined;

  if (!embeddedFlow) {
    const flowId = (cfg.flowId as string) ?? "(none)";
    const errMsg = `Sub-flow node "${node.label}" references flowId="${flowId}" but no embedded flow definition was provided. Loading flows from the database is not supported in the sidecar.`;
    emitEvent(ws, { type: "node_error", executionId, nodeId: node.id, error: errMsg });
    return {
      nodeId: node.id,
      kind: "sub-flow",
      result: input,
      signal: "fail",
      data: { error: errMsg },
      durationMs: 0,
    };
  }

  // Execute the embedded sub-flow inline
  const subState: FlowState = {
    task: input,
    taskStatus: "in_progress",
    currentNodeId: null,
    nodeOutputs: {},
    decisions: [],
    errors: [],
    turn: 0,
  };

  const startNode = findStartNode(embeddedFlow);
  if (!startNode) {
    const errMsg = `Embedded sub-flow "${embeddedFlow.name}" has no Start node`;
    emitEvent(ws, { type: "node_error", executionId, nodeId: node.id, error: errMsg });
    return {
      nodeId: node.id,
      kind: "sub-flow",
      result: input,
      signal: "fail",
      data: { error: errMsg },
      durationMs: 0,
    };
  }

  // Run the sub-flow nodes using the same executeNode infrastructure
  await executeNode(ws, embeddedFlow, startNode, subState, input, executionId, abortController);

  // Gather the last output from the sub-flow execution
  const outputValues = Object.values(subState.nodeOutputs);
  const lastOutput = outputValues[outputValues.length - 1];

  return {
    nodeId: node.id,
    kind: "sub-flow",
    result: lastOutput?.result ?? input,
    signal: "success",
    data: {
      subFlowId: embeddedFlow.id,
      subFlowName: embeddedFlow.name,
      nodesExecuted: outputValues.length,
    },
    durationMs: 0,
  };
}

// ── ADO PR Read Node ─────────────────────────────────────────

async function executeAdoPrReadNode(
  ws: WebSocket,
  node: SerializedNode,
  cfg: Record<string, unknown>,
  input: string,
  executionId: string,
): Promise<NodeOutput> {
  const projectName = (cfg.projectName as string) ?? "";
  const repositoryName = (cfg.repositoryName as string) || projectName;
  const trackIterations = (cfg.trackIterations as boolean) ?? false;
  const lastReviewedIteration = (cfg.lastReviewedIteration as number) ?? undefined;

  if (!projectName) {
    return {
      nodeId: node.id,
      kind: "ado-pr-read",
      result: JSON.stringify({ error: "Project name must be configured" }),
      signal: "error",
      durationMs: 0,
    };
  }

  // Extract PR number from upstream input
  const prNumber = extractPrNumber(input);
  if (!prNumber) {
    return {
      nodeId: node.id,
      kind: "ado-pr-read",
      result: JSON.stringify({ error: `Could not extract PR number from input: "${input.slice(0, 200)}"` }),
      signal: "error",
      durationMs: 0,
    };
  }

  emitEvent(ws, { type: "node_streaming", executionId, nodeId: node.id, delta: `Fetching PR #${prNumber} from ${projectName}/${repositoryName}...` });

  try {
    const { data, signal } = await fetchPrData(
      projectName,
      repositoryName,
      prNumber,
      trackIterations ? lastReviewedIteration : undefined,
    );

    // Update lastReviewedIteration if tracking is enabled
    if (trackIterations && data.iterations.length > 0) {
      const latestIteration = Math.max(...data.iterations.map((i) => i.id));
      // Note: This updates the in-memory config. The frontend should persist this
      // via the config update mechanism when the flow is saved.
      (cfg as Record<string, unknown>).lastReviewedIteration = latestIteration;
    }

    const resultJson = JSON.stringify(data, null, 2);

    return {
      nodeId: node.id,
      kind: "ado-pr-read",
      result: resultJson,
      signal,
      data: { prNumber, projectName, repositoryName },
      durationMs: 0,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return {
      nodeId: node.id,
      kind: "ado-pr-read",
      result: JSON.stringify({ error: errMsg }),
      signal: "error",
      durationMs: 0,
    };
  }
}

// ── ADO PR Write Node ────────────────────────────────────────

async function executeAdoPrWriteNode(
  ws: WebSocket,
  node: SerializedNode,
  cfg: Record<string, unknown>,
  input: string,
  executionId: string,
): Promise<NodeOutput> {
  const projectName = (cfg.projectName as string) ?? "";
  const repositoryName = (cfg.repositoryName as string) || projectName;
  const requireHumanApproval = (cfg.requireHumanApproval as boolean) ?? true;
  const postSummaryComment = (cfg.postSummaryComment as boolean) ?? true;
  const postInlineComments = (cfg.postInlineComments as boolean) ?? true;
  const setVote = (cfg.setVote as boolean) ?? true;
  const defaultVote = (cfg.defaultVote as string) ?? "approve-with-suggestions";
  const threadStatus = (cfg.threadStatus as string) ?? "active";

  if (!projectName) {
    return {
      nodeId: node.id,
      kind: "ado-pr-write",
      result: JSON.stringify({ error: "Project name must be configured" }),
      signal: "error",
      durationMs: 0,
    };
  }

  // Parse the structured review input from the upstream LLM node.
  // The input may be raw JSON, or JSON embedded in surrounding text/markdown.
  let writeInput: AdoPrWriteInput;
  try {
    writeInput = extractJsonFromInput<AdoPrWriteInput>(input);
    if (!writeInput.pullRequestId) {
      throw new Error("Missing pullRequestId in parsed JSON");
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return {
      nodeId: node.id,
      kind: "ado-pr-write",
      result: JSON.stringify({ error: `Failed to parse review input: ${errMsg}. Expected JSON with pullRequestId, summary, vote, and inlineComments fields.` }),
      signal: "error",
      durationMs: 0,
    };
  }

  // Human approval gate
  if (requireHumanApproval) {
    const previewText = buildWritePreview(writeInput);
    emitEvent(ws, {
      type: "human_review_requested",
      executionId,
      nodeId: node.id,
      nodeLabel: node.label,
      prompt: `Review the following before posting to Azure DevOps PR #${writeInput.pullRequestId}:`,
      content: previewText,
      contentType: "text",
    });

    const resolution = await new Promise<ReviewResolution>((resolve) => {
      pendingReviews.set(node.id, { resolve });
    });

    if (!resolution.approved) {
      return {
        nodeId: node.id,
        kind: "ado-pr-write",
        result: JSON.stringify({
          status: "blocked",
          reason: resolution.feedback || "Human reviewer rejected the proposed comments",
        }),
        signal: "blocked",
        durationMs: 0,
      };
    }

    // If the reviewer edited the content, attempt to re-parse as JSON
    if (resolution.editedContent) {
      try {
        const edited = JSON.parse(resolution.editedContent);
        Object.assign(writeInput, edited);
      } catch {
        console.warn("[flow-engine] Could not parse edited review content as JSON, using original");
      }
    }
  }

  emitEvent(ws, { type: "node_streaming", executionId, nodeId: node.id, delta: `Posting review to PR #${writeInput.pullRequestId}...` });

  try {
    const { result, signal } = await writePrReview(
      projectName,
      repositoryName,
      writeInput,
      { postSummaryComment, postInlineComments, setVote, defaultVote, threadStatus },
    );

    return {
      nodeId: node.id,
      kind: "ado-pr-write",
      result: JSON.stringify(result, null, 2),
      signal,
      data: { prNumber: writeInput.pullRequestId, threadsCreated: result.threadsCreated, voteSet: result.voteSet },
      durationMs: 0,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return {
      nodeId: node.id,
      kind: "ado-pr-write",
      result: JSON.stringify({ error: errMsg }),
      signal: "error",
      durationMs: 0,
    };
  }
}

// ── Helpers for ADO nodes ────────────────────────────────────

/**
 * Extract a JSON object from input that may contain surrounding text.
 * Tries: raw JSON parse → JSON inside markdown fences → first `{...}` block.
 */
function extractJsonFromInput<T>(input: string): T {
  const trimmed = input.trim();

  // 1. Try direct parse
  try {
    return JSON.parse(trimmed) as T;
  } catch { /* continue */ }

  // 2. Try extracting from markdown code fences: ```json ... ``` or ``` ... ```
  const fenceMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim()) as T;
    } catch { /* continue */ }
  }

  // 3. Try finding the outermost { ... } block using brace matching
  const firstBrace = trimmed.indexOf("{");
  if (firstBrace >= 0) {
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = firstBrace; i < trimmed.length; i++) {
      const ch = trimmed[i];
      if (escape) { escape = false; continue; }
      if (ch === "\\") { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          const candidate = trimmed.slice(firstBrace, i + 1);
          try {
            return JSON.parse(candidate) as T;
          } catch { /* continue searching */ }
        }
      }
    }
  }

  throw new Error(`Input does not contain valid JSON. Received: ${trimmed.slice(0, 120)}...`);
}

/** Extract a PR number from user input. Supports bare numbers, "#123", "PR 123", or ADO URLs. */
function extractPrNumber(input: string): number | null {
  // Try parsing as a bare JSON object with pullRequestId
  try {
    const parsed = JSON.parse(input);
    if (parsed?.pullRequest?.id) return parsed.pullRequest.id;
    if (parsed?.pullRequestId) return parsed.pullRequestId;
  } catch {
    // Not JSON, continue with text parsing
  }

  // Match patterns like "PR #123", "#123", "PR 123", "pull/123", or just a number
  const patterns = [
    /(?:PR|pull\s*request)\s*#?\s*(\d+)/i,
    /pullRequests\/(\d+)/i,
    /#(\d+)/,
    /\b(\d+)\b/,
  ];
  for (const pattern of patterns) {
    const match = input.match(pattern);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > 0) return num;
    }
  }
  return null;
}

/** Build a human-readable preview of what will be posted to Azure DevOps. */
function buildWritePreview(input: AdoPrWriteInput): string {
  const parts: string[] = [];

  if (input.vote) {
    parts.push(`Vote: ${input.vote}`);
  }

  if (input.summary) {
    parts.push(`\nSummary Comment:\n${input.summary}`);
  }

  if (input.inlineComments?.length) {
    parts.push(`\nInline Comments (${input.inlineComments.length}):`);
    for (const c of input.inlineComments) {
      const severity = c.severity ? `[${c.severity.toUpperCase()}] ` : "";
      parts.push(`  ${c.filePath}:${c.lineStart}${c.lineEnd ? `-${c.lineEnd}` : ""} — ${severity}${c.content}`);
    }
  }

  return parts.join("\n") || "(No review actions)";
}

// ── Webhook Response Node ────────────────────────────────────────────────────

function executeWebhookResponseNode(
  node: SerializedNode,
  cfg: Record<string, unknown>,
  input: string,
): NodeOutput {
  const statusCode = (cfg.statusCode as number) ?? 200;
  const contentType = (cfg.contentType as string) ?? "application/json";
  const responseTemplate = (cfg.responseTemplate as string) ?? "{{input}}";

  // Render template — replace {{input}} with upstream output
  const responseBody = responseTemplate.replace(/\{\{input\}\}/g, input);

  return {
    nodeId: node.id,
    kind: "webhook-response",
    result: responseBody,
    signal: "success",
    data: { statusCode, contentType, headers: { "Content-Type": contentType } },
    durationMs: 0,
  };
}
