# ArchonIDE - Implementation Plan

## Vision & Elevator Pitch

ArchonIDE is an AI agent-first IDE that puts developers in control of *how* AI writes their code. Instead of a black-box chat interface, ArchonIDE features a visual agentic flow designer where developers can design, customize, and share the agent coding loops that power their workflow. Built as a Tauri desktop app with a React frontend and the Claude Agent SDK, it transforms AI-assisted coding from opaque and one-size-fits-all into transparent, composable, and deeply customizable.

**One-liner:** The IDE where you don't just use AI agents — you architect them.

---

## Problem Statement

Current AI-powered IDEs (Cursor, Windsurf, GitHub Copilot) share three fundamental limitations:

1. **Opaque agent behavior** — The AI operates as a black box. Developers can't see how it plans, what it considers, or why it makes decisions. When it fails, you can't diagnose why.

2. **One-size-fits-all workflows** — Every task uses the same agent loop. A bug fix, a greenfield feature, a refactor, and a test suite all get the same treatment. Different tasks need fundamentally different approaches.

3. **No composability** — You can't chain specialized agents, create multi-step workflows, or build processes that match your team's development methodology. The agent loop is fixed and invisible.

ArchonIDE solves all three by making the agent's thinking process visible, editable, and shareable through a visual flow designer.

---

## Core Architecture

```
+------------------+       WebSocket (localhost)    +------------------------+
|   Tauri v2 App   |  <------------------------->  |   Node.js Sidecar      |
|                  |                                |                        |
|  [React Frontend]|   JSON messages:               |  [Agent Manager]       |
|  - Flow Designer |   - start/stop agent           |  - Concurrent agents   |
|  - Chat Panel    |   - streamed agent output      |    via async/await     |
|  - Code Viewer   |   - permission requests        |  - Claude Agent SDK    |
|  - Log Stream    |   - tool results               |  - Built-in tools      |
|                  |                                |  - MCP servers         |
|  [Rust Backend]  |                                |                        |
|  - Sidecar mgmt  |                                |  [Per-Agent Isolation] |
|  - SQLite DB     |                                |  - Separate cwd        |
|  - File watcher  |                                |  - Git worktrees       |
|  - OS keychain   |                                |  - AbortController     |
+------------------+                                +------------------------+
```

### Why This Architecture

