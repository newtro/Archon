/**
 * Flow Designer type definitions
 * Covers all 13 node types, edge connections, and flow schema.
 */

// ── Node Categories ──────────────────────────────────────────────

export type NodeCategory = "ai" | "execution" | "control" | "context" | "integration" | "structure";

export type NodeKind =
  // AI nodes
  | "llm"
  | "intent"
  | "evaluator"
  // Execution nodes
  | "tool"
  | "transformer"
  // Control flow nodes
  | "router"
  | "parallel"
  | "join"
  | "human-review"
  | "sub-flow"
  // Context nodes
  | "memory"
  | "handoff"
  | "project-context"
  // Integration nodes
  | "ado-pr-read"
  | "ado-pr-write"
  // Structure nodes
  | "start"
  | "end";

export const NODE_CATEGORY: Record<NodeKind, NodeCategory> = {
  llm: "ai",
  intent: "ai",
  evaluator: "ai",
  tool: "execution",
  transformer: "execution",
  router: "control",
  parallel: "control",
  join: "control",
  "human-review": "control",
  "sub-flow": "control",
  memory: "context",
  handoff: "context",
  "project-context": "context",
  "ado-pr-read": "integration",
  "ado-pr-write": "integration",
  start: "structure",
  end: "structure",
};

export const CATEGORY_COLORS: Record<NodeCategory, string> = {
  ai: "#8b5cf6",       // purple
  execution: "#22c55e", // green
  control: "#f59e0b",   // amber
  context: "#06b6d4",   // cyan
  integration: "#6366f1", // indigo
  structure: "#64748b",  // slate
};

// ── Node Metadata ────────────────────────────────────────────────

/** JSON Schema object describing a node's expected input or output format. */
export type NodeJsonSchema = Record<string, unknown>;

export interface NodeMeta {
  kind: NodeKind;
  label: string;
  description: string;
  category: NodeCategory;
  color: string;
  icon: string; // SVG path data
  maxInputs: number;   // -1 = unlimited
  maxOutputs: number;  // -1 = unlimited
  /** Optional JSON Schema describing what this node expects as input.
   *  When present, the flow engine injects this into upstream LLM system prompts. */
  inputSchema?: NodeJsonSchema;
  /** Optional JSON Schema describing what this node produces as output. */
  outputSchema?: NodeJsonSchema;
}

