# Git Management Panel for ArchonIDE

## 1. Vision

Add an integrated Git management panel to ArchonIDE that provides core source control operations (stage, commit, push, pull, branch management) directly within the IDE. Unlike a basic Git GUI wrapper, this feature leverages ArchonIDE's AI-first architecture to provide intelligent commit message generation and expose git state as context for agent conversations — making source control a first-class citizen of the agentic workflow.

## 2. Goals & Non-Goals

### MVP Goals
- Stage/unstage individual files or all changes
- Commit with user-written or AI-generated messages
- Push to and pull from remote repositories
- Switch branches and create new branches
- View paginated commit history with branch/tag labels
- Real-time status updates via file system watching
- View diffs in the existing CodeViewer component
- Initialize new repos from non-git directories
- Status bar showing branch name, ahead/behind count, dirty file count
- Right-click git actions in the File Tree panel
- Remote management (view/add/remove remotes, set upstream)

### Non-Goals (for MVP)
- Merge conflict resolution UI (show error output only; dedicated UX is a follow-up)
- Git graph / branch visualization (text-based log only)
- Interactive rebase or commit editing UI
- Submodule management
- Git LFS support
- Multi-repo / workspace support

## 3. Architecture Overview

Git management plugs into the existing three-tier architecture:

```
┌─────────────────────────────────────────────────────┐
│  Frontend (React)                                   │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────────┐│
│  │ GitPanel  │ │ StatusBar│ │ FileTree (context menu││
│  │ (sidebar) │ │ (git info)│ │  + git actions)     ││
│  └─────┬─────┘ └────┬─────┘ └──────────┬──────────┘│
│        │             │                  │            │
│        └─────────────┴──────────────────┘            │
│                      │ WebSocket (port 9399)         │
├──────────────────────┼──────────────────────────────┤
│  Sidecar (Node.js)   │                              │
│  ┌───────────────────┴─────────────────────────┐    │
│  │ git-manager.ts                               │    │
│  │ - simple-git wrapper                         │    │
│  │ - File watcher (chokidar)                    │    │
│  │ - Smart debounce (500ms → 3s adaptive)       │    │
│  │ - Status/diff/log/branch operations          │    │
│  └──────────────────┬──────────────────────────┘    │
│                     │ child_process (git CLI)        │
├─────────────────────┼──────────────────────────────┤
│  OS / Git CLI       │                              │
│  - System git installation                          │
│  - SSH keys / credential helpers                    │
│  - Stored GitHub token (HTTPS fallback)             │
└─────────────────────────────────────────────────────┘
```

### Why Sidecar (not Tauri Rust)
- Consistent with existing tool execution pattern
- Hot-reloadable via tsx watch (no app restart for changes)
- Parsing git output is far easier in TypeScript
- `globalProjectRoot` already set as CWD in sidecar

## 4. Components

### 4.1 Sidecar: `git-manager.ts`

Central module for all git operations. Uses `simple-git` as a typed wrapper around the git CLI.

**Core responsibilities:**
- Execute git commands via simple-git (`status`, `log`, `diff`, `add`, `commit`, `push`, `pull`, `branch`, `checkout`, `remote`)
- Watch file system with chokidar for change detection
- Smart debounce: start at 500ms; if `git status` takes >1s, increase debounce to 3s
- Push status updates to frontend via WebSocket when changes detected
- Parse and structure output into typed responses

**Key functions:**
- `getStatus()` — returns structured status (branch, staged, unstaged, untracked files)
- `getDiff(filepath?)` — returns diff for a specific file or all changes
- `getLog(page, pageSize)` — returns paginated commit log with branch/tag decorations
- `getBranches()` — returns local and remote branches with current branch indicator
- `stage(files)` / `unstage(files)` — stage or unstage specific files
- `commit(message)` — create a commit
- `push(remote?, branch?)` / `pull(remote?, branch?)` — sync with remote
- `checkout(branch)` / `createBranch(name)` — branch management
- `getRemotes()` / `addRemote(name, url)` / `removeRemote(name)` — remote management
- `init()` — initialize a new repository
- `startWatching()` / `stopWatching()` — file watcher lifecycle

### 4.2 WebSocket Protocol Extension

New message types added to `WSMessageToSidecar`:

```typescript
| { type: "git_status" }
| { type: "git_diff"; file?: string }
| { type: "git_log"; page: number; pageSize: number }
| { type: "git_branches" }
| { type: "git_stage"; files: string[] }
| { type: "git_unstage"; files: string[] }
| { type: "git_commit"; message: string }
| { type: "git_push"; remote?: string; branch?: string }
| { type: "git_pull"; remote?: string; branch?: string }
| { type: "git_checkout"; branch: string }
| { type: "git_create_branch"; name: string; startPoint?: string }
| { type: "git_remotes" }
| { type: "git_add_remote"; name: string; url: string }
| { type: "git_remove_remote"; name: string }
| { type: "git_init" }
| { type: "git_generate_commit_msg" }
```

