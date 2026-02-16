import { useCallback, useState } from "react";
import type { Node } from "@xyflow/react";
import { NODE_REGISTRY, type FlowNodeData, type NodeKind } from "../../lib/flow-types";
import { LLMConfig } from "./config/LLMConfig";
import { IntentConfig } from "./config/IntentConfig";
import { EvaluatorConfig } from "./config/EvaluatorConfig";
import { ToolConfig } from "./config/ToolConfig";
import { TransformerConfig } from "./config/TransformerConfig";
import { RouterConfig } from "./config/RouterConfig";
import { ParallelConfig } from "./config/ParallelConfig";
import { JoinConfig } from "./config/JoinConfig";
import { HumanReviewConfig } from "./config/HumanReviewConfig";
import { SubFlowConfig } from "./config/SubFlowConfig";
import { MemoryConfig } from "./config/MemoryConfig";
import { HandoffConfig } from "./config/HandoffConfig";
import { ProjectContextConfig } from "./config/ProjectContextConfig";
import { AdoPrReadConfig } from "./config/AdoPrReadConfig";
import { AdoPrWriteConfig } from "./config/AdoPrWriteConfig";
import { WebhookTriggerConfig } from "./config/WebhookTriggerConfig";
import { WebhookResponseConfig } from "./config/WebhookResponseConfig";
import { StartConfig } from "./config/StartConfig";
import { EndConfig } from "./config/EndConfig";
import "./NodeConfigPanel.css";

// ── Node Documentation ────────────────────────────────────────────

interface DocSection {
  heading: string;
  body: string;
}