- **Tauri v2** — Lightweight native desktop app (~10MB binary vs Electron's ~150MB). Rust backend for performance-critical operations (file watching, SQLite, process management). Web frontend for UI flexibility.

- **Single Node.js Sidecar** — One process handles 5-10 concurrent agent workflows via async/await on a single event loop. Agent work is I/O-bound (waiting for LLM API responses), so async concurrency is optimal. ~100MB memory for 10 concurrent agents.

- **WebSocket IPC** — The sidecar starts an HTTP/WebSocket server on a random localhost port, reports the port via stdout. Bidirectional streaming for real-time agent output. Standard tooling for debugging. Can connect to the sidecar independently for testing.

- **Per-Agent Directory Isolation** — Each concurrent agent operates in its own Git worktree, preventing file conflicts when multiple agents edit code simultaneously.

---

## Node Type System

The visual flow designer uses a rich taxonomy of 13 node types organized into 5 categories:

### AI Nodes
| Node | Description |
|------|-------------|
| **LLM** | Invoke an LLM with configurable model, role, system prompt, and autonomous tool set. The core execution node. |
| **Intent** | Classify user intent to route paths (feature request, bug fix, question, approval, etc.). |
| **Evaluator** | Quality gate — score and validate output against criteria. Returns pass/fail with scores. |

### Execution Nodes
| Node | Description |
|------|-------------|
| **Tool** | Execute a deterministic tool (run tests, lint, deploy). Acts as a mandatory quality gate between LLM nodes. |
| **Transformer** | Transform data without an LLM call (format conversion, data extraction, template rendering). |

### Control Flow Nodes
| Node | Description |
|------|-------------|
| **Router** | Route execution based on heuristic rules or LLM classification. Branch the flow. |
| **Parallel** | Fork into concurrent branches. All branches execute simultaneously and results are merged. |
| **Human Review** | Pause execution for human approval or input. Presents a review UI to the user. |
| **Sub-flow** | Embed another flow as a nested step. Enables flow composition and reuse. |

### Context Nodes
| Node | Description |
|------|-------------|
| **Memory** | Read/write to the structured state store or vector store. Handles cross-session persistence. |
| **Handoff** | Transfer curated context between LLM nodes. Generates focused briefings from accumulated state. |

### Structure Nodes
| Node | Description |
|------|-------------|
| **Start** | Flow entry point. Receives user input and initial context. |
| **End** | Flow exit point. Returns final result to the user. |

### Tool Model: Guardrails Pattern

- **LLM nodes** have autonomous tools attached — the LLM decides when to use them during its execution (standard agentic loop: think -> tool_use -> observe -> repeat).
- **Tool nodes** are mandatory checkpoints — they always execute regardless of LLM decisions (e.g., "always run tests after coding," "always lint before committing").
- **Mental model:** LLM nodes are the workers, Tool nodes are the quality gates.

---

## Context Agent Architecture

The defining innovation of ArchonIDE is the **Context Agent** — a configurable AI agent that serves as the orchestration brain for each workflow.

### What the Context Agent Does

1. **Intent Classification** — Classifies user messages (feature addition, bug fix, question, approval) and determines task complexity.

2. **Complexity-Based Model Routing** — Routes to the appropriate execution model:
   - Opus for complex tasks (new features, architecture decisions)
   - Sonnet for medium tasks (it can handle tasks directly)
   - Haiku for simple tasks (logging, comments, small fixes)

3. **Curated Briefing Generation** — Creates focused context packages for downstream agents, excluding irrelevant noise. Demonstrated 73% token reduction (45k -> 12k tokens) vs passing raw history.

4. **Structured State Tracking** — Maintains a JSON state object tracking:
   ```json
   {
     "task": "description",
     "taskStatus": "in_progress",
     "files": { "path": { "summary": "...", "changes": "...", "modified": "turn N" } },
     "decisions": ["decision 1", "decision 2"],
     "errors": [{ "turn": N, "error": "...", "resolution": "..." }],
     "keyInsight": "critical constraint",
     "pendingUserAction": "what the user needs to do"
   }
   ```

5. **Cross-Session Memory** — Persists session state to `.archon/sessions/`. When a user references previous work ("go back to the auth refactor"), the Context Agent loads relevant prior context.

6. **Direct Execution** — For low-complexity tasks, the Context Agent handles them directly instead of routing to a more expensive model.

### Context Agent as Configurable Entity

The Context Agent is not a baked-in system component — it's a first-class configurable agent:

```
Context Agent Configuration:
├── Model: User-selectable (Sonnet recommended, Opus for maximum intelligence)
├── System Prompt: Customizable orchestration instructions
├── Max Context: Token limit for the context window
├── Routing Rules: Complexity thresholds, model mapping
├── Briefing Template: What to include/exclude in briefings
└── State Schema: Customizable JSON structure
```

Each workflow can have its own Context Agent. Simple workflows can optionally skip the Context Agent entirely for a direct chat-to-LLM experience.

### Briefing Pattern

Instead of passing raw conversation history to execution agents, the Context Agent writes focused "briefings" — like a senior engineer handing off to a colleague:

```
+---------------------------------------------------+
| BRIEFING TO OPUS                                   |
|                                                    |
| TASK: Write tests for the Stripe webhook endpoint  |
|                                                    |
| WHAT WAS BUILT:                                    |
| - Webhook route at POST /api/webhook/stripe        |
| - Stripe signature verification                    |
| - Event handlers: succeeded, failed                |
|                                                    |
| FILES: [current relevant file contents]            |
|                                                    |
| EXCLUDED: Raw tool outputs from earlier turns,     |
| intermediate errors (already fixed), unrelated     |
| files                                              |
+---------------------------------------------------+
```

---

## Tool System

### Built-in Tools (Claude Agent SDK)

The following tools are provided by the Agent SDK and available to all LLM nodes:

| Tool | Function |
|------|----------|
| Read | Read file contents |
| Write | Create new files |
| Edit | Edit existing files with string replacements |
| Bash | Execute shell commands |
| Glob | Find files by pattern |
| Grep | Search file contents with regex |
| WebSearch | Search the web |
| WebFetch | Fetch and process web content |

### MCP Extension

For additional tools beyond the built-in set, ArchonIDE supports MCP (Model Context Protocol) servers:

- Users can configure MCP servers in settings (global or per-project)
- MCP servers are spawned and managed by the Node.js sidecar
- Available tools from MCP servers appear in the flow designer's Tool node configuration
- Examples: PostgreSQL, GitHub, Slack, Jira, Notion, custom APIs

MCP is the universal standard for AI tool integration (97M+ monthly SDK downloads, backed by the Linux Foundation, adopted by Anthropic, OpenAI, Google, Microsoft).

---

## Data & Storage

### SQLite Database

All structured data is stored in SQLite:

| Data | Location | Purpose |
|------|----------|---------|
| Flows | Project-local `.archon/flows.db` | Flow definitions, node configs, edge connections |
| Sessions | Project-local `.archon/sessions.db` | Conversation history, Context Agent state, execution logs |
| User Config | Global `AppData/ArchonIDE/config.db` | Preferences, default flows, MCP server configs |
| Execution History | Project-local `.archon/history.db` | Flow run records, token usage, cost tracking |

### File System Layout

**Project-local (`.archon/` directory):**
```
.archon/
├── flows.db          # Flow definitions for this project
├── sessions.db       # Session history and Context Agent state
├── history.db        # Execution history and analytics
└── config.json       # Project-specific overrides
```

**Global (`AppData/ArchonIDE/`):**
```
AppData/ArchonIDE/
├── config.db         # User preferences, MCP configs
├── default-flows/    # Default flow templates
├── keychain/         # Managed by OS keychain API
└── cache/            # Model response cache, registry cache
```

---

## UI Design

### Dynamic Workspace with Presets

The UI uses draggable, resizable panels that users can arrange freely. Ship with recommended layout presets:

**Preset: Chat Focus** (default for new users)
```
+------+----------------------------+
| File |       Chat Panel           |
| Tree |                            |
|      |                            |
|      +----------------------------+
|      |     Terminal / Logs         |
+------+----------------------------+
```

**Preset: Flow Focus** (for flow editing)
```
+------+----------------------------+
| Node |    Flow Designer           |
| Lib  |                            |
|      |                            |
|      +----------------------------+
|      |     Chat Panel (compact)   |
+------+----------------------------+
```

**Preset: Review** (for reviewing agent output)
```
+------+--------------+-------------+
| File | Code Viewer  | Chat Panel  |
| Tree | (with diffs) |             |
|      |              |             |
|      +--------------+-------------+
|      |     Terminal / Logs         |
+------+----------------------------+
```

### Three Visibility Layers

1. **Chat Panel** (always visible) — Familiar chatbot interface showing agent progress, tool use, and node transitions.

2. **Animated Flow Panel** (toggleable) — The flow diagram lights up in real-time as nodes execute. Active nodes pulse, data flows along edges, results appear on completed nodes.

3. **Log Stream Panel** (toggleable) — Deep debugging view with every LLM call, latency, token count, tool results, and cost.

### Code Viewer

**MVP:** Tree-sitter based syntax highlighting viewer. Lightweight (~500KB, <50ms startup), read-focused. Supports all major languages.

**Future:** Upgrade to Monaco editor if users demand inline editing and diff review capabilities.

---

## Chat Log Design

The chat panel is the primary interface. It must be visually polished, developer-centric, and show full detail about agent operations. **No emojis** — use a professional icon library (Lucide Icons recommended, pairs with shadcn/ui).

### Design Rules

1. **No emojis.** Use Lucide or Phosphor Icons for all iconography — clean, consistent, professional.
2. **Streaming always on.** Text streams character-by-character from the API. Code blocks render progressively with live syntax highlighting.
3. **Developer details are first-class.** Tool calls, token counts, latency, and costs are visible — not hidden behind menus.

### Icon System

Each tool type gets a distinct **Lucide icon** and accent color:

| Tool | Lucide Icon | Accent Color | Hex |
|------|------------|-------------|-----|
| Read | `FileText` | Blue | `#3B82F6` |
| Write | `FilePlus` | Green | `#22C55E` |
| Edit | `Pencil` | Amber | `#F59E0B` |
| Bash | `Terminal` | Purple | `#8B5CF6` |
| Glob | `FolderSearch` | Cyan | `#06B6D4` |
| Grep | `Search` | Teal | `#14B8A6` |
| WebSearch | `Globe` | Indigo | `#6366F1` |
| MCP Tool | `Wrench` | Slate | `#64748B` |
| Thinking | `Brain` | Gray | `#9CA3AF` |
| Error | `AlertCircle` | Red | `#EF4444` |
| Success | `CheckCircle` | Green | `#22C55E` |

### Tool Call Cards

Each tool call renders as a distinct card with this structure:

```
+--[Icon] [Tool Name]---[File/Command]--------[Duration]--[Status]--+
|                                                                     |
|  [Smart Summary - 1-2 lines when collapsed]                        |
|                                                                     |
|  +---------------------------------------------------------------+ |
|  |  [Content Area - expandable]                                   | |
|  |  Diffs, file contents, terminal output, search results         | |
|  +---------------------------------------------------------------+ |
|                                                                     |
|  [Tokens] . [Copy] . [Open in Viewer]              [Expand/Collapse]|
+---------------------------------------------------------------------+
```

**Card States:**
- **Collapsed** (default): Header + smart summary. Click to expand.
- **Expanded**: Full content with syntax highlighting.
- **Loading**: Pulsing accent-color border. Duration counter ticking in real-time.
- **Error**: Red accent. Summary shows error message.
- **Success**: Check icon in status position.

**Smart Summaries per Tool Type:**
- **Read**: `"src/routes/payments.ts -- 148 lines, TypeScript"`
- **Write**: `"Created src/tests/webhook.test.ts -- 92 lines"`
- **Edit**: Compact inline diff showing 1-2 changed lines with red/green highlighting
- **Bash**: Command + result: `"$ npx tsc --noEmit -> No errors"` or `"$ npx jest -> 6 passed, 0 failed"`
- **Glob**: `"Found 12 files matching **/*.test.ts"`
- **Grep**: `"8 matches in 4 files for 'handleWebhook'"`

**Edit Card Diff Rendering:**
When collapsed, shows compact inline diff (red/green lines). When expanded, shows full unified diff with line numbers, syntax highlighting, and configurable context lines (1/3/5/all).

**Bash Card Terminal Output:**
Monospace font with ANSI color rendering. Green for pass, red for fail, yellow for warnings. Configurable max lines (10/25/50/unlimited) before "Show more" truncation.

### Streaming & Animations

**Text Streaming:**
- Characters stream at API delivery speed
- Code blocks render progressively with live syntax highlighting
- Markdown formats in real-time (headers, bold, lists become styled as they complete)
- Subtle blinking cursor at the streaming text endpoint

**Tool Card Animations:**
- **Appearance**: Cards slide in with a 200ms ease-out fade + translate
- **Loading**: Pulsing glow on accent-color border. Duration counter ticks in real-time. Thin indeterminate progress bar on left edge.
- **Completion**: Pulsing stops, border becomes solid. Status icon fades in. Smart summary slides in.
- **Error flash**: Brief red flash on the card border for failed operations.
- **Expand/Collapse**: Smooth 150ms height animation.

**Thinking Indicator:**
- Appears as a card with the `Brain` icon and "Thinking..." label
- Animated shimmer/gradient bar (skeleton loader style)
- When complete: expands to reveal reasoning text (dimmed, italic styling) if show-thinking is ON, or collapses away if OFF.

**Node Transition Dividers:**
Subtle horizontal rules that slide in between message groups:
```
=== [Brain icon] Context Agent -> [GitBranch icon] Router -> Opus (code) ===
```
Shows the flow path. Currently active node name pulses briefly.

**Streaming Code Blocks:**
Code block starts with language tag and progressively fills with live syntax highlighting. Creates the "watching the AI code" experience.

### Information Density Modes

Three modes, switchable via toolbar toggle or keyboard shortcut:

**Minimal Mode:**
- AI text in full
- Tool calls collapsed to single line: `[Check] Read src/payments.ts (148 lines) . 12ms`
- No thinking blocks. No node transitions. No metadata.

**Normal Mode** (default):
- AI text in full
- Tool call cards with smart summaries, expandable
- Thinking blocks collapsed by default, expandable
- Node transition dividers shown
- Per-turn cost in subtle footer

**Verbose Mode:**
- Everything in Normal, plus:
- Thinking blocks always expanded
- Tool cards expanded by default
- Full metadata on every element: model, tokens (in/out), cost, latency, context window usage
- Context Agent briefings shown as expandable blocks
- Raw API request/response in a "Raw" tab per message

**Per-Element Settings:**

| Setting | Options | Default |
|---------|---------|---------|
| Show thinking blocks | Always / On click / Never | On click |
| Auto-expand tool cards | All / Errors only / Never | Never |
| Show token counts | Always / Hover / Never | Hover |
| Show cost per turn | Always / Hover / Never | Always |
| Show node transitions | Always / Never | Always |
| Show Context Agent briefings | Always / On click / Never | On click |
| Terminal output max lines | 10 / 25 / 50 / Unlimited | 25 |
| Diff context lines | 1 / 3 / 5 / All | 3 |

**Keyboard Shortcuts:**

| Shortcut | Action |
|----------|--------|
| `Ctrl+1` | Minimal mode |
| `Ctrl+2` | Normal mode |
| `Ctrl+3` | Verbose mode |
| `Ctrl+E` | Expand all tool cards in current turn |
| `Ctrl+Shift+E` | Collapse all tool cards |
| `Ctrl+T` | Toggle thinking blocks |

### Status Bar

Persistent bar at the bottom of the chat panel:

```
[Circle] Opus (coding) | Turn 3 | 12.4k tokens | $0.042 | 3.2s
```

Shows: active model, current turn, cumulative tokens, cumulative cost, elapsed time.

---

## Authentication

### BYOK (Bring Your Own Key)

Users provide their Anthropic API key, which is stored securely in the OS keychain via Tauri's keychain plugin.

- User signs up at [console.anthropic.com](https://console.anthropic.com) and generates an API key
- Enters the key in ArchonIDE's Settings > API Configuration
- Key is stored in the OS keychain (Windows Credential Manager / macOS Keychain / Linux Secret Service)
- All API calls go directly to Anthropic's API — no proxy, no middleman

**Why not OAuth:** Anthropic explicitly blocks third-party applications from using Claude subscription OAuth tokens (enforced January 2026). The Anthropic Commercial API with user-provided keys is the supported, compliant path.

**Future considerations:**
- Amazon Bedrock credentials (Claude via AWS)
- Google Cloud Vertex AI credentials (Claude via GCP)
- Optional ArchonIDE proxy service for simplified billing (requires business infrastructure)

---

## Community Flow Registry

A public registry where developers share, discover, and remix custom agent flows.

### Concept

- Users publish flows to the registry with metadata (name, description, tags, supported tech stacks)
- Other users browse, rate, fork, and install flows
- Flows can depend on specific MCP servers (dependencies are documented)
- Version history for published flows

### MVP Scope

For MVP, the registry can be a simple GitHub-based approach:
- Flows exported as JSON from SQLite
- Published to a community GitHub repository
- ArchonIDE has a "Browse Flows" UI that reads from the repo
- Install = download JSON and import into local SQLite

### Future

- Dedicated web-based registry with search, ratings, categories
- In-app flow marketplace
- Featured/curated flow collections ("Best flows for React," "Top TDD flows")

---

## Tech Stack (Verified Current Versions)

| Technology | Version | Purpose |
|-----------|---------|---------|
| **Tauri** | v2.10.2 (Feb 2026) | Desktop app framework (Rust backend + web frontend) |
| **React** | v19.x | Frontend UI framework |
| **TypeScript** | v5.x | Type-safe JavaScript for frontend and sidecar |
| **@xyflow/react** (React Flow) | v12.10.0 | Visual node-based flow designer |
| **web-tree-sitter** | v0.26.5 | Lightweight syntax highlighting for code viewer |
| **@anthropic-ai/claude-agent-sdk** | v0.2.39 | Agent orchestration, tool execution, LLM interaction |
| **@modelcontextprotocol/sdk** | Latest | MCP server support for extensible tools |
| **better-sqlite3** | v12.6.2 | SQLite for Node.js sidecar (flows, sessions, history) |
| **tauri-plugin-sql** | Latest | SQLite access from Tauri Rust backend |
| **tauri-plugin-shell** | Latest | Sidecar process management |
| **Lucide Icons** | Latest | Professional icon library (no emojis) |
| **Node.js** | v22.x LTS | Sidecar runtime |

### Key Dependencies Notes

- **@xyflow/react v12** — Package renamed from `reactflow`. Supports React 19, dark mode, SSR, Tailwind CSS 4.
- **Claude Agent SDK** — Renamed from "Claude Code SDK." Provides all built-in tools + MCP support. Rapid release cadence (0.2.39 as of Feb 2026).
- **Tauri v2** — Stable since Oct 2024. Rewritten IPC layer supports raw payloads for performance. Built-in sidecar support via tauri-plugin-shell.

---

## MVP Milestones

### Phase 1: Foundation (Weeks 1-3)
- Tauri v2 project scaffold with React frontend
- Node.js sidecar with WebSocket IPC
- Basic chat interface connected to Claude Agent SDK
- BYOK API key configuration with OS keychain storage
- File tree panel (open folder, browse files)
- Tree-sitter code viewer

**Deliverable:** A working chat-based coding assistant in a desktop app.

### Phase 2: Flow Designer (Weeks 4-7)
- React Flow integration with custom node types
- Implement all 13 node types as visual components
- Flow serialization to/from SQLite
- Node configuration panels (model selection, prompt editing, tool assignment)
- Edge connections with typed signals (success/fail/score)
- Default "General Coding Assistant" flow

**Deliverable:** Users can create, edit, and save visual agent flows.

### Phase 3: Flow Execution Engine (Weeks 8-11)
- Flow runtime that interprets the visual flow as agent orchestration
- Context Agent implementation (intent classification, routing, briefing generation)
- Structured state tracking (JSON state object)
- Parallel node execution
- Sub-flow embedding
- Human Review node (pause and prompt user)
- Real-time animated flow visualization during execution

**Deliverable:** Flows actually execute and produce results. The animated flow view shows real-time progress.

### Phase 4: Polish & Quality (Weeks 12-14)
- Dynamic workspace layout with presets
- Log stream panel
- MCP server configuration and discovery
- Cross-session memory (Context Agent loads prior sessions)
- Git worktree isolation for parallel agents
- Error handling and recovery (agent crash recovery, sidecar restart)
- Export/import flows (JSON format)

**Deliverable:** MVP-quality product ready for other developers to use.

### Phase 5: Community (Weeks 15-16)
- Community Flow Registry (GitHub-based MVP)
- Browse, install, and publish flows
- Flow metadata (tags, tech stack, description)

**Deliverable:** First public release with community sharing.

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Claude Agent SDK rapid changes (v0.2.x) | Breaking updates could destabilize ArchonIDE | Pin SDK version, test upgrades in isolation, maintain compatibility layer |
| Flow execution complexity | Translating visual flows to runtime behavior is non-trivial | Start with simple linear flows, add complexity incrementally. Extensive test coverage for the flow engine. |
| Context Agent quality | Bad routing or briefing decisions degrade all downstream agents | Make Context Agent model configurable (users can upgrade). Log all routing decisions for debugging. Fallback to direct-to-LLM if Context Agent fails. |
| Sidecar process management | Crashes, memory leaks, zombie processes | Health check endpoint, automatic restart, memory monitoring, graceful shutdown on app close |
| SQLite concurrency | Multiple agents writing simultaneously | Use WAL mode, transaction isolation, write queue if needed |
| Tauri webview limitations | Browser compatibility issues, limited APIs | Test on all target platforms early. Use Tauri plugins for native capabilities. |
| API cost for users | Multiple agents + Context Agent = high API costs | Show real-time cost tracking, allow cost limits per flow, encourage Haiku for simple tasks |

---

## Open Questions

1. **Flow versioning** — How to handle flow migrations when the schema evolves? SQLite migrations? Version field in flow JSON?

2. **Undo/redo for agent changes** — Should ArchonIDE track all file changes and allow rollback? Git-based (branch per agent run)? Or a custom change log?

3. **Multi-model support timeline** — When to add OpenAI, Gemini, and local model support? What's the abstraction layer?

4. **Offline mode** — Should any functionality work without an API key? (Flow editing, code viewing, etc.)

5. **Flow debugging** — Beyond the animated view, should there be breakpoints, step-through execution, variable inspection for flows?

6. **Licensing** — Open source? Source-available? Proprietary? Impacts community adoption and the flow registry.

7. **Installer/packaging** — How to bundle Node.js with the Tauri app? Or require it as a system dependency?
