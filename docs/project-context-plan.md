# Project Context System — Implementation Plan

## Vision

When a developer opens a project in ArchonIDE and asks "What does this project do?", the AI agent should be able to read the project files and answer intelligently — without the developer manually copying file contents or telling the agent where to look. This plan covers giving AI agents autonomous access to project files via SDK tools and working directory configuration, plus a new Project Context node for pre-loading files into the agent's context window via flow configuration.

---

## Architecture Overview

Three complementary layers, implemented in order:

```
Layer 1: Agent Tool Access (this plan — immediate)
├── Set cwd on every SDK query() call
├── Enable SDK tools per LLM node via preset groups
├── Support direct chat with tools + cwd
└── Foundation for everything else

Layer 2: Project Context Node (this plan — immediate)
├── New flow node type: "project-context"
├── File picker + glob patterns for context selection
├── Token budget with visual progress indicator
├── Output injected via SDK systemPrompt option
└── .gitignore-aware filtering

Layer 3: Auto-Context Features (this plan — immediate)
├── CLAUDE.md auto-detection via SDK settingSources
├── .gitignore-aware filtering for Project Context node
└── Configurable default context when no context node present

Layer 4: Context Agent (Phase 3 — future, NOT this plan)
├── Intelligent orchestrator with curated briefings
├── Cross-session memory
└── Builds ON TOP of Layers 1-3
```

---

## Layer 1: Agent Tool Access

### 1.1 Global Project Root

When the user opens a folder in the file tree panel, that directory becomes the **global project root** for the session.

**Frontend changes:**
- `FileTreePanel.tsx`: When `openDirectory()` sets a new root, send a WebSocket message to the sidecar:
  ```json
  { "type": "set_project_root", "path": "/absolute/path/to/project" }
  ```
- Store the project root in React state (context or store) so other components can access it.

**Sidecar changes:**
- `index.ts`: Handle the `set_project_root` message, store the path in a session-level variable.
- This becomes the default `cwd` for all SDK `query()` calls.

### 1.2 Per-Node cwd Override

Each LLM node config gets an optional `cwd` field:
- Pre-populated from the global project root when the node is created.
- User can change it to point at a different directory (e.g., a subdirectory or a separate repo).
- If left blank/default, falls back to the global project root at execution time.

**Type changes** (`flow-types.ts`):
```typescript
interface LLMNodeConfig {
  model: "haiku" | "sonnet" | "opus";
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  tools: string[];
  enableThinking: boolean;
  // NEW
  cwd?: string;          // Optional override, falls back to global project root
  toolPreset: ToolPreset; // See 1.3
}
```

**Config panel** (`LLMConfig.tsx`):
- Add a "Working Directory" field showing the current cwd (pre-populated from project root).
- File/folder picker button to change it.
- "Reset to project default" option.

### 1.3 Tool Preset Groups

The SDK's `tools` option accepts either a string array of specific tool names or `{ type: 'preset', preset: 'claude_code' }` for all tools. We expose this as preset groups:

| Preset | SDK `tools` value | Description |
|--------|------------------|-------------|
| **No tools** | `[]` | Pure text generation, no file access |
| **Read-only** | `['Read', 'Glob', 'Grep']` | Can explore and read files, cannot modify |
| **Full access** | `{ type: 'preset', preset: 'claude_code' }` | All SDK tools: Read, Write, Edit, Bash, Glob, Grep, WebSearch, WebFetch, Task, etc. |

**Config panel** (`LLMConfig.tsx`):
- Dropdown/radio group for selecting the tool preset.
- Each preset shows a brief description of what tools are included.

**Flow execution** (`flow-engine.ts`):
```typescript
// Resolve cwd: node override > global project root > process.cwd()
const resolvedCwd = nodeCfg.cwd || globalProjectRoot || process.cwd();

// Resolve tools from preset
const resolvedTools = resolveToolPreset(nodeCfg.toolPreset);

const options: Options = {
  model: nodeCfg.model,
  cwd: resolvedCwd,
  tools: resolvedTools,
  systemPrompt: buildSystemPrompt(nodeCfg, contextNodeOutput),
  permissionMode: 'bypassPermissions',
  allowDangerouslySkipPermissions: true,
  includePartialMessages: true,
  abortController,
};
```

### 1.4 Direct Chat Tool Access

When chatting without a flow, the agent should also get tool access and the correct cwd.

**Sidecar changes** (`agent.ts`):
- Pass `cwd: globalProjectRoot` in the `Options` for direct chat `query()` calls.
- Use a default tool preset (configurable via settings — see Layer 3).