const NODE_DOCS: Record<NodeKind, DocSection[]> = {
  llm: [
    { heading: "Overview", body: "Sends a prompt to a Claude model and returns the response. This is the primary AI workhorse node. It can operate in pure text mode or with tool access for autonomous coding tasks." },
    { heading: "Model Selection", body: "Haiku is fastest and cheapest for simple tasks. Sonnet balances speed and intelligence. Opus is most capable for complex reasoning and multi-step coding." },
    { heading: "Tool Presets", body: "No Tools: pure text generation. Read Only: can explore files with Read, Glob, Grep. Full Access: all SDK tools including Write, Edit, Bash, and web search." },
    { heading: "Extended Context", body: "Enables the 1M token context window (Sonnet and Opus only). Useful when you need the agent to digest large codebases or lengthy documents." },
    { heading: "Outputs", body: "Two outputs: success (green) carries the LLM response, fail (red) fires on errors or exceptions." },
  ],
  intent: [
    { heading: "Overview", body: "Uses an LLM to classify incoming input into one of several named categories. Each classification becomes a separate output handle, enabling different downstream paths based on user intent." },
    { heading: "Classifications", body: "Define named categories with instructions describing what qualifies. The LLM reads the input and picks the best match. Add as many classifications as needed." },
    { heading: "Usage Tips", body: "Keep classification instructions clear and non-overlapping. Use this early in a flow to branch logic based on what the user is asking for (e.g., feature request vs. bug report vs. question)." },
    { heading: "Outputs", body: "One output per classification. Only the matched classification's output fires during execution." },
  ],
  evaluator: [
    { heading: "Overview", body: "Scores the output from a previous node against criteria you define. If the score meets the pass threshold, execution continues via the pass output; otherwise it routes to fail." },
    { heading: "Criteria", body: "Write a prompt describing what 'good' output looks like. The evaluator LLM will score the input from 0-100 based on how well it matches these criteria." },
    { heading: "Pass Threshold", body: "A score of 0-100. Output scoring at or above this threshold routes to the pass output. Below it routes to fail. Default is 70." },
    { heading: "Usage Tips", body: "Pair with a Router or loop back to an LLM node on failure to create self-correcting flows. Use a cheaper model (Haiku) for simple pass/fail checks." },
    { heading: "Outputs", body: "Two outputs: pass (green) when score >= threshold, fail (red) when score < threshold." },
  ],
  tool: [
    { heading: "Overview", body: "Executes a deterministic tool or command. Unlike LLM nodes, this runs a specific predefined action with known arguments -- no AI involved." },
    { heading: "Tool Name", body: "The name of the tool to invoke (e.g., 'run-tests', 'lint', 'deploy'). Must match a registered tool in the execution engine." },
    { heading: "Arguments", body: "Key-value pairs passed to the tool. Values can reference outputs from previous nodes using template syntax like {{nodeId.result}}." },
    { heading: "Outputs", body: "Two outputs: success (green) carries the tool result, fail (red) fires if the tool throws an error or returns a non-zero exit code." },
  ],
  transformer: [
    { heading: "Overview", body: "Reshapes data between nodes without calling an LLM. Uses a template to transform input into a different format. Fast and free -- no API calls." },
    { heading: "Template", body: "A Handlebars-style template. Use {{variable}} to insert values. The template is rendered with the input mapping as context." },
    { heading: "Input Mapping", body: "Maps template variable names to source paths. For example, map 'code' to 'llm-1.result.text' to pull the text output from a previous LLM node." },
    { heading: "Usage Tips", body: "Use between nodes when the output format of one node doesn't match the expected input of the next. Great for extracting fields, combining outputs, or reformatting text." },
  ],
  router: [
    { heading: "Overview", body: "Directs execution down one of several paths based on conditions. Supports two modes: rule-based (fast, deterministic) and LLM-based (flexible, AI-powered)." },
    { heading: "Rules Mode", body: "Define condition/output pairs. Conditions are evaluated in order and the first matching rule's output fires. Use expressions like {{score}} > 80 or {{status}} == 'error'." },
    { heading: "LLM Mode", body: "An LLM reads the input and decides which named output to route to. Write a prompt explaining the routing logic and define the possible output names." },
    { heading: "Outputs", body: "One output per rule (rules mode) or per named route (LLM mode). Only the matched route fires during execution." },
  ],
  parallel: [
    { heading: "Overview", body: "Forks execution into multiple concurrent branches. All branches run simultaneously, enabling parallel processing of independent tasks." },
    { heading: "Branches", body: "The number of parallel execution paths to create. Each branch receives a copy of the input and runs independently." },
    { heading: "Merge Strategy", body: "All: wait for every branch to complete. First: continue as soon as any branch finishes. Majority: continue when more than half complete." },
    { heading: "Usage Tips", body: "Pair with a Join node downstream to collect results. Use for tasks like running tests in parallel, querying multiple sources, or generating alternatives." },
  ],
  join: [
    { heading: "Overview", body: "Collects results from parallel branches and merges them into a single output. Always pair with an upstream Parallel node." },
    { heading: "Wait Mode", body: "All: waits for every incoming branch. First: continues on the first arrival. Count: waits for a specific number of branches." },
    { heading: "Timeout", body: "Maximum seconds to wait for branches. Set to 0 for no timeout. If the timeout expires, the join continues with whatever results have arrived." },
    { heading: "Combine Template", body: "Optional template for merging branch results into a single output. If omitted, results are returned as an array." },
  ],
  "human-review": [
    { heading: "Overview", body: "Pauses flow execution and presents a prompt to a human reviewer. The flow resumes only when the reviewer approves or rejects." },
    { heading: "Prompt", body: "The message shown to the reviewer. Should clearly describe what needs approval and provide enough context for an informed decision." },
    { heading: "Timeout", body: "Maximum seconds to wait for a review. Set to 0 for no timeout. If the timeout expires, the node routes to the reject output." },
    { heading: "Outputs", body: "Two outputs: approve (green) if the reviewer accepts, reject (red) if they decline or the timeout expires." },
  ],
  "sub-flow": [
    { heading: "Overview", body: "Embeds another flow as a single step within the current flow. The sub-flow runs to completion and its final output becomes this node's output." },
    { heading: "Flow Selection", body: "Choose an existing flow from the dropdown. The selected flow will be executed as a nested unit. Changes to the referenced flow are reflected automatically." },
    { heading: "Usage Tips", body: "Use to encapsulate reusable logic. For example, create a 'code review' sub-flow and embed it in multiple parent flows. Avoid deep nesting (more than 2-3 levels) to keep flows debuggable." },
  ],
  memory: [
    { heading: "Overview", body: "Reads from or writes to the flow's shared state store. Use this to persist information across nodes or accumulate results over multiple iterations." },
    { heading: "Operation", body: "Read: retrieves a value by key. Write: stores a value at a key. Read-Write: reads the current value, then writes a new one (useful for append/update patterns)." },
    { heading: "Key", body: "A dot-path to the memory location (e.g., 'session.summary' or 'results.tests'). Nested keys are created automatically." },
    { heading: "Value Template", body: "For write operations, a template defining what to store. Can reference the current input with {{input}} or other state with {{memory.key}}." },
  ],
  handoff: [
    { heading: "Overview", body: "Transfers curated context from one LLM node to another. Instead of passing raw output, it creates a structured briefing that gives the next agent exactly the context it needs." },
    { heading: "Briefing Prompt", body: "Instructions for how to summarize and package the context. For example: 'Summarize the code changes made and any decisions taken.'" },
    { heading: "Include Fields", body: "Specific context fields to pass along (e.g., 'task', 'decisions', 'files'). Only selected fields are included in the handoff, keeping context focused and within token limits." },
    { heading: "Usage Tips", body: "Use between LLM nodes that serve different roles (e.g., planner -> implementer). Keeps downstream agents focused by filtering out irrelevant context from upstream work." },
  ],
  "project-context": [
    { heading: "Overview", body: "Loads project files into the flow's context. Feeds file contents, directory trees, or both to downstream LLM nodes so they can reason about your codebase." },
    { heading: "File Selection", body: "Add explicit file paths for specific files, or use glob patterns (e.g., 'src/**/*.ts') for dynamic matching. Exclude patterns filter out unwanted files." },
    { heading: "Token Budget", body: "Maximum tokens to allocate for loaded context. If files exceed this budget, they are truncated. Balance between giving the LLM enough context and staying within limits." },
    { heading: "Output Format", body: "Tree & Contents: directory structure plus file contents (most complete). Contents Only: just file text. Tree Only: just the directory structure (lightweight overview)." },
    { heading: "Usage Tips", body: "Place before LLM nodes that need codebase awareness. Enable 'Respect .gitignore' to automatically skip build artifacts and dependencies." },
  ],
  "ado-pr-read": [
    { heading: "Overview", body: "Fetches comprehensive pull request data from Azure DevOps and outputs it as structured JSON. This is a data-gathering node -- the actual code review happens in a downstream LLM node." },
    { heading: "Data Retrieved", body: "PR metadata (title, description, author, status, branches), file diffs, comment threads, linked work items, commit history, build/pipeline status, reviewer assignments, and iteration history." },
    { heading: "Configuration", body: "Set the project name and repository name. The organization URL and PAT are configured in global Settings. The PR number comes dynamically from the upstream node (e.g., from a chat message)." },
    { heading: "Incremental Reviews", body: "Enable 'Track iterations' to only fetch changes since the last reviewed iteration on subsequent runs. Useful for re-reviewing after the author pushes fixes." },
    { heading: "Outputs", body: "Rich signals: success (data fetched), error (API failure), no-changes (empty diff), draft (PR is draft), merged (PR already merged)." },
  ],
  "ado-pr-write": [
    { heading: "Overview", body: "Posts review results back to an Azure DevOps pull request. Expects structured JSON input from an upstream LLM node describing comments, inline feedback, and vote decisions." },
    { heading: "Actions", body: "Can post inline comments on specific code lines, an overall review summary comment, and set the reviewer vote status (approve, reject, wait for author, etc.)." },
    { heading: "Input Schema", body: "The upstream LLM node automatically receives the expected JSON schema via the flow engine's schema injection system. The schema includes pullRequestId, summary, vote, and inlineComments fields." },
    { heading: "Safety Gate", body: "By default, requires human approval before posting. The node pauses and shows proposed comments for review. Disable this for fully automated pipelines." },
    { heading: "Outputs", body: "Rich signals: success (all posted), partial (some comments posted but errors on others), error (API failure), blocked (waiting for human approval)." },
  ],
  "webhook-trigger": [
    { heading: "Overview", body: "Receives incoming webhook POST requests as the flow entry point. Use this instead of a Start node when the flow is triggered externally via webhooks." },
    { heading: "Setup", body: "1. Add this node to your flow. 2. Open the Gateway tab in the sidebar. 3. Create a webhook endpoint for this flow. 4. The webhook URL and token will be generated automatically." },
    { heading: "Input Data", body: "The webhook request body becomes the input for downstream nodes. JSON bodies are parsed automatically when 'Parse body as JSON' is enabled." },
    { heading: "Usage Tips", body: "Pair with a Webhook Response node at the end of your flow to send custom HTTP responses back to the caller. Without a response node, callers receive a 202 Accepted." },
  ],
  "webhook-response": [
    { heading: "Overview", body: "Constructs and returns an HTTP response to the webhook caller. Place this at the end of a webhook-triggered flow to send results back to the external system." },
    { heading: "Status Code", body: "The HTTP status code to return (e.g. 200 for success, 400 for bad request). Common codes are provided as quick-select buttons." },
    { heading: "Response Template", body: "Template for the response body. Use {{input}} to include the upstream node's output. Typically JSON for API consumers." },
    { heading: "How It Works", body: "When a webhook triggers a flow, the flow runs to completion. If the flow contains a Webhook Response node, its output is sent back as the HTTP response instead of the default 202 Accepted." },
  ],
  start: [
    { heading: "Overview", body: "The entry point of every flow. When a flow executes, it begins here. Each flow must have exactly one Start node." },
    { heading: "Input Schema", body: "Optional JSON Schema defining the expected input structure. When set, the flow engine validates incoming data against this schema before execution begins." },
    { heading: "Usage Tips", body: "Connect the Start node's output to the first processing node in your flow. In a chat-based flow, the user's message arrives here as the initial input." },
  ],
  end: [
    { heading: "Overview", body: "The exit point of a flow. When execution reaches this node, the flow is complete and the final result is returned to the caller." },
    { heading: "Output Template", body: "Optional template for formatting the final output. Use {{input}} to pass through the last node's result, or write a custom template to reshape it." },
    { heading: "Usage Tips", body: "A flow can have multiple End nodes for different terminal paths (e.g., success vs. error). Connect from the last processing node in each path." },
  ],
};