export const NODE_REGISTRY: Record<NodeKind, NodeMeta> = {
  // AI Nodes
  llm: {
    kind: "llm",
    label: "LLM",
    description: "Invoke an LLM with configurable model, prompt, and tools",
    category: "ai",
    color: CATEGORY_COLORS.ai,
    icon: "M12 8V4H8 M4 8h16v12H4V8z M8 12h8 M8 16h5",
    maxInputs: -1,
    maxOutputs: 2, // success + error
  },
  intent: {
    kind: "intent",
    label: "Intent",
    description: "Classify user intent to route paths",
    category: "ai",
    color: CATEGORY_COLORS.ai,
    icon: "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z",
    maxInputs: 1,
    maxOutputs: -1, // multiple classification outputs
  },
  evaluator: {
    kind: "evaluator",
    label: "Evaluator",
    description: "Score and validate output against criteria",
    category: "ai",
    color: CATEGORY_COLORS.ai,
    icon: "M9 11l3 3L22 4 M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11",
    maxInputs: 1,
    maxOutputs: 2, // pass + fail
  },

  // Execution Nodes
  tool: {
    kind: "tool",
    label: "Tool",
    description: "Execute a deterministic tool (tests, lint, deploy)",
    category: "execution",
    color: CATEGORY_COLORS.execution,
    icon: "M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z",
    maxInputs: 1,
    maxOutputs: 2,
  },
  transformer: {
    kind: "transformer",
    label: "Transformer",
    description: "Transform data without an LLM call",
    category: "execution",
    color: CATEGORY_COLORS.execution,
    icon: "M17 3l4 4-4 4 M3 11h18 M7 21l-4-4 4-4 M21 13H3",
    maxInputs: 1,
    maxOutputs: 1,
  },

  // Control Flow Nodes
  router: {
    kind: "router",
    label: "Router",
    description: "Route execution based on rules or LLM classification",
    category: "control",
    color: CATEGORY_COLORS.control,
    icon: "M16 3h5v5 M4 20L21 3 M21 16v5h-5 M15 15l6 6 M4 4l5 5",
    maxInputs: 1,
    maxOutputs: -1,
  },
  parallel: {
    kind: "parallel",
    label: "Parallel",
    description: "Fork into concurrent branches",
    category: "control",
    color: CATEGORY_COLORS.control,
    icon: "M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01",
    maxInputs: 1,
    maxOutputs: -1,
  },
  join: {
    kind: "join",
    label: "Join",
    description: "Collect parallel branches and merge results",
    category: "control",
    color: CATEGORY_COLORS.control,
    icon: "M5 4l7 8-7 8 M19 4l-7 8 7 8 M12 12h8",
    maxInputs: -1,
    maxOutputs: 1,
  },
  "human-review": {
    kind: "human-review",
    label: "Human Review",
    description: "Pause execution for human approval",
    category: "control",
    color: CATEGORY_COLORS.control,
    icon: "M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2 M9 7a4 4 0 100-8 4 4 0 000 8 M22 21v-2a4 4 0 00-3-3.87 M16 3.13a4 4 0 010 7.75",
    maxInputs: 1,
    maxOutputs: 2, // approve + reject
  },
  "sub-flow": {
    kind: "sub-flow",
    label: "Sub-flow",
    description: "Embed another flow as a nested step",
    category: "control",
    color: CATEGORY_COLORS.control,
    icon: "M5 5.5A3.5 3.5 0 018.5 2H12v7H8.5A3.5 3.5 0 015 5.5z M12 2h3.5a3.5 3.5 0 010 7H12V2z M12 12.5a3.5 3.5 0 117 0 3.5 3.5 0 01-7 0z M5 19.5A3.5 3.5 0 018.5 16H12v3.5a3.5 3.5 0 01-7 0z M5 12.5A3.5 3.5 0 018.5 9H12v7H8.5A3.5 3.5 0 015 12.5z",
    maxInputs: 1,
    maxOutputs: 1,
  },

  // Context Nodes
  memory: {
    kind: "memory",
    label: "Memory",
    description: "Read/write to structured state or vector store",
    category: "context",
    color: CATEGORY_COLORS.context,
    icon: "M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7 M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4 M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4 M4 12c0 2.21 3.582 4 8 4s8-1.79 8-4",
    maxInputs: 1,
    maxOutputs: 1,
  },
  handoff: {
    kind: "handoff",
    label: "Handoff",
    description: "Transfer curated context between LLM nodes",
    category: "context",
    color: CATEGORY_COLORS.context,
    icon: "M5 12h14 M12 5l7 7-7 7",
    maxInputs: 1,
    maxOutputs: 1,
  },
  "project-context": {
    kind: "project-context",
    label: "Project Context",
    description: "Load project files into agent context",
    category: "context",
    color: CATEGORY_COLORS.context,
    icon: "M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z M9 13h6 M12 10v6",
    maxInputs: 1,
    maxOutputs: 1,
  },

  // Integration Nodes
  "ado-pr-read": {
    kind: "ado-pr-read",
    label: "ADO PR Read",
    description: "Fetch pull request data from Azure DevOps (diffs, comments, work items, build status)",
    category: "integration",
    color: CATEGORY_COLORS.integration,
    icon: "M6 3v12 M18 9a3 3 0 100-6 3 3 0 000 6z M6 21a3 3 0 100-6 3 3 0 000 6z M18 9a9 9 0 01-9 9",
    maxInputs: 1,
    maxOutputs: -1, // rich signals: success, error, no-changes, draft, merged
  },
  "ado-pr-write": {
    kind: "ado-pr-write",
    label: "ADO PR Write",
    description: "Post review comments, inline feedback, and vote status to an Azure DevOps pull request",
    category: "integration",
    color: CATEGORY_COLORS.integration,
    icon: "M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7 M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z",
    maxInputs: 1,
    maxOutputs: -1, // rich signals: success, partial, error, blocked
    inputSchema: {
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
              lineEnd: { type: "number", description: "Ending line number (optional, defaults to lineStart)" },
              content: { type: "string", description: "Review comment text" },
              severity: { type: "string", enum: ["info", "warning", "critical"], description: "Comment severity" },
            },
            required: ["filePath", "lineStart", "content"],
          },
        },
      },
      required: ["pullRequestId"],
    },
  },

  // Structure Nodes
  start: {
    kind: "start",
    label: "Start",
    description: "Flow entry point",
    category: "structure",
    color: CATEGORY_COLORS.structure,
    icon: "M5 3l14 9-14 9V3z",
    maxInputs: 0,
    maxOutputs: 1,
  },
  end: {
    kind: "end",
    label: "End",
    description: "Flow exit point",
    category: "structure",
    color: CATEGORY_COLORS.structure,
    icon: "M21 12a9 9 0 11-18 0 9 9 0 0118 0z M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z",
    maxInputs: -1,
    maxOutputs: 0,
  },
};