```typescript
const options: Options = {
  model: "sonnet",
  cwd: globalProjectRoot || process.cwd(),
  tools: { type: 'preset', preset: 'claude_code' },  // or configurable default
  permissionMode: 'bypassPermissions',
  allowDangerouslySkipPermissions: true,
  includePartialMessages: true,
  abortController: activeAbortController,
};
```

---

## Layer 2: Project Context Node

### 2.1 New Node Type

A new flow node in the "Context" category: **Project Context**.

**Purpose:** Read project files at execution time and output structured context that gets injected into downstream LLM nodes' system prompts.

**Type definition** (`flow-types.ts`):
```typescript
type FlowNodeKind =
  | "start" | "end"           // Structure
  | "llm" | "intent" | "evaluator"  // AI
  | "tool" | "transformer"    // Execution
  | "router" | "parallel" | "human-review" | "sub-flow"  // Control
  | "memory" | "handoff"      // Context (existing)
  | "project-context";        // Context (NEW)

interface ProjectContextNodeConfig {
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
  outputFormat: "tree-and-contents" | "contents-only" | "tree-only";
}
```

### 2.2 Configuration Panel

**`ProjectContextConfig.tsx`** — New React component for the flow designer's config panel:

1. **File Picker Section**
   - List of explicitly selected files with remove buttons.
   - "Add Files" button opens a file browser (within the project root).
   - Shows file sizes and estimated token counts per file.

2. **Pattern Section**
   - Include patterns: text inputs for glob patterns (e.g., `**/*.ts`, `src/**`).
   - Exclude patterns: text inputs (pre-populated with common excludes: `node_modules/**`, `dist/**`, `.git/**`).
   - Checkbox: "Respect .gitignore" (default: on).

3. **Token Budget Section**
   - Configurable max token limit (slider or input, default: 50,000).
   - **Visual progress bar** showing current estimated usage vs. budget.
   - As files are added (via picker or patterns), the bar updates in real-time.
   - Color coding: green (under 50%), yellow (50-80%), red (80-100%).

4. **Output Format**
   - Radio group: "Tree + Contents" (default), "Contents Only", "Tree Only".

### 2.3 Execution

At runtime, the Project Context node:

1. **Resolves file list** — Combines explicit files + glob pattern matches, minus exclude patterns. If `respectGitignore` is on, filters out .gitignore'd paths.
2. **Reads files** — Uses Node.js `fs` directly in the sidecar. Handles missing files gracefully (warn and skip).
3. **Counts tokens** — Uses a fast token estimation (chars / 4 as rough estimate, or a proper tokenizer).
4. **Enforces budget** — Files are loaded in order (explicit files first, then pattern matches sorted by path). Stops when budget is reached. Remaining files listed as "skipped due to token limit."
5. **Formats output** — Builds structured text based on `outputFormat`.

**Output format example** (`tree-and-contents`):
```
## Project Structure
src/
  index.ts
  lib/
    flow-types.ts
    flow-storage.ts
  components/
    chat/
      ChatPanel.tsx

## File Contents

### src/index.ts
[file contents here]

### src/lib/flow-types.ts
[file contents here]

[... more files ...]

## Skipped (token limit reached)
- src/components/flow/FlowDesigner.tsx (estimated 2,400 tokens)
```

### 2.4 Context Delivery to LLM Nodes

The Project Context node's output flows to downstream LLM nodes via edges (standard React Flow data flow).

At LLM node execution time:
- If the LLM node has an incoming edge from a Project Context node, that context is combined with the node's system prompt.
- Delivered via the SDK's `systemPrompt` option:

```typescript
const systemPrompt = [
  nodeCfg.systemPrompt,           // Node's own system prompt ("You are an expert architect...")
  contextNodeOutput,               // Project Context node output (file contents)
].filter(Boolean).join("\n\n---\n\n");

const options: Options = {
  systemPrompt,
  // ... other options
};
```

### 2.5 Stale Path Handling

**In the flow designer (proactive):**
- When the Project Context node config panel is open, periodically check if configured files still exist.
- Show a red warning badge on the node in the canvas if any files are missing.
- In the config panel, highlight missing files in red with a "File not found" label.

**At execution time (reactive):**
- If a configured file doesn't exist, log a warning to the chat/log panel.
- Skip the missing file and continue loading others.
- Include a note in the context output: `[WARNING: file.ts not found, skipped]`

---

## Layer 3: Auto-Context Features

### 3.1 CLAUDE.md Auto-Detection

The Claude Agent SDK natively supports loading CLAUDE.md files when `settingSources` includes `'project'`.

