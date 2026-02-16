<p align="center">
  <img src="ArchonLogo.png" alt="ArchonIDE Logo" width="180" />
</p>

<h1 align="center">ArchonIDE</h1>

<p align="center">
  <strong>The IDE where you don't just use AI agents &mdash; you command them.</strong>
</p>

<p align="center">
  <em>
    From the Greek <strong>ἄρχων</strong> (arkhon) &mdash; ruler, commander, one who leads the way.<br/>
    Sharing a root with <strong>architect</strong> (arkhi + tekton: "master builder"),<br/>
    Archon puts you in command of your AI agents &mdash; their strategies, their tools, their decisions.
  </em>
</p>

<p align="center">
  <a href="#features">Features</a> &bull;
  <a href="#architecture">Architecture</a> &bull;
  <a href="#getting-started">Getting Started</a> &bull;
  <a href="#project-structure">Project Structure</a> &bull;
  <a href="#development">Development</a> &bull;
  <a href="#tech-stack">Tech Stack</a> &bull;
  <a href="#roadmap">Roadmap</a>
</p>

---

In ancient Athens, the Archon was the chief magistrate &mdash; the one who directed how the city operated, not the one who did every job themselves. ArchonIDE applies the same principle to AI-assisted development: **you design the strategy, the agents execute it.**

ArchonIDE is an **AI agent-first IDE** with a visual agentic flow designer. Built as a Tauri v2 desktop application with a React frontend and the Claude Agent SDK, it transforms AI-assisted coding from opaque and one-size-fits-all into transparent, composable, and deeply customizable.

Current AI-powered IDEs operate as black boxes with fixed agent loops. ArchonIDE changes that by giving developers a visual canvas to design and command the exact agent workflows that power their coding &mdash; different flows for bug fixes, greenfield features, code reviews, and refactors. Every decision the AI makes is visible, editable, and shareable. You are the Archon.

---

## Features

### Visual Agentic Flow Designer

A full-featured node graph editor (powered by React Flow) where developers design agent workflows by wiring together specialized nodes. Flows are the core abstraction &mdash; they define how AI agents process tasks, what tools they can use, when to involve a human, and how to route between different models.

**16 node types** across 6 categories:

| Category | Nodes | Purpose |
|----------|-------|---------|
| **AI** | LLM, Intent, Evaluator | Model invocation, intent classification, quality gates |
| **Execution** | Tool, Transformer | Deterministic tool runs, data transformation |
| **Control Flow** | Router, Parallel, Join, Human Review, Sub-flow | Branching, concurrency, human-in-the-loop, composition |
| **Context** | Memory, Handoff, Project Context | State management, context curation, file loading |
| **Structure** | Start, End | Flow entry and exit points |
| **Integration** | ADO PR Read, ADO PR Write, Webhook Trigger, Webhook Response | External service integration, webhook handling |

Every node type has a dedicated configuration panel &mdash; model selection, system prompts, tool assignments, edge signal routing, and more. Flows serialize to SQLite and can be exported as JSON for sharing.

### AI Chat Interface

A polished, developer-centric chat panel with:

- **Streaming responses** &mdash; character-by-character text delivery with live syntax highlighting in code blocks
- **Tool call cards** &mdash; collapsible cards for every tool invocation (Read, Write, Edit, Bash, Glob, Grep, WebSearch, WebFetch) with smart summaries, inline diffs, and ANSI-rendered terminal output
- **Three density modes** &mdash; Minimal, Normal, and Verbose, toggled via `Ctrl+1/2/3`
- **Thinking indicators** &mdash; visible reasoning blocks when extended thinking is enabled
- **Professional icon system** &mdash; Lucide icons with distinct accent colors per tool type (no emojis)
- **Multi-provider support** &mdash; Anthropic API (Claude Agent SDK), OpenRouter, and Claude Code CLI as AI providers
- **Context menu** &mdash; copy, retry, and message management

### Flow Execution Engine

Flows are executable &mdash; the visual graph translates directly into agent orchestration:

- **Node-by-node execution** with real-time status updates over WebSocket
- **Conditional routing** via Router and Intent nodes with typed edge signals (success/fail/score)
- **Parallel execution** with fork/join semantics
- **Human Review gates** that pause execution and present a modal for approval
- **Sub-flow embedding** for composable, reusable workflows
- **Per-node working directory** and tool preset configuration (no tools / read-only / full access)
- **Live animated flow visualization** &mdash; nodes pulse during execution, results appear on completion

### Context Agent Architecture

An orchestration layer (configurable per flow) that serves as the brain of each workflow:

- **Intent classification** &mdash; categorizes user messages (feature, bug fix, question, approval)
- **Complexity-based model routing** &mdash; Opus for complex tasks, Sonnet for medium, Haiku for simple
- **Curated briefing generation** &mdash; creates focused context packages for downstream agents, achieving up to 73% token reduction vs. raw history
- **Structured state tracking** &mdash; maintains a JSON state object with task status, file summaries, decisions, and errors
- **Cross-session memory** &mdash; persists session state for contextual continuity across conversations
- **Direct execution** &mdash; handles simple tasks directly instead of routing to more expensive models

### Context Management View

A dedicated debugging dashboard (4th tab in the execution panel) providing full transparency into context window state:

- **Token usage visualization** &mdash; progress bar showing context window fullness percentage
- **Composition chart** &mdash; color-coded breakdown of where tokens are consumed (system prompt, briefing, tools, conversation, files)
- **Briefing diff view** &mdash; shows what the Context Agent included vs. excluded, with compression ratios
- **Budget warnings** &mdash; yellow at 75%, red at 90% context utilization
- **Per-node drill-down** &mdash; structured breakdown or raw message inspection for each LLM invocation

### Gateway & Tunnel System

Extends ArchonIDE into a reachable endpoint so external systems can trigger flows:

- **Pluggable tunnel providers** &mdash; ngrok (official SDK), Cloudflare (`cloudflared`), or custom commands
- **Webhook system** &mdash; URL-based routing (`/webhooks/<flowId>/<token>`) where any system that can POST JSON (Azure DevOps, GitHub, Jenkins, etc.) can trigger a flow
- **Webhook response builder** &mdash; flows can construct and return structured JSON responses to callers
- **Fastify HTTP gateway** bound to `127.0.0.1:9400` with bearer token authentication and rate limiting
- **Channel adapters** (planned) &mdash; Telegram (Telegraf) and Discord (discord.js) bot integration
- **Gateway dashboard** &mdash; dedicated sidebar tab with tunnel status, webhook management, connection logs, and a built-in testing playground
- **System tray mode** &mdash; minimize to tray so the gateway stays alive in the background

### AI-Powered Flow Creation

The AI can create, read, update, and delete flows through natural language:

- Five custom MCP tools (`create_flow`, `get_flow`, `list_flows`, `update_flow`, `delete_flow`) exposed to the Claude Agent SDK
- Full schema validation via Zod &mdash; the AI knows all 16 node types and their configurations
- Patch-style updates for efficient modification (add/remove/update nodes and edges)
- Auto-layout via dagre for clean graph positioning
- Version history with undo support (last 50 snapshots per flow)
- Preview rendered inline in the chat panel using the FlowExecutionDiagram component

### Git Management

Integrated source control panel:

- Stage/unstage individual files or all changes
- Commit with user-written or AI-generated messages
- Push, pull, branch switching, and branch creation
- Real-time file system watching with smart debounce (chokidar + simple-git)
- Diff viewing in the CodeViewer
- Status bar integration showing branch, ahead/behind count, and dirty file count
- Right-click git actions in the File Tree

### Azure DevOps Integration

Two dedicated flow nodes for AI-powered PR code reviews:

- **ADO PR Read** &mdash; fetches comprehensive PR data (diffs, metadata, comments, work items, build status, reviewers, iterations) from Azure DevOps
- **ADO PR Write** &mdash; posts inline code comments, summary reviews, and vote status back to PRs
- **Node schema system** &mdash; downstream nodes declare input schemas (via Zod) that are auto-injected into upstream LLM prompts, ensuring correctly structured output
- Incremental iteration tracking for re-review workflows
- Human approval safety gate before posting comments