// ── Tool Presets ─────────────────────────────────────────────────

export type ToolPreset = "none" | "read-only" | "full-access";

export const TOOL_PRESET_LABELS: Record<ToolPreset, string> = {
  "none": "No Tools",
  "read-only": "Read Only",
  "full-access": "Full Access",
};

export const TOOL_PRESET_DESCRIPTIONS: Record<ToolPreset, string> = {
  "none": "Pure text generation, no file access",
  "read-only": "Can explore and read files (Read, Glob, Grep)",
  "full-access": "All SDK tools: Read, Write, Edit, Bash, Glob, Grep, WebSearch, etc.",
};

// ── Provider & Model Metadata ────────────────────────────────────

export type LLMProvider = "claude" | "openrouter" | "claude-code";

export type ModelId = "haiku" | "sonnet" | "opus";

export const MODEL_INFO: Record<ModelId, { label: string; apiId: string; maxOutput: number; supports1M: boolean }> = {
  haiku:  { label: "Haiku 4.5",  apiId: "claude-haiku-4-5",  maxOutput: 64_000,  supports1M: false },
  sonnet: { label: "Sonnet 4.5", apiId: "claude-sonnet-4-5", maxOutput: 64_000,  supports1M: true },
  opus:   { label: "Opus 4.6",   apiId: "claude-opus-4-6",   maxOutput: 128_000, supports1M: true },
};

// ── Node Configuration Data ──────────────────────────────────────

export interface LLMNodeConfig {
  model: ModelId;
  provider?: LLMProvider;          // "claude" (default) or "openrouter"
  openrouterModel?: string;        // OpenRouter model ID, e.g. "minimax/minimax-m2.5"
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  tools: string[];       // tool names the LLM can autonomously use
  enableThinking: boolean;
  extendedContext?: boolean; // enable 1M token context window (beta, Sonnet/Opus only)
  toolPreset: ToolPreset;  // preset group for SDK tool access
  cwd?: string;            // optional working directory override (falls back to global project root)
}

export interface IntentClassification {
  name: string;
  instructions: string;
}

export interface IntentNodeConfig {
  classifications: IntentClassification[];
}

export interface EvaluatorNodeConfig {
  criteria: string;      // evaluation prompt
  passThreshold: number; // 0-100 score threshold
  model?: ModelId;  // LLM for evaluation, defaults to "sonnet"
}

export interface ToolNodeConfig {
  toolName: string;
  args: Record<string, unknown>;
}

export interface TransformerNodeConfig {
  template: string;    // Handlebars-like template
  inputMapping: Record<string, string>;
}