New message types added to `WSMessageFromSidecar`:

```typescript
| { type: "git_status_response"; data: GitStatusData }
| { type: "git_diff_response"; data: string }
| { type: "git_log_response"; data: GitLogData }
| { type: "git_branches_response"; data: GitBranchData }
| { type: "git_remotes_response"; data: GitRemoteData }
| { type: "git_commit_msg_response"; message: string }
| { type: "git_error"; error: string; command: string }
| { type: "git_status_update"; data: GitStatusData }  // pushed by file watcher
| { type: "git_operation_complete"; operation: string; success: boolean }
```

### 4.3 Frontend: `GitPanel.tsx`

New sidebar panel at `app/src/components/git/`. Added as 8th entry in Sidebar `NAV_ITEMS`.

**Subcomponents:**
- `GitPanel.tsx` — Main container, orchestrates subcomponents
- `GitStatusSection.tsx` — Branch name, ahead/behind badges, staged/unstaged/untracked file lists
- `StagingArea.tsx` — File list with stage/unstage toggles, "Stage All" / "Unstage All" buttons
- `CommitSection.tsx` — Commit message textarea, "Generate" button (AI), "Commit" button
- `BranchSelector.tsx` — Dropdown for switching branches, "New Branch" action
- `CommitHistory.tsx` — Paginated commit log with branch/tag labels, click to view diff
- `RemoteManager.tsx` — View/add/remove remotes, set upstream

**State flow:**
1. Panel mounts → sends `git_status` message
2. Sidecar responds with `git_status_response`
3. File watcher pushes `git_status_update` when files change
4. User actions (stage, commit, etc.) send commands, receive responses
5. After mutations (commit, push), auto-refresh status

### 4.4 File Watcher

Runs in the sidecar, watching the project root directory.

**Behavior:**
- Watches all files except `.git/` directory internals (only watch `.git/HEAD` and `.git/index` for branch/stage changes)
- Ignores `node_modules/`, `dist/`, `target/`, and other common build directories
- Smart debounce: measures `git status` execution time and adapts
  - If `git status` < 1s → 500ms debounce
  - If `git status` >= 1s → 3s debounce
- On change detected: run `git status`, push `git_status_update` to all connected WebSocket clients
- Starts when project root is set, stops when project changes or app closes

## 5. UI Design

### 5.1 Git Panel Layout

```
┌─ Git ──────────────────────────┐
│ ⊙ main  ↑2 ↓0   [↻ Refresh]  │  ← Branch + ahead/behind + refresh
│────────────────────────────────│
│ Staged Changes (3)    [− All]  │  ← Collapsible section
│  M  src/App.tsx         [−]    │  ← Status icon + filename + unstage
│  A  src/utils/new.ts    [−]    │
│  D  src/old.ts          [−]    │
│────────────────────────────────│
│ Changes (5)            [+ All] │  ← Collapsible section
│  M  src/index.ts        [+]   │  ← Click file → open diff in viewer
│  M  src/lib/api.ts      [+]   │
│  ?  src/temp.log        [+]   │  ← Untracked
│  ...                           │
│────────────────────────────────│
│ ┌────────────────────────────┐ │
│ │ Commit message...          │ │  ← Textarea
│ │                            │ │
│ └────────────────────────────┘ │
│ [✦ Generate]    [✓ Commit]     │  ← AI generate + commit buttons
│────────────────────────────────│
│ [↑ Push]  [↓ Pull]  [⊙ Branch]│  ← Action buttons
│────────────────────────────────│
│ Recent Commits                 │
│  a1b2c3d  Fix auth bug    2h  │  ← Hash + message + relative time
│  e4f5g6h  Add login page  1d  │
│  i7j8k9l  Initial commit  3d  │
│  [Load more...]                │  ← Pagination
└────────────────────────────────┘
```

### 5.2 Status Bar Integration

Add git info to the existing `StatusBar.tsx`:

```
[⊙ main] [↑2 ↓0] [3 changes]  |  ... existing status bar content ...
```

- Branch name (clickable → opens branch selector)
- Ahead/behind remote count
- Number of dirty files
- Always visible regardless of active panel

### 5.3 File Tree Context Menu

Add git actions to right-click context menu in `FileTreePanel.tsx`:

- **Stage** / **Unstage** (depending on current state)
- **Discard Changes** (with confirmation)
- **View Diff** (opens in CodeViewer)
- Separator from existing file actions
- Only shown for files with git changes (check status)

### 5.4 CodeViewer Diff Mode

Extend the existing CodeViewer to support a diff display mode:

- Unified diff view (not side-by-side for MVP)
- Added lines highlighted green, removed lines highlighted red
- Line numbers from both old and new versions
- File path and change type shown in header
- Navigate between changed files with prev/next buttons

## 6. AI Integration

### 6.1 Commit Message Generation

When user clicks "Generate" in the commit section:

1. Frontend sends `git_generate_commit_msg` to sidecar
2. Sidecar collects:
   - `git diff --cached` (staged changes)
   - `git log --oneline -5` (recent commit style reference)