interface NodeConfigPanelProps {
  node: Node;
  onConfigChange: (nodeId: string, data: FlowNodeData) => void;
  onDelete: (nodeId: string) => void;
}

const CONFIG_COMPONENTS: Record<NodeKind, React.ComponentType<{ config: Record<string, unknown>; onChange: (p: Record<string, unknown>) => void }>> = {
  llm: LLMConfig,
  intent: IntentConfig,
  evaluator: EvaluatorConfig,
  tool: ToolConfig,
  transformer: TransformerConfig,
  router: RouterConfig,
  parallel: ParallelConfig,
  join: JoinConfig,
  "human-review": HumanReviewConfig,
  "sub-flow": SubFlowConfig,
  memory: MemoryConfig,
  handoff: HandoffConfig,
  "project-context": ProjectContextConfig,
  "ado-pr-read": AdoPrReadConfig,
  "ado-pr-write": AdoPrWriteConfig,
  "webhook-trigger": WebhookTriggerConfig,
  "webhook-response": WebhookResponseConfig,
  start: StartConfig,
  end: EndConfig,
};

function NodeDocs({ kind }: { kind: NodeKind }) {
  const [open, setOpen] = useState(false);
  const docs = NODE_DOCS[kind];
  if (!docs || docs.length === 0) return null;

  return (
    <div className="node-docs">
      <button className="node-docs-toggle" onClick={() => setOpen(!open)}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4" />
          <path d="M12 8h.01" />
        </svg>
        Documentation
        <svg
          className={`node-docs-chevron ${open ? "node-docs-chevron--open" : ""}`}
          width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="node-docs-content">
          {docs.map((section, i) => (
            <div key={i} className="node-docs-section">
              <h4 className="node-docs-heading">{section.heading}</h4>
              <p className="node-docs-body">{section.body}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function NodeConfigPanel({ node, onConfigChange, onDelete }: NodeConfigPanelProps) {
  const data = node.data as unknown as FlowNodeData;
  const meta = NODE_REGISTRY[data.kind];

  const updateLabel = useCallback(
    (label: string) => {
      onConfigChange(node.id, { ...data, label });
    },
    [node.id, data, onConfigChange]
  );

  const updateConfig = useCallback(
    (patch: Record<string, unknown>) => {
      const current = data.config as { kind: NodeKind; config: Record<string, unknown> };
      onConfigChange(node.id, {
        ...data,
        config: {
          ...current,
          config: { ...current.config, ...patch },
        } as FlowNodeData["config"],
      });
    },
    [node.id, data, onConfigChange]
  );

  const ConfigComponent = CONFIG_COMPONENTS[data.kind];

  return (
    <div className="node-config-panel">
      <div className="node-config-header">
        <div className="node-config-header-row">
          <div className="node-config-icon" style={{ background: meta.color }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d={meta.icon} />
            </svg>
          </div>
          <span className="node-config-kind" style={{ color: meta.color }}>{meta.label}</span>
        </div>
        <p className="node-config-desc">{meta.description}</p>
      </div>

      <div className="node-config-body">
        {/* Common: Label */}
        <div className="config-field">
          <label className="config-label">Label</label>
          <input
            className="config-input"
            value={data.label}
            onChange={(e) => updateLabel(e.target.value)}
          />
        </div>

        {/* Kind-specific config fields */}
        {ConfigComponent && (
          <ConfigComponent
            config={data.config.config as unknown as Record<string, unknown>}
            onChange={updateConfig}
          />
        )}
      </div>

      <NodeDocs kind={data.kind} />

      <div className="node-config-footer">
        <button className="node-config-delete" onClick={() => onDelete(node.id)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
            <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
          </svg>
          Delete Node
        </button>
      </div>
    </div>
  );
}