export interface RouterNodeConfig {
  mode: "rules" | "llm";
  rules: Array<{ condition: string; output: string }>;
  llmPrompt?: string;      // routing instructions for LLM mode
  llmOutputs?: string[];   // named output routes for LLM mode
}

export interface ParallelNodeConfig {
  branches: number;
  mergeStrategy: "all" | "first" | "majority";
}

export interface JoinNodeConfig {
  mode: "all" | "first" | "count";   // wait for all, first, or N inputs
  requiredCount?: number;             // for "count" mode — how many inputs needed
  timeout: number;                    // seconds, 0 = no timeout
  combineTemplate?: string;           // optional template for combining branch results
}

export interface HumanReviewNodeConfig {
  prompt: string;
  timeout: number;  // seconds, 0 = no timeout
}

export interface SubFlowNodeConfig {
  flowId: string;
}

export interface MemoryNodeConfig {
  operation: "read" | "write" | "read-write";
  key: string;
  valueTemplate?: string;  // template for write operations
}

export interface HandoffNodeConfig {
  briefingPrompt: string;
  includeFields: string[];
}

export type ProjectContextOutputFormat = "tree-and-contents" | "contents-only" | "tree-only";

export interface ProjectContextNodeConfig {
  /** Explicit file paths (from file picker) — always included */
  files: string[];
  /** Glob patterns for dynamic file matching */
  includePatterns: string[];
  /** Glob patterns for exclusion */
  excludePatterns: string[];
  /** Whether to respect .gitignore patterns (default: true) */
  respectGitignore: boolean;
  /** Maximum token budget for loaded context */
  maxTokens: number;
  /** How to format the output */
  outputFormat: ProjectContextOutputFormat;
}

export interface AdoPrReadNodeConfig {
  /** Azure DevOps project name (static, set in config) */
  projectName: string;
  /** Repository name or ID within the project */
  repositoryName: string;
  /** Whether to track iterations for incremental reviews */
  trackIterations: boolean;
  /** Last reviewed iteration ID (managed by the node during execution) */
  lastReviewedIteration?: number;
}

export type AdoPrWriteVote = "approve" | "approve-with-suggestions" | "wait-for-author" | "reject" | "from-input";
export type AdoPrWriteThreadStatus = "active" | "pending" | "fixed" | "closed";

export interface AdoPrWriteNodeConfig {
  /** Require human approval before posting (default: true) */
  requireHumanApproval: boolean;
  /** Set vote status on the PR */
  setVote: boolean;
  /** Default vote value if setVote is true */
  defaultVote: AdoPrWriteVote;
  /** Post inline comments from the review */
  postInlineComments: boolean;
  /** Post an overall review summary comment */
  postSummaryComment: boolean;
  /** Comment thread status for new threads */
  threadStatus: AdoPrWriteThreadStatus;
  /** Project name (should match the Read node) */
  projectName: string;
  /** Repository name or ID */
  repositoryName: string;
}

export interface StartNodeConfig {
  inputSchema?: string;  // optional JSON schema for expected input
}

export interface EndNodeConfig {
  outputTemplate?: string;
}

export type FlowNodeConfig =
  | { kind: "llm"; config: LLMNodeConfig }
  | { kind: "intent"; config: IntentNodeConfig }
  | { kind: "evaluator"; config: EvaluatorNodeConfig }
  | { kind: "tool"; config: ToolNodeConfig }
  | { kind: "transformer"; config: TransformerNodeConfig }
  | { kind: "router"; config: RouterNodeConfig }
  | { kind: "parallel"; config: ParallelNodeConfig }
  | { kind: "join"; config: JoinNodeConfig }
  | { kind: "human-review"; config: HumanReviewNodeConfig }
  | { kind: "sub-flow"; config: SubFlowNodeConfig }
  | { kind: "memory"; config: MemoryNodeConfig }
  | { kind: "handoff"; config: HandoffNodeConfig }
  | { kind: "project-context"; config: ProjectContextNodeConfig }
  | { kind: "ado-pr-read"; config: AdoPrReadNodeConfig }
  | { kind: "ado-pr-write"; config: AdoPrWriteNodeConfig }
  | { kind: "start"; config: StartNodeConfig }
  | { kind: "end"; config: EndNodeConfig };