### Project Context System

Three layers for giving AI agents access to project files:

1. **Agent Tool Access** &mdash; working directory and tool presets passed to every SDK query
2. **Project Context Node** &mdash; file picker + glob patterns with token budget and .gitignore-aware filtering, injected into LLM system prompts
3. **Auto-Context** &mdash; CLAUDE.md auto-detection, configurable default project overview

### Community Flow Registry

A GitHub-based registry for sharing and discovering custom agent flows:

- Browse, search, and install flows from the Registry sidebar tab
- One-click publishing with automatic pull request creation
- Flow metadata with tags, descriptions, and tech stack labels
- Hosted at a separate `community-repo` with standardized `flow.json` format

### Additional Features

- **File Tree Panel** &mdash; directory browser with open-folder dialog and file selection
- **Code Viewer** &mdash; syntax-highlighted read-only viewer with diff display mode
- **Dockable Layout** &mdash; draggable, resizable panels via dockview-react with layout persistence
- **Custom Titlebar** &mdash; frameless window with integrated navigation and window controls
- **Dark Theme** &mdash; professional dark UI throughout
- **Settings Panel** &mdash; API key management (Anthropic, OpenRouter, Azure DevOps), model selection, provider configuration
- **BYOK (Bring Your Own Key)** &mdash; API keys stored securely via `tauri-plugin-store`
- **Sidecar Health Monitoring** &mdash; connection status indicator with auto-reconnect

---

## Architecture

```
+------------------+       WebSocket (localhost:9399)  +------------------------+
|   Tauri v2 App   |  <----------------------------->  |   Node.js Sidecar      |
|                  |                                    |                        |
|  [React Frontend]|   JSON messages:                   |  [Agent Manager]       |
|  - Flow Designer |   - start/stop agent               |  - Concurrent agents   |
|  - Chat Panel    |   - streamed agent output           |    via async/await     |
|  - Code Viewer   |   - flow execution events           |  - Claude Agent SDK    |
|  - Gateway Panel |   - permission requests             |  - OpenRouter / CLI    |
|  - Git Panel     |   - tool results                    |  - Built-in tools      |
|  - Registry      |   - gateway events                  |  - MCP servers         |
|                  |                                    |  - Flow engine         |
|  [Rust Backend]  |                                    |  [Gateway]             |
|  - System tray   |   HTTP (localhost:9400)             |  - Fastify server      |
|  - SQLite (DB)   |  <----------------------------->   |  - Tunnel manager      |
|  - FS permissions|   Webhook endpoints                 |  - Channel adapters    |
|  - Plugin system |                                    |  - Git manager         |
+------------------+                                    +------------------------+
```

### Three-Tier Model

