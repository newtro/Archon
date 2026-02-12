/**
 * Flow management tools for the Claude Agent SDK.
 * Exposes create/read/update/delete operations as MCP tools
 * that Claude can invoke from chat.
 */
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { WebSocket } from "ws";

// ── Relay infrastructure ─────────────────────────────────────────

/** Mutable WebSocket reference — updated on each message */
let currentWs: WebSocket | null = null;

/** Pending request map for WebSocket request/response correlation */
const pendingRequests = new Map<
  string,
  { resolve: (data: FlowToolResponseData) => void; reject: (err: Error) => void }
>();

export interface FlowToolResponseData {
  success: boolean;
  data?: unknown;
  error?: string;
}

/** Set the active WebSocket for flow tool relay */
export function setFlowToolsWs(ws: WebSocket): void {
  currentWs = ws;
}

/** Handle a flow_tool_response message from the frontend */
export function handleFlowToolResponse(requestId: string, response: FlowToolResponseData): void {
  const pending = pendingRequests.get(requestId);
  if (pending) {
    pendingRequests.delete(requestId);
    pending.resolve(response);
  }
}

/** Send a message to the frontend and wait for a response */
async function relayToFrontend(message: Record<string, unknown>, timeoutMs = 30_000): Promise<FlowToolResponseData> {
  if (!currentWs || currentWs.readyState !== 1 /* OPEN */) {
    return { success: false, error: "No active WebSocket connection to frontend" };
  }

  const requestId = `ftool-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const fullMessage = { ...message, requestId };

  return new Promise((resolve, reject) => {
    pendingRequests.set(requestId, { resolve, reject });

    const timer = setTimeout(() => {
      pendingRequests.delete(requestId);
      resolve({ success: false, error: "Frontend did not respond within timeout" });
    }, timeoutMs);

    // Clear timeout on resolution
    const origResolve = resolve;
    pendingRequests.set(requestId, {
      resolve: (data) => { clearTimeout(timer); origResolve(data); },
      reject: (err) => { clearTimeout(timer); reject(err); },
    });

    currentWs!.send(JSON.stringify(fullMessage));
  });
}

function toolResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

// ── Zod schemas for node configs ─────────────────────────────────

const modelIdSchema = z.enum(["haiku", "sonnet", "opus"])
  .describe("AI model: haiku (fast/cheap), sonnet (balanced), opus (most capable)");

const toolPresetSchema = z.enum(["none", "read-only", "full-access"])
  .describe("Tool access: none (pure text), read-only (Read/Glob/Grep), full-access (all SDK tools including Write/Edit/Bash)");

const edgeSignalSchema = z.string()
  .describe('Edge signal: "success", "fail", "default", or a custom string matching intent/router output names');

const llmConfigSchema = z.object({
  kind: z.literal("llm"),
  config: z.object({
    model: modelIdSchema,
    systemPrompt: z.string().describe("System prompt for this LLM node"),
    temperature: z.number().min(0).max(1).describe("Sampling temperature 0-1"),
    maxTokens: z.number().describe("Max output tokens. Common values: 512, 1024, 2048, 4096, 8192, 16384"),
    tools: z.array(z.string()).describe("Additional tool names (beyond preset)").default([]),
    enableThinking: z.boolean().describe("Enable extended thinking").default(true),
    toolPreset: toolPresetSchema,
    extendedContext: z.boolean().optional().describe("Enable 1M context (Sonnet/Opus only)"),
    cwd: z.string().optional().describe("Working directory override"),
  }),
}).describe("LLM node: invoke an AI model with tools and system prompt");

const intentConfigSchema = z.object({
  kind: z.literal("intent"),
  config: z.object({
    classifications: z.array(z.object({
      name: z.string().describe("Classification name (becomes an output signal)"),
      instructions: z.string().describe("Instructions for when to classify as this intent"),
    })).describe("List of intent categories. Each name becomes an output handle/signal."),
  }),
}).describe("Intent node: classify user input into categories. Each classification name becomes an output edge signal.");

const evaluatorConfigSchema = z.object({
  kind: z.literal("evaluator"),
  config: z.object({
    criteria: z.string().describe("Evaluation criteria prompt"),
    passThreshold: z.number().min(0).max(100).describe("Score threshold 0-100 to pass"),
    model: modelIdSchema.optional().describe("Model for evaluation (defaults to sonnet)"),
  }),
}).describe("Evaluator node: score output against criteria. Outputs 'success' if score >= threshold, 'fail' otherwise.");

const toolNodeConfigSchema = z.object({
  kind: z.literal("tool"),
  config: z.object({
    toolName: z.string().describe("Tool to execute (e.g., 'run_tests', 'lint', 'deploy')"),
    args: z.record(z.string(), z.unknown()).describe("Tool arguments as key-value pairs"),
  }),
}).describe("Tool node: execute a deterministic tool (tests, lint, deploy, etc.)");

const transformerConfigSchema = z.object({
  kind: z.literal("transformer"),
  config: z.object({
    template: z.string().describe("Template with {{input}} placeholders for variable substitution"),
    inputMapping: z.record(z.string(), z.string()).describe("Map of placeholder names to source values").default({}),
  }),
}).describe("Transformer node: transform data using string templates without an LLM call");

const routerConfigSchema = z.object({
  kind: z.literal("router"),
  config: z.object({
    mode: z.enum(["rules", "llm"]).describe("Routing mode: rules (keyword matching) or llm (AI classification)"),
    rules: z.array(z.object({
      condition: z.string().describe("Keyword or pattern to match"),
      output: z.string().describe("Output signal name when matched"),
    })).describe("Rules for rules mode"),
    llmPrompt: z.string().optional().describe("Routing instructions for LLM mode"),
    llmOutputs: z.array(z.string()).optional().describe("Named output routes for LLM mode"),
  }),
}).describe("Router node: route execution to different paths based on rules or LLM classification. Each output becomes an edge signal.");

const parallelConfigSchema = z.object({
  kind: z.literal("parallel"),
  config: z.object({
    branches: z.number().describe("Number of parallel branches"),
    mergeStrategy: z.enum(["all", "first", "majority"]).describe("How to merge results: all (wait for all), first (first to complete), majority"),
  }),
}).describe("Parallel node: fork into concurrent branches. Connect outgoing edges to different target nodes.");

const joinConfigSchema = z.object({
  kind: z.literal("join"),
  config: z.object({
    mode: z.enum(["all", "first", "count"]).describe("Wait mode: all inputs, first input, or N inputs"),
    requiredCount: z.number().optional().describe("Number of inputs required (for 'count' mode)"),
    timeout: z.number().describe("Timeout in seconds (0 = no timeout)"),
    combineTemplate: z.string().optional().describe("Template for combining branch results"),
  }),
}).describe("Join node: collect parallel branches and merge results");

const humanReviewConfigSchema = z.object({
  kind: z.literal("human-review"),
  config: z.object({
    prompt: z.string().describe("Review prompt shown to the user"),
    timeout: z.number().describe("Timeout in seconds (0 = no timeout)"),
  }),
}).describe("Human Review node: pause execution for human approval. Outputs 'success' (approved) or 'fail' (rejected).");

const subFlowConfigSchema = z.object({
  kind: z.literal("sub-flow"),
  config: z.object({
    flowId: z.string().describe("ID of the flow to embed"),
  }),
}).describe("Sub-flow node: embed another flow as a nested step");

const memoryConfigSchema = z.object({
  kind: z.literal("memory"),
  config: z.object({
    operation: z.enum(["read", "write", "read-write"]).describe("Memory operation"),
    key: z.string().describe("State key to read/write"),
    valueTemplate: z.string().optional().describe("Template for write value"),
  }),
}).describe("Memory node: read/write structured state by key");

const handoffConfigSchema = z.object({
  kind: z.literal("handoff"),
  config: z.object({
    briefingPrompt: z.string().describe("Prompt for generating the briefing"),
    includeFields: z.array(z.string()).describe('State fields to include (e.g., ["task", "decisions", "files"])'),
  }),
}).describe("Handoff node: generate a curated briefing from state for the next agent");

const projectContextConfigSchema = z.object({
  kind: z.literal("project-context"),
  config: z.object({
    files: z.array(z.string()).describe("Explicit file paths to include"),
    includePatterns: z.array(z.string()).describe('Glob patterns (e.g., ["src/**/*.ts"])'),
    excludePatterns: z.array(z.string()).describe('Exclusion globs (e.g., ["node_modules/**", "dist/**"])'),
    respectGitignore: z.boolean().describe("Whether to respect .gitignore").default(true),
    maxTokens: z.number().describe("Maximum token budget for loaded context").default(50000),
    outputFormat: z.enum(["tree-and-contents", "contents-only", "tree-only"]).describe("Output format").default("tree-and-contents"),
  }),
}).describe("Project Context node: load project files into agent context using glob patterns");

const startConfigSchema = z.object({
  kind: z.literal("start"),
  config: z.object({
    inputSchema: z.string().optional().describe("Optional JSON schema for expected input"),
  }),
}).describe("Start node: flow entry point. Every flow must have exactly one.");

const endConfigSchema = z.object({
  kind: z.literal("end"),
  config: z.object({
    outputTemplate: z.string().optional().describe("Optional template for formatting final output"),
  }),
}).describe("End node: flow exit point. Every flow must have at least one.");

const nodeConfigSchema = z.union([
  llmConfigSchema,
  intentConfigSchema,
  evaluatorConfigSchema,
  toolNodeConfigSchema,
  transformerConfigSchema,
  routerConfigSchema,
  parallelConfigSchema,
  joinConfigSchema,
  humanReviewConfigSchema,
  subFlowConfigSchema,
  memoryConfigSchema,
  handoffConfigSchema,
  projectContextConfigSchema,
  startConfigSchema,
  endConfigSchema,
]).describe("Node configuration — kind determines which config shape to use");

const nodeSchema = z.object({
  id: z.string().describe("Unique node ID (e.g., 'node-1', 'llm-opus', 'start')"),
  kind: z.enum([
    "llm", "intent", "evaluator",
    "tool", "transformer",
    "router", "parallel", "join", "human-review", "sub-flow",
    "memory", "handoff", "project-context",
    "start", "end",
  ]).describe("Node type"),
  label: z.string().describe("Display label for the node"),
  x: z.number().optional().describe("X position on canvas (optional — auto-layout fills if omitted). Use ~250px horizontal spacing."),
  y: z.number().optional().describe("Y position on canvas (optional — auto-layout fills if omitted). Use ~150px vertical spacing."),
  config: nodeConfigSchema,
}).describe("A node in the flow graph");

const edgeSchema = z.object({
  source: z.string().describe("Source node ID"),
  target: z.string().describe("Target node ID"),
  sourceHandle: z.string().nullable().optional().describe("Source handle name (for nodes with multiple outputs like Intent/Router). Use the classification/route name."),
  targetHandle: z.string().nullable().optional().describe("Target handle name (usually null)"),
  signal: edgeSignalSchema,
}).describe("A directed edge connecting two nodes. Signal determines which output port to use.");

// ── Tool definitions ─────────────────────────────────────────────

const createFlowTool = tool(
  "create_flow",
  `Create a new visual flow/workflow/pipeline. A flow is a directed graph of nodes (AI agents, tools, control flow, etc.) connected by edges.

IMPORTANT RULES:
- Every flow MUST have exactly one "start" node and at least one "end" node
- Edges connect nodes via signals. LLM/Tool/Evaluator nodes output "success" or "fail"
- Intent nodes output signals matching their classification names (e.g., "feature", "bug", "question")
- Router nodes output signals matching their rule outputs or llmOutputs names
- Use "default" signal for fallback/unconditional edges
- Node IDs must be unique within the flow
- Provide reasonable x/y positions or omit them for auto-layout`,
  {
    name: z.string().describe("Flow name (e.g., 'PR Review Pipeline', 'Bug Triage Flow')"),
    description: z.string().describe("Brief description of what this flow does").default(""),
    nodes: z.array(nodeSchema).describe("Array of nodes in the flow"),
    edges: z.array(edgeSchema).describe("Array of edges connecting nodes"),
    contextAgentConfig: z.object({
      enabled: z.boolean(),
      model: modelIdSchema.optional(),
      systemPrompt: z.string().optional(),
      extendedContext: z.boolean().optional(),
    }).optional().describe("Optional Context Agent config for multi-turn orchestration"),
  },
  async (args) => {
    console.log(`[flow-tools] create_flow: "${args.name}" with ${args.nodes.length} nodes, ${args.edges.length} edges`);

    // Validate basic structure
    const startNodes = args.nodes.filter(n => n.kind === "start");
    const endNodes = args.nodes.filter(n => n.kind === "end");
    if (startNodes.length !== 1) {
      return toolResult(`Error: Flow must have exactly one "start" node, found ${startNodes.length}`);
    }
    if (endNodes.length < 1) {
      return toolResult(`Error: Flow must have at least one "end" node, found ${endNodes.length}`);
    }

    // Validate node IDs are unique
    const nodeIds = new Set(args.nodes.map(n => n.id));
    if (nodeIds.size !== args.nodes.length) {
      return toolResult("Error: Node IDs must be unique");
    }

    // Validate edge references
    for (const edge of args.edges) {
      if (!nodeIds.has(edge.source)) {
        return toolResult(`Error: Edge references unknown source node "${edge.source}"`);
      }
      if (!nodeIds.has(edge.target)) {
        return toolResult(`Error: Edge references unknown target node "${edge.target}"`);
      }
    }

    const response = await relayToFrontend({
      type: "flow_tool_create",
      flow: {
        name: args.name,
        description: args.description,
        nodes: args.nodes,
        edges: args.edges,
        contextAgentConfig: args.contextAgentConfig,
      },
    });

    if (!response.success) {
      return toolResult(`Error creating flow: ${response.error}`);
    }

    const data = response.data as { flowId: string; name: string; nodeCount: number; edgeCount: number };
    return toolResult(`Flow "${data.name}" created successfully (ID: ${data.flowId}, ${data.nodeCount} nodes, ${data.edgeCount} edges). The flow is now visible in the flow designer.`);
  }
);

const getFlowTool = tool(
  "get_flow",
  "Retrieve a flow by ID or name. Returns the full flow definition including all nodes, edges, and configuration.",
  {
    flowId: z.string().optional().describe("Flow ID (exact match)"),
    name: z.string().optional().describe("Flow name (fuzzy match)"),
  },
  async (args) => {
    if (!args.flowId && !args.name) {
      return toolResult("Error: Provide either flowId or name");
    }

    console.log(`[flow-tools] get_flow: id=${args.flowId ?? "none"}, name=${args.name ?? "none"}`);

    const response = await relayToFrontend({
      type: "flow_tool_get",
      flowId: args.flowId,
      name: args.name,
    });

    if (!response.success) {
      return toolResult(`Error: ${response.error}`);
    }

    return toolResult(JSON.stringify(response.data, null, 2));
  }
);

const listFlowsTool = tool(
  "list_flows",
  "List all available flows with their IDs, names, descriptions, and node/edge counts.",
  {},
  async () => {
    console.log("[flow-tools] list_flows");

    const response = await relayToFrontend({
      type: "flow_tool_list",
    });

    if (!response.success) {
      return toolResult(`Error: ${response.error}`);
    }

    const flows = response.data as Array<{ id: string; name: string; description: string; nodeCount: number; edgeCount: number; updatedAt: number }>;
    if (flows.length === 0) {
      return toolResult("No flows found.");
    }

    const lines = flows.map(f =>
      `- "${f.name}" (ID: ${f.id}) — ${f.description || "No description"} | ${f.nodeCount} nodes, ${f.edgeCount} edges`
    );
    return toolResult(`Found ${flows.length} flow(s):\n${lines.join("\n")}`);
  }
);

const updateFlowTool = tool(
  "update_flow",
  `Update an existing flow using patch operations. You can add/remove/modify nodes and edges.

PATCH RULES:
- removeNodeIds: Removes nodes AND all their connected edges automatically
- removeEdgeIds: Removes specific edges by ID
- addNodes: Adds new nodes (IDs must not conflict with existing)
- updateNodes: Modifies existing nodes by ID (partial config merge, kind cannot change)
- addEdges: Adds new edges (source/target must exist after removals and additions)
- Operations apply in order: remove → add → update

TIP: Use get_flow first to see current node/edge IDs before modifying.`,
  {
    flowId: z.string().describe("ID of the flow to update"),
    name: z.string().optional().describe("New flow name"),
    description: z.string().optional().describe("New flow description"),
    addNodes: z.array(nodeSchema).optional().describe("Nodes to add"),
    updateNodes: z.array(z.object({
      id: z.string().describe("ID of the node to update"),
      label: z.string().optional().describe("New label"),
      config: nodeConfigSchema.optional().describe("New config (replaces existing)"),
    })).optional().describe("Nodes to modify"),
    removeNodeIds: z.array(z.string()).optional().describe("Node IDs to remove (connected edges are also removed)"),
    addEdges: z.array(edgeSchema).optional().describe("Edges to add"),
    removeEdgeIds: z.array(z.string()).optional().describe("Edge IDs to remove"),
    contextAgentConfig: z.object({
      enabled: z.boolean(),
      model: modelIdSchema.optional(),
      systemPrompt: z.string().optional(),
      extendedContext: z.boolean().optional(),
    }).optional().describe("Updated Context Agent config"),
  },
  async (args) => {
    console.log(`[flow-tools] update_flow: ${args.flowId}`);

    const response = await relayToFrontend({
      type: "flow_tool_update",
      flowId: args.flowId,
      patch: {
        name: args.name,
        description: args.description,
        addNodes: args.addNodes,
        updateNodes: args.updateNodes,
        removeNodeIds: args.removeNodeIds,
        addEdges: args.addEdges,
        removeEdgeIds: args.removeEdgeIds,
        contextAgentConfig: args.contextAgentConfig,
      },
    });

    if (!response.success) {
      return toolResult(`Error updating flow: ${response.error}`);
    }

    const data = response.data as { flowId: string; name: string; nodeCount: number; edgeCount: number };
    return toolResult(`Flow "${data.name}" updated successfully (${data.nodeCount} nodes, ${data.edgeCount} edges).`);
  }
);

const deleteFlowTool = tool(
  "delete_flow",
  "Delete a flow by ID. This action saves a version snapshot first, so it can be undone from the flow designer.",
  {
    flowId: z.string().describe("ID of the flow to delete"),
  },
  async (args) => {
    console.log(`[flow-tools] delete_flow: ${args.flowId}`);

    const response = await relayToFrontend({
      type: "flow_tool_delete",
      flowId: args.flowId,
    });

    if (!response.success) {
      return toolResult(`Error deleting flow: ${response.error}`);
    }

    const data = response.data as { deleted: boolean; name: string };
    return toolResult(`Flow "${data.name}" deleted successfully.`);
  }
);

// ── MCP Server ───────────────────────────────────────────────────

export const flowToolsServer = createSdkMcpServer({
  name: "flow-tools",
  version: "1.0.0",
  tools: [
    createFlowTool,
    getFlowTool,
    listFlowsTool,
    updateFlowTool,
    deleteFlowTool,
  ],
});