// ── Default configs ──────────────────────────────────────────────

export function getDefaultConfig(kind: NodeKind): FlowNodeConfig {
  switch (kind) {
    case "llm":
      return { kind, config: { model: "sonnet", provider: "claude" as LLMProvider, systemPrompt: "", temperature: 0.7, maxTokens: 4096, tools: [], enableThinking: true, toolPreset: "read-only" as ToolPreset } };
    case "intent":
      return { kind, config: { classifications: [
        { name: "feature", instructions: "User wants a new feature or capability added" },
        { name: "bug", instructions: "User is reporting a bug or error to fix" },
        { name: "question", instructions: "User is asking a question about the codebase" },
      ] } };
    case "evaluator":
      return { kind, config: { criteria: "Evaluate the quality and correctness of the output.", passThreshold: 70 } };
    case "tool":
      return { kind, config: { toolName: "", args: {} } };
    case "transformer":
      return { kind, config: { template: "{{input}}", inputMapping: {} } };
    case "router":
      return { kind, config: { mode: "rules", rules: [] } };
    case "parallel":
      return { kind, config: { branches: 2, mergeStrategy: "all" } };
    case "join":
      return { kind, config: { mode: "all", timeout: 0 } };
    case "human-review":
      return { kind, config: { prompt: "Please review and approve this result.", timeout: 0 } };
    case "sub-flow":
      return { kind, config: { flowId: "" } };
    case "memory":
      return { kind, config: { operation: "read", key: "" } };
    case "handoff":
      return { kind, config: { briefingPrompt: "Summarize the current state for the next agent.", includeFields: ["task", "decisions", "files"] } };
    case "project-context":
      return { kind, config: { files: [], includePatterns: [], excludePatterns: ["node_modules/**", "dist/**", ".git/**", "__pycache__/**"], respectGitignore: true, maxTokens: 50000, outputFormat: "tree-and-contents" as ProjectContextOutputFormat } };
    case "ado-pr-read":
      return { kind, config: { projectName: "", repositoryName: "", trackIterations: false } };
    case "ado-pr-write":
      return { kind, config: { requireHumanApproval: true, setVote: true, defaultVote: "approve-with-suggestions" as AdoPrWriteVote, postInlineComments: true, postSummaryComment: true, threadStatus: "active" as AdoPrWriteThreadStatus, projectName: "", repositoryName: "" } };
    case "start":
      return { kind, config: {} };
    case "end":
      return { kind, config: {} };
  }
}

// ── Edge Types ───────────────────────────────────────────────────

export type EdgeSignal = "success" | "fail" | "default" | string;

export const EDGE_SIGNAL_COLORS: Record<string, string> = {
  success: "#22c55e",
  fail: "#ef4444",
  default: "#64748b",
};

// ── Flow Node (React Flow compatible) ────────────────────────────

export interface FlowNodeData {
  kind: NodeKind;
  label: string;
  config: FlowNodeConfig;
  [key: string]: unknown;
}

// ── Flow Schema (serialization) ──────────────────────────────────

export interface SerializedNode {
  id: string;
  kind: NodeKind;
  label: string;
  x: number;
  y: number;
  config: FlowNodeConfig;
}

export interface SerializedEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle: string | null;
  targetHandle: string | null;
  signal: EdgeSignal;
}

export interface FlowDefinition {
  id: string;
  name: string;
  description: string;
  nodes: SerializedNode[];
  edges: SerializedEdge[];
  createdAt: number;
  updatedAt: number;
  /** Context Agent config for multi-turn orchestration */
  contextAgentConfig?: {
    enabled: boolean;
    model?: "haiku" | "sonnet" | "opus";
    systemPrompt?: string;
    extendedContext?: boolean;
  };
}