1. **Tauri v2 Desktop Shell** (`app/src-tauri/`) &mdash; Lightweight Rust backend (~10MB binary vs Electron's ~150MB). Manages the native window, system tray with close-to-tray behavior, SQLite database, file system permissions, and secure credential storage. Plugins: shell, store, dialog, fs, sql.

2. **React Frontend** (`app/src/`) &mdash; Full-featured UI built with React 19, TypeScript 5, and Vite 6. Communicates with the sidecar over WebSocket. Key subsystems: flow designer (React Flow), chat panel, gateway dashboard, git panel, settings, file tree, code viewer, context view, and community registry.

3. **Node.js Sidecar** (`sidecar/src/`) &mdash; The agent runtime and backend logic layer. Runs as a standalone WebSocket server on port 9399 (plus Fastify HTTP gateway on 9400). Handles all AI interactions via the Claude Agent SDK, flow execution, gateway/tunnel management, git operations, and MCP server orchestration. Hot-reloads via `tsx watch`.

### Why This Architecture

- **Tauri v2** for native performance with a ~10MB binary footprint
- **Single Node.js process** handles 5-10 concurrent agent workflows via async/await (agent work is I/O-bound)
- **WebSocket IPC** enables bidirectional streaming for real-time agent output and debugging
- **Same-process flow execution** in the sidecar means zero IPC overhead for gateway-triggered flows
- **Per-agent directory isolation** via Git worktrees prevents file conflicts during parallel editing

---

## Getting Started

### Prerequisites

- **Node.js** 22.x LTS
- **Rust** toolchain (latest stable, for Tauri compilation)
- **Git** (system installation)
- **Anthropic API key** (get one at [console.anthropic.com](https://console.anthropic.com))

### Installation

```bash
# Clone the repository
git clone https://github.com/newtro/ArchonIDE.git
cd ArchonIDE

# Install dependencies (both app and sidecar)
cd app && npm install && cd ..
cd sidecar && npm install && cd ..
```

### Running in Development

The simplest way to start everything:

```powershell
# PowerShell (Windows)
.\start.ps1
```

This script:
1. Kills any existing processes on ports 9399 (sidecar) and 1420 (Vite)
2. Installs dependencies if `node_modules` is missing
3. Starts the sidecar with `npx tsx watch src/index.ts` (hot-reloading)
4. Starts Tauri dev mode with `npx tauri dev` (Vite HMR + Rust compilation)

Or start each component manually:

```bash
# Terminal 1: Start the sidecar
cd sidecar && npx tsx watch src/index.ts

# Terminal 2: Start the Tauri app (Vite + Rust)
cd app && npx tauri dev
```

### First-Time Setup

1. Launch the app &mdash; the sidecar WebSocket connects automatically
2. Open **Settings** (gear icon in the sidebar)
3. Enter your Anthropic API key (stored securely via OS credential storage)
4. Open a project folder via the **File Tree** panel
5. Start chatting or design a flow in the **Flow Designer**

---

## Project Structure

```
ArchonIDE/
|-- app/                          # Tauri v2 desktop application
|   |-- src/                      # React frontend source
|   |   |-- App.tsx               # Root component with sidebar navigation
|   |   |-- main.tsx              # React entry point
|   |   |-- components/
|   |   |   |-- chat/             # Chat panel, messages, tool cards, input
|   |   |   |-- files/            # File tree browser, code viewer
|   |   |   |-- flow/             # Flow designer, canvas, execution panel
|   |   |   |   |-- config/       # 24 node configuration panels
|   |   |   |   |-- nodes/        # BaseNode visual component
|   |   |   |-- gateway/          # Gateway dashboard, tunnel status, webhooks
|   |   |   |-- git/              # Git management panel
|   |   |   |-- layout/           # Titlebar, sidebar, status bar, dockview
|   |   |   |-- logs/             # Debug log viewer
|   |   |   |-- registry/         # Community flow registry browser
|   |   |   |-- settings/         # API keys, model config, provider setup
|   |   |   |-- startup/          # Welcome/loading screen
|   |   |   |-- ui/               # Shared UI primitives
|   |   |-- contexts/             # React contexts (AppState, Density, Dockview, Workspace)
|   |   |-- hooks/                # Custom hooks (WebSocket, flow execution, health, context view)
|   |   |-- lib/                  # Utilities and types
|   |   |   |-- flow-types.ts     # All node/edge/flow type definitions (22KB)
|   |   |   |-- flow-storage.ts   # SQLite CRUD for flows
|   |   |   |-- types.ts          # WebSocket message types, app-wide interfaces
|   |   |   |-- chat-storage.ts   # Chat session persistence
|   |   |   |-- github-api.ts     # GitHub API for community registry
|   |   |   |-- flow-layout.ts    # Dagre auto-layout
|   |   |   |-- default-flows.ts  # Seed flow definitions
|   |   |-- styles/               # Global CSS
|   |-- src-tauri/                # Rust backend
|   |   |-- src/
|   |   |   |-- lib.rs            # Tauri setup: plugins, tray, commands
|   |   |   |-- main.rs           # Entry point
|   |   |-- Cargo.toml            # Rust dependencies
|   |   |-- tauri.conf.json       # App config (window, CSP, plugins)
|   |   |-- icons/                # App icons
|   |-- package.json              # Frontend dependencies
|
|-- sidecar/                      # Node.js agent runtime
|   |-- src/
|   |   |-- index.ts              # WebSocket server entry (port 9399)
|   |   |-- agent.ts              # Claude Agent SDK integration (58KB)
|   |   |-- flow-engine.ts        # Flow execution engine (74KB)
|   |   |-- flow-tools.ts         # MCP tools for AI flow CRUD
|   |   |-- flow-types.ts         # Sidecar flow type definitions
|   |   |-- context-agent.ts      # Context Agent orchestrator
|   |   |-- context-loader.ts     # File reading, glob matching, token counting
|   |   |-- context-state.ts      # Structured state tracking
|   |   |-- session-store.ts      # Cross-session memory persistence
|   |   |-- token-counter.ts      # Token estimation utilities
|   |   |-- tool-executor.ts      # Tool execution handlers
|   |   |-- mcp-manager.ts        # MCP server lifecycle management
|   |   |-- git-manager.ts        # Git operations (simple-git + chokidar)
|   |   |-- ado-client.ts         # Azure DevOps API client
|   |   |-- claude-code-runner.ts # Claude Code CLI provider
|   |   |-- openrouter-runner.ts  # OpenRouter API provider
|   |   |-- worktree-manager.ts   # Git worktree isolation for parallel agents
|   |   |-- gateway/
|   |   |   |-- gateway-manager.ts   # Gateway lifecycle, flow cache, WS broadcast
|   |   |   |-- http-gateway.ts      # Fastify server, webhook routing
|   |   |   |-- types.ts             # Gateway type definitions
|   |   |   |-- tunnel/              # Tunnel provider implementations
|   |   |   |-- channels/            # Channel adapter implementations
|   |-- package.json              # Sidecar dependencies
|
|-- docs/                         # Design documents and plans
|   |-- archon-ide-plan.md        # Master implementation plan (source of truth)
|   |-- gateway-tunnel-plan.md    # Gateway & tunnel system spec
|   |-- project-context-plan.md   # Project context system spec
|   |-- ai-flow-creation-plan.md  # AI flow CRUD tools spec
|   |-- context-view-plan.md      # Context management view spec
|   |-- git-management-plan.md    # Git panel spec
|   |-- ado-pr-review-nodes-plan.md  # Azure DevOps integration spec
|   |-- Sample Agentic loop.md    # Context Agent example walkthrough
|
|-- community-repo/               # Community flow registry (Git submodule)
|   |-- flows/                    # Contributed flow definitions
|   |-- schema/                   # Flow JSON schema
|   |-- README.md
|
|-- start.ps1                     # Development startup script (PowerShell)
|-- start.bat                     # Development startup script (CMD wrapper)
|-- ArchonLogo.png                # Project logo
|-- ArchonIDE.code-workspace      # VS Code workspace file
```

---

## Development

### Build Commands

```bash
# Frontend type checking
cd app && npx tsc --noEmit

# Frontend production build
cd app && npx vite build

# Sidecar type checking
cd sidecar && npx tsc --noEmit

# Rust compilation check
cd app/src-tauri && cargo check

# Full Tauri build (production binary)
cd app && npx tauri build
```

### Hot Reloading

Both the frontend and sidecar support hot reloading during development:

- **Frontend**: Vite HMR &mdash; changes to React components apply instantly
- **Sidecar**: `tsx watch` &mdash; TypeScript source is executed directly (no compilation step), restarts on file changes

There is no need to manually compile the sidecar during development. The `tsx watch` process monitors `sidecar/src/` and reloads automatically.

### WebSocket Protocol

The frontend and sidecar communicate over a bidirectional WebSocket connection on port 9399. Messages are JSON-encoded with a `type` field for routing.

**Key message categories:**

| Category | Examples | Direction |
|----------|----------|-----------|
| Chat | `chat`, `chat_response`, `chat_stream_*` | Both |
| Flow execution | `execute_flow`, `flow_node_*`, `flow_complete` | Both |
| Flow CRUD (AI) | `flow_tool_create`, `flow_tool_response` | Both |
| Gateway | `gateway` (wraps actions), `gateway_event` | Both |
| Git | `git_status`, `git_commit`, `git_status_update` | Both |
| Settings | `update_settings`, `settings_response` | Both |
| Project | `set_project_root`, `open_file` | Frontend -> Sidecar |
| Agent events | `agent_event`, `human_review_*` | Sidecar -> Frontend |

### Database

SQLite via `tauri-plugin-sql`, accessed from the frontend. Schema initialized on first run with a seed "General Coding Assistant" flow.

**Tables:** `flows`, `flow_nodes`, `flow_edges`, `flow_versions`, `chat_sessions`, `chat_messages`

---

## Tech Stack

### Frontend (`app/`)

| Technology | Version | Purpose |
|-----------|---------|---------|
| React | 19.x | UI framework |
| TypeScript | 5.7 | Type safety |
| Vite | 6.x | Build tool and dev server |
| @xyflow/react | 12.10.0 | Visual node graph editor (flow designer) |
| dockview-react | 4.13.1 | Dockable, resizable panel layout |
| lucide-react | 0.469.0 | Professional icon library |
| react-markdown | 10.1.0 | Markdown rendering in chat |
| remark-gfm | 4.0.1 | GitHub-Flavored Markdown support |
| qrcode.react | 4.2.0 | QR code generation (bot setup) |
| @dagrejs/dagre | 2.0.4 | Automatic graph layout for flows |
| @tauri-apps/api | 2.2.0 | Tauri IPC bridge |
| @tauri-apps/plugin-sql | 2.3.2 | SQLite access |
| @tauri-apps/plugin-store | 2.4.2 | Secure key-value storage |
| @tauri-apps/plugin-dialog | 2.6.0 | Native file/folder dialogs |
| @tauri-apps/plugin-fs | 2.4.5 | File system access |
| @tauri-apps/plugin-shell | 2.2.0 | Process management |

### Sidecar (`sidecar/`)

| Technology | Version | Purpose |
|-----------|---------|---------|
| @anthropic-ai/claude-agent-sdk | 0.2.39 | Agent orchestration, tool execution, LLM interaction |
| @anthropic-ai/sdk | 0.74.0 | Anthropic API client |
| openai | 4.104.0 | OpenRouter API compatibility layer |
| ws | 8.18.0 | WebSocket server |
| fastify | 5.7.4 | HTTP gateway server |
| @ngrok/ngrok | 1.7.0 | Tunnel provider (programmatic SDK) |
| cloudflared | 0.7.1 | Cloudflare tunnel provider |
| simple-git | 3.30.0 | Git CLI wrapper |
| chokidar | 5.0.0 | File system watcher |
| azure-devops-node-api | 15.1.2 | Azure DevOps REST API client |
| discord.js | 14.25.1 | Discord bot (channel adapter) |
| telegraf | 4.16.3 | Telegram bot (channel adapter) |
| zod | 4.3.6 | Schema validation (flow tools, node schemas) |
| glob | 11.1.0 | File pattern matching |
| tsx | 4.19.0 | TypeScript execution (dev) |

### Rust Backend (`app/src-tauri/`)

| Technology | Version | Purpose |
|-----------|---------|---------|
| Tauri | 2.x | Desktop app framework |
| tauri-plugin-shell | 2.x | Sidecar process management |
| tauri-plugin-store | 2.4.2 | Encrypted credential storage |
| tauri-plugin-dialog | 2.6.0 | Native dialogs |
| tauri-plugin-fs | 2.4.5 | File system access with scoping |
| tauri-plugin-sql | 2.3.2 | SQLite with migrations |
| serde / serde_json | 1.x | Serialization |

---

## Node Type Reference

### AI Nodes

| Node | Description | Key Config |
|------|-------------|------------|
| **LLM** | Invoke an LLM with autonomous tool access. The core execution node. | Model (Haiku/Sonnet/Opus), system prompt, temperature, max tokens, tool preset, working directory, enable thinking |
| **Intent** | Classify user intent to route execution paths. | Intent categories (custom labels), classification prompt |
| **Evaluator** | Quality gate &mdash; score and validate output against criteria. | Evaluation criteria, pass/fail thresholds, scoring rubric |

### Execution Nodes

| Node | Description | Key Config |
|------|-------------|------------|
| **Tool** | Execute a deterministic tool (run tests, lint, deploy). Mandatory quality gate between LLM nodes. | Tool command, working directory, timeout |
| **Transformer** | Transform data without an LLM call (format conversion, template rendering). | Transform type, template, extraction rules |

### Control Flow Nodes

| Node | Description | Key Config |
|------|-------------|------------|
| **Router** | Route execution based on rules or LLM classification. | Routing conditions per output, default route |
| **Parallel** | Fork into concurrent branches. All branches execute simultaneously. | Branch definitions |
| **Join** | Merge results from parallel branches. | Merge strategy |
| **Human Review** | Pause execution for human approval or input. | Review prompt, approval options |
| **Sub-flow** | Embed another flow as a nested step. | Referenced flow ID |

### Context Nodes

| Node | Description | Key Config |
|------|-------------|------------|
| **Memory** | Read/write to structured state or vector store. | Memory keys, read/write mode |
| **Handoff** | Transfer curated context between LLM nodes. | Briefing template, included/excluded fields |
| **Project Context** | Load project files into agent context. | File picker, glob patterns, token budget, .gitignore filtering, output format |

### Structure Nodes

| Node | Description | Key Config |
|------|-------------|------------|
| **Start** | Flow entry point. Receives user input. | Input schema |
| **End** | Flow exit point. Returns final result. | Output format |

### Integration Nodes

| Node | Description | Key Config |
|------|-------------|------------|
| **ADO PR Read** | Fetch PR data from Azure DevOps. | Project, repository, iteration tracking |
| **ADO PR Write** | Post review comments and votes to Azure DevOps PRs. | Human approval gate, vote setting, inline comments, thread status |
| **Webhook Trigger** | Flow entry point for webhook-initiated execution. | Endpoint path, authentication token |
| **Webhook Response** | Construct HTTP response for webhook callers. | Status code, headers, response body template |

---

## Roadmap

### Completed

- **Phase 1: Foundation** &mdash; Tauri scaffold, WebSocket IPC, chat interface, BYOK API keys, file tree, code viewer
- **Phase 2: Flow Designer** &mdash; React Flow canvas, all node types, SQLite persistence, node configuration panels, edge signals, default flows
- **Phase 3A: Gateway Foundation** &mdash; Fastify gateway, tunnel providers, webhook system, gateway sidebar tab, flow execution wiring

### In Progress

- **Phase 3: Flow Execution Engine** &mdash; Full flow runtime, Context Agent implementation, parallel execution, sub-flow embedding, animated flow visualization

### Planned

- **Phase 3B: Channel Adapters** &mdash; Telegram and Discord bot integration, message bus, slash commands
- **Phase 3C: Advanced Gateway** &mdash; Cloudflare tunnel, custom tunnel commands, webhook testing playground, system tray persistence
- **Phase 4: Polish & Quality** &mdash; Dynamic workspace presets, log stream panel, MCP server discovery, cross-session memory, Git worktree isolation, error recovery, flow import/export
- **Phase 5: Community** &mdash; Community Flow Registry public launch, browse/install/publish flows, ratings and categories

---

## Design Philosophy

1. **No black boxes** &mdash; Every agent decision is visible. The Context View shows token usage, briefing diffs, routing decisions. The animated flow view shows real-time execution progress.

2. **Composable by default** &mdash; Flows are the universal abstraction. A bug fix flow is different from a feature flow is different from a code review flow. Build once, reuse and share.

3. **Developer-centric UI** &mdash; Professional design with Lucide icons (no emojis). Tool calls show file paths, line counts, execution times, and token costs. Three density modes let developers choose their information level.

4. **BYOK-first** &mdash; Your API keys, your data, your machine. No proxy servers, no middlemen. All API calls go directly to providers.

5. **Desktop-native** &mdash; Tauri v2 delivers a ~10MB binary with native OS integration (system tray, file dialogs, keychain). Not a web app in a browser tab.

---

## License

TBD

---

<p align="center">
  Built with Tauri, React, and the Claude Agent SDK
</p>