3. Sends to Claude (via existing agent infrastructure) with prompt:
   - "Based on these staged changes and recent commit message style, generate a concise commit message."
4. Returns generated message → pre-fills commit textarea
5. User edits as needed, then commits

### 6.2 Git Context for Agent Conversations

When the agent processes a user message, automatically include git context:

- Current branch name
- Number of staged/unstaged changes
- Summary of recent commits (last 3-5)
- If the user is discussing specific files, include their git status (modified, untracked, etc.)

This context is injected into the system prompt or tool context, not visible to the user but available to the agent. Enhances the agent's ability to give relevant advice about the codebase.

## 7. Tech Stack

| Package | Version | Purpose | Notes |
|---------|---------|---------|-------|
| `simple-git` | 3.30.0 | Git CLI wrapper | Typed API, avoids manual porcelain parsing |
| `chokidar` | 4.x or 5.0.0 | File system watcher | v5 is ESM-only (Node 20+); v4 for CJS compat |

**No additional Tauri plugins needed** — shell execution already enabled via `tauri-plugin-shell`.

**Authentication:**
- Primary: System git config (SSH keys, credential helpers, `.gitconfig`)
- Fallback: Stored GitHub token from ArchonIDE settings, configured as HTTPS credential for GitHub remotes

## 8. Implementation Phases

### Phase A: Foundation (git-manager + basic status)
1. Install `simple-git` and `chokidar` in sidecar
2. Create `sidecar/src/git-manager.ts` with core operations
3. Add git WebSocket message types to shared types
4. Wire git message handling into sidecar message dispatcher
5. Create `GitPanel.tsx` with basic status display (branch, file lists)
6. Add "git" to Sidebar `NAV_ITEMS` with GitBranch icon
7. Add case in `App.tsx` `renderMainContent()` for git view

### Phase B: Staging & Committing
1. Implement stage/unstage in git-manager and GitPanel
2. Build `CommitSection.tsx` with message textarea and commit button
3. Wire up commit flow (frontend → sidecar → git)
4. Add success/error feedback (toast or inline message)
5. Auto-refresh status after commit

### Phase C: Push, Pull & Branch Management
1. Implement push/pull in git-manager
2. Build `BranchSelector.tsx` with branch switching and creation
3. Add push/pull buttons to GitPanel
4. Implement authentication fallback (system → GitHub token)
5. Add remote management UI

### Phase D: File Watcher & Real-time Updates
1. Set up chokidar watcher in git-manager
2. Implement smart debounce logic
3. Push `git_status_update` messages to frontend on changes
4. Handle watcher lifecycle (start/stop on project change)
5. Ignore patterns (node_modules, dist, .git internals)

### Phase E: Diff Viewer & Commit History
1. Extend CodeViewer with unified diff display mode
2. Wire file clicks in GitPanel to open diff in viewer
3. Build `CommitHistory.tsx` with paginated log
4. Add branch/tag decoration to commit entries
5. Click commit → view its diff

### Phase F: AI Integration
1. Implement `git_generate_commit_msg` handler in sidecar
2. Collect staged diff + recent commit style, send to Claude
3. Wire "Generate" button in CommitSection
4. Add git context injection to agent conversation system prompt
5. Include git status in agent context when relevant

### Phase G: Polish & Integration
1. Add status bar git info to `StatusBar.tsx`
2. Add git context menu actions to `FileTreePanel.tsx`
3. Handle edge cases (no repo, no remote, detached HEAD, empty repo)
4. Loading states, error handling, and feedback throughout
5. "Initialize Repository" flow for non-git directories

## 9. Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Execution layer | Sidecar (Node.js) | Consistent with existing pattern, hot-reloadable, easier parsing |
| Git library | simple-git | Typed wrapper, avoids manual output parsing, well-maintained |
| File watching | chokidar + smart debounce | Reliable cross-platform watching; adaptive debounce handles small and large repos |
| Diff display | CodeViewer (existing) | Reuses infrastructure, keeps Git panel compact |
| Authentication | System-first, token fallback | Respects user's existing setup, covers HTTPS via stored token |
| AI integration | Full context | Commit message generation + git state in agent conversations |
| Conflict resolution | Out of scope (MVP) | Complex UX, deferred to dedicated follow-up |
| Refresh strategy | File watcher + on-demand | Most responsive UX without polling overhead |
| No-repo behavior | Show panel with "Init" button | Always accessible, guides user to initialize |

## 10. Open Questions

- **Diff library**: Should the CodeViewer use a dedicated diff rendering library (e.g., `diff2html`) or custom highlighting on raw diff output?
- **Git blame**: Worth including in a fast-follow phase?
- **Large file handling**: Should we detect and warn about files over a certain size being staged?
- **Multiple remotes**: How should push/pull behave when multiple remotes exist? Default to origin, or prompt?
- **Detached HEAD state**: What UX should the panel show when in detached HEAD?
- **Stash**: Should stash list/apply be included in the MVP or deferred?
