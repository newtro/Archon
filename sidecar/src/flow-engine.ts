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
import { getGlobalProjectRoot } from "./agent.js";
import { loadProjectContext } from "./context-loader.js";
import type { ContextAgent } from "./context-agent.js";

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
  return flow.nodes.find((n) => n.kind === "start");
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

// ── Flow Execution ────────────────────────────────────────────

const activeExecutions = new Map<string, AbortController>();

// ── Human Review pending promises ────────────────────────────
const pendingReviews = new Map<string, { resolve: (approved: boolean) => void }>();

/**
 * Resolve a pending human review by node ID.
 * Called from agent.ts when the frontend sends a `resolve_review` message.
 */
export function resolveHumanReview(nodeId: string, approved: boolean): void {
  const pending = pendingReviews.get(nodeId);
  if (pending) {
    pending.resolve(approved);
    pendingReviews.delete(nodeId);
  } else {
    console.warn(`[flow-engine] No pending review found for node ${nodeId}`);
  }
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
  apiKey: string,
  history?: HistoryMessage[],
  _sessionId?: string,
  contextAgent?: ContextAgent,
): Promise<void> {
  const executionId = crypto.randomUUID();
  const abortController = new AbortController();
  activeExecutions.set(executionId, abortController);

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
    process.env.ANTHROPIC_API_KEY = apiKey;

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
  }
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

  emitEvent(ws, { type: "node_started", executionId, nodeId: node.id, kind: node.kind });

  const startTime = Date.now();
  let output: NodeOutput;

  try {
    const cfg = node.config.config;

    switch (node.kind) {
      case "start":
        output = { nodeId: node.id, kind: node.kind, result: input, signal: "success", durationMs: 0 };
        break;

      case "end":
        output = { nodeId: node.id, kind: node.kind, result: input, signal: "success", durationMs: 0 };
        break;

      case "llm":
        output = await executeLLMNode(ws, node, cfg, input, executionId, abortController, state.projectContext, state.conversationHistory, state.contextAgent as import("./context-agent.js").ContextAgent | undefined);
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

  // Build system prompt: node's own + project context + project root info
  const projectRoot = resolveNodeCwd(cfg);
  const systemParts = [
    systemPrompt,
    contextOutput,
    `You are working in the project directory: ${projectRoot}\nUse your tools (Read, Glob, Grep, etc.) to explore and understand this project. Do NOT rely on prior knowledge about other projects.`,
  ].filter(Boolean);
  const fullSystemPrompt = systemParts.join("\n\n---\n\n");

  // Resolve tools from preset + any extra tools
  const resolvedTools = resolveToolPreset(toolPreset);

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

  const options: Options = {
    model: model as "haiku" | "sonnet" | "opus",
    cwd: resolveNodeCwd(cfg),
    tools: resolvedTools,
    // Also auto-allow any extra MCP/custom tools specified on the node
    allowedTools: extraTools.length > 0 ? extraTools : [],
    systemPrompt: fullSystemPrompt || undefined,
    settingSources: ["project"],
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    includePartialMessages: true,
    abortController,
  };

  let result = "";
  let totalCost = 0;

  // Track tool calls for the frontend
  const emittedToolIds = new Set<string>();
  const toolStartTimes = new Map<string, number>();

  for await (const event of query({ prompt, options })) {
    if (event.type === "stream_event") {
      const streamEvent = event.event as Record<string, unknown>;
      const streamType = streamEvent.type as string;

      // Detect tool_use blocks from content_block_start (earliest detection point)
      if (streamType === "content_block_start") {
        const contentBlock = streamEvent.content_block as Record<string, unknown> | undefined;
        if (contentBlock?.type === "tool_use" && contentBlock.id && contentBlock.name) {
          const toolId = contentBlock.id as string;
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
    } else if (event.type === "assistant") {
      // Fallback: extract tool_use blocks not caught from stream_event
      if (event.message?.content) {
        for (const block of event.message.content) {
          if (block.type === "tool_use" && !emittedToolIds.has(block.id)) {
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
          }
        }
      }
    } else if (event.type === "user") {
      // Tool result — the SDK executed a tool and this is the result
      if (event.parent_tool_use_id) {
        let resultText = "";
        let isError = false;

        const e = event as Record<string, unknown>;
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
        if (!resultText) {
          const raw = e.tool_use_result;
          if (typeof raw === "string") resultText = raw;
          else if (raw != null) resultText = JSON.stringify(raw, null, 2);
        }
        if (!resultText && typeof msgContent === "string") {
          resultText = msgContent;
        }

        const startTime = toolStartTimes.get(event.parent_tool_use_id);
        const durationMs = startTime ? Date.now() - startTime : 0;
        toolStartTimes.delete(event.parent_tool_use_id);

        emitEvent(ws, {
          type: "node_tool_result",
          executionId,
          nodeId: node.id,
          toolCallId: event.parent_tool_use_id,
          result: resultText,
          status: isError ? ("error" as const) : ("success" as const),
          durationMs,
        });
        console.log(`[flow-engine] TOOL_DONE: ${event.parent_tool_use_id} ${isError ? "ERROR" : "OK"} (${durationMs}ms)`);
      }
    } else if (event.type === "result") {
      totalCost = event.total_cost_usd ?? 0;
    }
  }

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

async function executeIntentNode(
  _ws: WebSocket,
  node: SerializedNode,
  cfg: Record<string, unknown>,
  input: string,
  _executionId: string,
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

  const options: Options = {
    model: "haiku",
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    allowedTools: [],
    abortController,
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
  _executionId: string,
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

  const options: Options = {
    model: "haiku",
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    allowedTools: [],
    abortController,
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
  _executionId: string,
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

  const options: Options = {
    model: "haiku",
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    allowedTools: [toolName],
    abortController,
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
  _executionId: string,
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

  const options: Options = {
    model: "haiku",
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    allowedTools: [],
    abortController,
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

  emitEvent(ws, {
    type: "human_review_requested",
    executionId,
    nodeId: node.id,
    prompt: `${prompt}\n\nContent for review:\n${input}`,
  });

  // Pause execution until the frontend sends a resolve_review message
  const approved = await new Promise<boolean>((resolve) => {
    pendingReviews.set(node.id, { resolve });
  });

  return {
    nodeId: node.id,
    kind: "human-review",
    result: input,
    signal: approved ? "success" : "fail",
    data: { approved },
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
  _executionId: string,
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

  const options: Options = {
    model: "haiku",
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    allowedTools: [],
    abortController,
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