**Implementation:**
```typescript
const options: Options = {
  cwd: resolvedCwd,
  settingSources: ['project'],  // This tells the SDK to load .claude/settings.json and CLAUDE.md
  // ... other options
};
```

When a project has a `CLAUDE.md` file at its root (or `.claude/CLAUDE.md`), the SDK automatically injects it into the agent's context as project-specific instructions.

**Apply to:**
- All LLM node executions (when cwd points to a project with CLAUDE.md)
- Direct chat (when a project is open)

### 3.2 .gitignore-Aware Filtering

The Project Context node should respect `.gitignore` patterns when loading files.

**Implementation:**
- Use a library like `ignore` (npm) to parse `.gitignore` files.
- When `respectGitignore: true` (default), load the project's `.gitignore` and apply it as additional exclude patterns.
- Also exclude common directories by default: `node_modules`, `.git`, `dist`, `build`, `__pycache__`, `.venv`, `target`, `.next`.

### 3.3 Configurable Default Context

**Global setting:** "Auto-include project overview when no Project Context node is present"

When this is ON and a flow has no Project Context node (or in direct chat), automatically inject a brief project summary:
- File tree listing (top-level and one level deep)
- Detected project type (based on package.json, Cargo.toml, pyproject.toml, etc.)
- README.md first paragraph (if exists)

**Settings UI:**
- Add to Settings panel: "Default Project Context" section.
- Toggle: "Auto-include project overview" (default: ON).
- This injects a lightweight project summary into the systemPrompt for all LLM calls.

---

## Implementation Changes — Key Files

### Sidecar

| File | Changes |
|------|---------|
| `sidecar/src/index.ts` | Handle `set_project_root` WebSocket message, store global project root |
| `sidecar/src/agent.ts` | Pass `cwd`, `tools`, `settingSources` in direct chat `query()` Options |
| `sidecar/src/flow-engine.ts` | Resolve per-node cwd, tool presets, context node output. Build systemPrompt with context. |
| `sidecar/src/flow-types.ts` | Add `ProjectContextNodeConfig`, update `LLMNodeConfig` with cwd and toolPreset |
| `sidecar/src/context-loader.ts` | **NEW** — File reading, glob matching, .gitignore filtering, token counting, output formatting |

### Frontend

| File | Changes |
|------|---------|
| `app/src/lib/flow-types.ts` | Add `"project-context"` to node kinds, add `ProjectContextNodeConfig` type, update `LLMNodeConfig` |
| `app/src/lib/types.ts` | Add `set_project_root` WebSocket message type |
| `app/src/components/files/FileTreePanel.tsx` | Send `set_project_root` message when user opens a folder |
| `app/src/components/flow/config/LLMConfig.tsx` | Add Working Directory field and Tool Preset selector |
| `app/src/components/flow/config/ProjectContextConfig.tsx` | **NEW** — Config panel for Project Context node |
| `app/src/components/flow/nodes/ProjectContextNode.tsx` | **NEW** — Visual node component for the canvas |
| `app/src/components/flow/FlowDesigner.tsx` | Register new node type in nodeTypes map |
| `app/src/components/flow/NodeLibrary.tsx` | Add Project Context to the node palette |

---

## Non-Goals (Out of Scope)

- **Context Agent implementation** — That's Phase 3 (intelligent briefing, cross-session memory). This plan provides the foundation.
- **Live context updates** — Context refreshing when files change during a session. Could be added later.
- **Context diff mode** — Loading git diffs instead of full files. Nice-to-have for code review flows.
- **Multi-project context** — Loading from multiple project roots simultaneously.
- **Smart file relevance scoring** — AI-powered file selection based on the user's question.
- **Project Context templates** — Pre-built configs for common project types.
- **Cost estimation** — Showing estimated API cost for pre-loaded context.

---

## Open Questions

1. **Token counting accuracy** — Should we use a proper tokenizer (like `@anthropic-ai/tokenizer`) for exact counts, or is chars/4 good enough for the budget progress bar?

2. **File size limits** — Should individual files have a max size before we truncate them? (e.g., skip files > 100KB, or truncate to first 500 lines?)

3. **Default tool preset for direct chat** — Should direct chat default to "Read-only" or "Full access"? Full access is more capable but riskier.

4. **Project root persistence** — Should the last-opened project root be remembered across app restarts? (Tauri plugin-store could handle this.)

5. **Multiple Project Context nodes** — Should a flow allow multiple Project Context nodes feeding into the same LLM node? If so, how do their outputs combine?
