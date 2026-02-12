# Azure DevOps PR Review Nodes + Node Schema System

## Vision

Add two Azure DevOps integration nodes to ArchonIDE's flow designer — **ADO PR Read** and **ADO PR Write** — that together enable AI-powered pull request code reviews. An LLM node between them performs the actual review, while the ADO nodes handle data gathering and write-back. To support this, introduce a **node input/output schema system** that lets the flow engine automatically inject downstream node expectations into LLM prompts.

## Problem Statement

ArchonIDE's flow designer currently has no integration with external services. Code review is one of the most impactful AI-assisted workflows, but there's no way to pull PR context from Azure DevOps or post review results back. Additionally, when an LLM node sits between two typed integration nodes, there's no mechanism for it to know what output format the downstream node expects — requiring manual prompt engineering that's fragile and error-prone.

## Goals

- **ADO PR Read node**: Fetch comprehensive PR data (diffs, metadata, comments, work items, build status, iterations, policies, reviewers) from Azure DevOps and output structured JSON
- **ADO PR Write node**: Post inline code comments, overall review comments, and set vote status on Azure DevOps PRs
- **Node schema system**: Every node type declares optional input/output JSON schemas; the flow engine auto-injects the downstream node's `inputSchema` into LLM system prompts
- **Integration category**: New node category for external service integrations
- **Settings panel**: Azure DevOps PAT and org URL in global settings
- **Incremental iteration support**: Track last-reviewed PR iteration to enable re-review workflows

## Non-Goals

- **Webhook triggers**: The nodes are pull-based only (triggered by flow execution). Webhook-triggered flows are out of scope
- **OAuth / Entra ID auth**: PAT-only for MVP. OAuth can be added later
- **GitHub / Bitbucket support**: This plan is Azure DevOps only. The Integration category and schema system set the foundation for future providers
- **Diff size limits**: Full PR data is always fetched. The context agent orchestrator handles any trimming

---

## Architecture: Node Schema System

### Concept

Every node type can optionally declare an `inputSchema` and `outputSchema` using Zod schemas. When the flow engine executes an LLM node, it inspects the outgoing edges to find the next node(s). If any downstream node has an `inputSchema`, the engine serializes it to JSON Schema and appends instructions to the LLM's system prompt:

```
Your output MUST conform to the following JSON schema, as it will be consumed by
the next node ("[node label]", type: [node kind]):

{JSON Schema here}
```

### Type Definitions

Add to `flow-types.ts`:

```typescript
import { z } from 'zod';

// Schema declaration on node registry entries
export interface NodeSchemaDeclaration {
  inputSchema?: z.ZodType;   // What this node expects to receive
  outputSchema?: z.ZodType;  // What this node produces
}
```

Add `schemas?: NodeSchemaDeclaration` to each `NODE_REGISTRY` entry. Most existing nodes won't have schemas initially — the system is opt-in.

### Flow Engine Integration

In `flow-engine.ts`, before executing an LLM node:

1. Find all outgoing edges from this LLM node
2. For each target node, check if it has an `inputSchema` in the registry
3. If yes, convert the Zod schema to JSON Schema (using `zod-to-json-schema` or Zod's built-in `.toJsonSchema()` in Zod v4)
4. Append the schema instructions to the LLM's system prompt
5. After the LLM responds, optionally validate the output against the schema (log warnings but don't block execution)

### Sidecar Schema Awareness

The sidecar mirrors the schema declarations. Each node's execution handler can access its own input/output schema for validation. The schemas are defined once in a shared location and imported by both the frontend (for documentation/UI) and sidecar (for execution).

---

## Architecture: ADO PR Read Node

### Node Kind

`ado-pr-read`

### Category

**Integration** (new category, color: `#6366f1` indigo)

### Config Interface

```typescript
export interface AdoPrReadNodeConfig {
  /** Azure DevOps project name (static, set in config) */
  projectName: string;
  /** Repository name or ID within the project */
  repositoryName: string;
  /** Whether to track iterations for incremental reviews */
  trackIterations: boolean;
  /** Last reviewed iteration ID (managed by the node, not user-editable) */
  lastReviewedIteration?: number;
}
```

The **org URL** and **PAT** come from global settings (not per-node config).

### PR Number Input

The PR number comes dynamically from the upstream node's output (typically extracted from a chat message by the Start/LLM node). The node parses the upstream input to extract a numeric PR ID.

### API Calls (via `azure-devops-node-api` v15.1.1)

The node makes the following calls using the `IGitApi` client:

| Method | Data Retrieved |
|--------|---------------|
| `getPullRequest()` | PR metadata: title, description, author, status, source/target branches, merge status |
| `getPullRequestIterations()` | Iteration history (push events), used for incremental reviews |
| `getPullRequestIterationChanges()` | File changes per iteration (diffs) |
| `getThreads()` | Existing review comment threads with positions |
| `getPullRequestWorkItemRefs()` | Linked work items (user stories, bugs, tasks) |
| `getPullRequestCommits()` | Commit history on the PR |
| `getPullRequestStatuses()` | Build/pipeline status, policy evaluations |
| `getPullRequestReviewers()` | Reviewer assignments and vote status |

### Output Schema (Zod)

```typescript
const AdoPrReadOutput = z.object({
  pullRequest: z.object({
    id: z.number(),
    title: z.string(),
    description: z.string(),
    author: z.string(),
    status: z.string(),
    sourceBranch: z.string(),
    targetBranch: z.string(),
    createdDate: z.string(),
    mergeStatus: z.string(),
    isDraft: z.boolean(),
    url: z.string(),
  }),
  iterations: z.array(z.object({
    id: z.number(),
    description: z.string().optional(),
    createdDate: z.string(),
    sourceRefCommit: z.string(),
    targetRefCommit: z.string(),
    hasNewChanges: z.boolean(), // true if after lastReviewedIteration
  })),
  changes: z.array(z.object({
    filePath: z.string(),
    changeType: z.string(), // add, edit, delete, rename
    diff: z.string(), // unified diff content
    originalFilePath: z.string().optional(), // for renames
  })),
  threads: z.array(z.object({
    id: z.number(),
    status: z.string(),
    filePath: z.string().optional(),
    lineNumber: z.number().optional(),
    comments: z.array(z.object({
      author: z.string(),
      content: z.string(),
      publishedDate: z.string(),
    })),
  })),
  workItems: z.array(z.object({
    id: z.number(),
    title: z.string(),
    type: z.string(),
    url: z.string(),
  })),
  commits: z.array(z.object({
    commitId: z.string(),
    message: z.string(),
    author: z.string(),
    date: z.string(),
  })),
  buildStatus: z.array(z.object({
    context: z.string(),
    state: z.string(),
    description: z.string().optional(),
    targetUrl: z.string().optional(),
  })),
  reviewers: z.array(z.object({
    displayName: z.string(),
    vote: z.number(), // 10=approved, 5=approved with suggestions, 0=no vote, -5=waiting, -10=rejected
    isRequired: z.boolean(),
  })),
});
```

### Output Signals

| Signal | Condition |
|--------|-----------|
| `success` | PR data fetched successfully |
| `error` | API call failed (auth, network, permissions) |
| `no-changes` | PR has no file changes (empty diff) |
| `draft` | PR is in draft status |
| `merged` | PR is already merged |

### Incremental Iteration Support

When `trackIterations` is enabled:
1. On first run, fetch all iterations and store the latest iteration ID in `lastReviewedIteration`
2. On subsequent runs, compare iterations against `lastReviewedIteration`
3. Mark each iteration with `hasNewChanges: true/false`
4. Only include diffs from new iterations in the `changes` array
5. Update `lastReviewedIteration` after successful execution

---

## Architecture: ADO PR Write Node

### Node Kind

`ado-pr-write`

### Category

**Integration**

### Config Interface

```typescript
export interface AdoPrWriteNodeConfig {
  /** Require human approval before posting (default: true) */
  requireHumanApproval: boolean;
  /** Set vote status on the PR */
  setVote: boolean;
  /** Default vote value if setVote is true */
  defaultVote: 'approve' | 'approve-with-suggestions' | 'wait-for-author' | 'reject' | 'from-input';
  /** Post inline comments from the review */
  postInlineComments: boolean;
  /** Post an overall review summary comment */
  postSummaryComment: boolean;
  /** Comment thread status for new threads */
  threadStatus: 'active' | 'pending' | 'fixed' | 'closed';
  /** Project name (should match the Read node) */
  projectName: string;
  /** Repository name or ID */
  repositoryName: string;
}
```

### Input Schema (Zod) — what the upstream LLM node must produce

```typescript
const AdoPrWriteInput = z.object({
  /** PR number to write to (passed through from the Read node's output) */
  pullRequestId: z.number(),
  /** Overall review summary comment */
  summary: z.string().optional(),
  /** Vote decision */
  vote: z.enum(['approve', 'approve-with-suggestions', 'wait-for-author', 'reject', 'no-vote']).optional(),
  /** Inline comments on specific code lines */
  inlineComments: z.array(z.object({
    filePath: z.string(),
    lineStart: z.number(),
    lineEnd: z.number().optional(),
    content: z.string(),
    severity: z.enum(['info', 'warning', 'critical']).optional(),
  })).optional(),
});
```

This `inputSchema` is what the flow engine will inject into the upstream LLM node's system prompt, ensuring the LLM outputs correctly structured review data.

### API Calls

| Action | Azure DevOps API | Method |
|--------|-----------------|--------|
| Post inline comment | `createThread()` | Creates a `GitPullRequestCommentThread` with `threadContext` specifying file path and line range (`rightFileStart` / `rightFileEnd`) |
| Post summary comment | `createThread()` | Creates a thread with no `threadContext` (PR-level comment) |
| Set vote | `createPullRequestReviewer()` | Sets the authenticated user's vote on the PR |

### Thread Creation Details

For inline comments, the thread body looks like:
```json
{
  "comments": [{ "parentCommentId": 0, "content": "...", "commentType": 1 }],
  "status": 1,
  "threadContext": {
    "filePath": "/path/to/file.ts",
    "rightFileStart": { "line": 5, "offset": 1 },
    "rightFileEnd": { "line": 5, "offset": 1 }
  }
}
```

Vote values map: `approve` = 10, `approve-with-suggestions` = 5, `wait-for-author` = -5, `reject` = -10, `no-vote` = 0.

### Safety Gate

When `requireHumanApproval` is `true` (default):
- The node checks the flow execution state for a preceding Human Review node's approval
- If no approval is found, the node emits a `human_review_requested` event and pauses execution (same pattern as the existing Human Review node)
- The UI shows the proposed comments and vote for the user to approve/reject before posting

### Output Signals

| Signal | Condition |
|--------|-----------|
| `success` | All comments posted and vote set successfully |
| `partial` | Some comments posted but errors on others |
| `error` | API call failed entirely |
| `blocked` | Waiting for human approval |

---

## Integration Category

Add a new node category to the flow designer:

```typescript
// In NODE_CATEGORY map
'integration': { label: 'Integration', color: '#6366f1' }
```

SVG icon: a plug/connection icon. Initial nodes: `ado-pr-read`, `ado-pr-write`.

This category is designed to grow — future nodes for GitHub, Jira, Slack, etc. would live here.

---

## Settings Panel Changes

Add an **Azure DevOps** section to the existing Settings panel (alongside the Anthropic and OpenRouter API key sections):

| Field | Type | Description |
|-------|------|-------------|
| Organization URL | text input | e.g., `https://dev.azure.com/myorg` |
| Personal Access Token | password input | PAT with `Code (Read & Write)` scope |
| Default Project | text input (optional) | Pre-fill project name in new ADO nodes |

Store via `tauri-plugin-store` in the existing settings store, matching the pattern used for API keys.

The sidecar receives these settings via the existing WebSocket settings sync mechanism.

---

## Tech Stack

| Package | Version | Purpose |
|---------|---------|---------|
| `azure-devops-node-api` | 15.1.1 | Official Microsoft SDK for Azure DevOps REST API. Typed GitApi client for all PR operations |
| `zod` | 4.3.6 (already installed) | Schema declarations for node input/output. Use `.toJsonSchema()` for LLM prompt injection |

No new frontend dependencies required. The `zod` package is already in the sidecar; for frontend schema display, schemas can be serialized to JSON Schema and sent via WebSocket.

### PAT Required Scopes

The user's PAT needs these Azure DevOps scopes:
- **Code (Read)**: For ADO PR Read node
- **Code (Read & Write)**: For ADO PR Write node (posting comments, setting votes)

---

## Implementation Checklist

### 1. Node Schema System (foundation)

**Frontend (`app/src/`):**
- [ ] `lib/flow-types.ts`: Add `NodeSchemaDeclaration` interface, add optional `schemas` to `NodeRegistryEntry`
- [ ] `components/flow/NodeConfigPanel.tsx`: Show input/output schema documentation in node docs section

**Sidecar (`sidecar/src/`):**
- [ ] `flow-engine.ts`: Before executing LLM nodes, inspect downstream nodes for `inputSchema`, convert to JSON Schema, inject into system prompt
- [ ] Add schema validation (warning-level) on LLM output when downstream has `inputSchema`

### 2. Integration Category

**Frontend:**
- [ ] `lib/flow-types.ts`: Add `'integration'` to `NodeCategory` type, add to `NODE_CATEGORY` map with color `#6366f1`
- [ ] `components/flow/nodes/BaseNode.tsx`: Ensure category color renders for new category

### 3. ADO PR Read Node

**Frontend:**
- [ ] `lib/flow-types.ts`: Add `'ado-pr-read'` to `NodeKind`, add `AdoPrReadNodeConfig` interface, add to `FlowNodeConfig` union, add `NODE_REGISTRY` entry, add default config to `getDefaultConfig()`
- [ ] `components/flow/nodes/BaseNode.tsx`: Create `AdoPrReadNode` component, add to `nodeTypes` map
- [ ] `components/flow/config/AdoPrReadConfig.tsx`: Config panel with project name, repository name, track iterations toggle
- [ ] `components/flow/NodeConfigPanel.tsx`: Add to `CONFIG_COMPONENTS` map, add `NODE_DOCS` entry

**Sidecar:**
- [ ] `package.json`: Add `azure-devops-node-api` dependency
- [ ] `src/ado-client.ts`: New file — Azure DevOps client wrapper (connection init, GitApi accessor, settings integration)
- [ ] `src/flow-engine.ts`: Add `'ado-pr-read'` case to `executeNode()`, implement `executeAdoPrReadNode()` handler
- [ ] `src/flow-types.ts`: Mirror `'ado-pr-read'` in sidecar NodeKind

### 4. ADO PR Write Node

**Frontend:**
- [ ] `lib/flow-types.ts`: Add `'ado-pr-write'` to `NodeKind`, add `AdoPrWriteNodeConfig` interface, add to `FlowNodeConfig` union, add `NODE_REGISTRY` entry with `inputSchema`, add default config
- [ ] `components/flow/nodes/BaseNode.tsx`: Create `AdoPrWriteNode` component, add to `nodeTypes` map
- [ ] `components/flow/config/AdoPrWriteConfig.tsx`: Config panel with approval toggle, vote options, comment options, thread status
- [ ] `components/flow/NodeConfigPanel.tsx`: Add to `CONFIG_COMPONENTS` map, add `NODE_DOCS` entry

**Sidecar:**
- [ ] `src/flow-engine.ts`: Add `'ado-pr-write'` case to `executeNode()`, implement `executeAdoPrWriteNode()` handler
- [ ] `src/flow-types.ts`: Mirror `'ado-pr-write'` in sidecar NodeKind

### 5. Settings Panel

**Frontend:**
- [ ] `components/settings/SettingsPanel.tsx`: Add Azure DevOps section with org URL, PAT, and default project fields
- [ ] `lib/types.ts`: Add Azure DevOps fields to settings type

**Sidecar:**
- [ ] `src/index.ts`: Handle Azure DevOps settings in WebSocket settings sync

### 6. Flow Template (optional, nice-to-have)

- [ ] Seed a "PR Code Review" flow template: Start -> ADO PR Read -> LLM (with review system prompt) -> Human Review -> ADO PR Write -> End

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Large PR diffs exceed LLM context | Review quality degrades or fails | Context agent orchestrator handles trimming; future: add optional file filters to Read node config |
| Azure DevOps API rate limits | Node execution throttled or fails | Implement retry with exponential backoff in `ado-client.ts`; batch API calls where possible |
| PAT permissions insufficient | API calls return 403 | Clear error messages indicating required scopes; validate PAT on save in settings |
| LLM outputs malformed JSON for Write node | Write node can't parse input | Schema validation with helpful error messages; Write node falls back to posting summary-only if inline comments are malformed |
| Thread creation API changes | `createThread()` behavior differs across Azure DevOps versions | Pin to API version 7.1; document minimum Azure DevOps version requirement |
| Schema injection makes LLM prompts too long | Reduces available context for actual review | Keep schemas concise; only inject when a typed downstream node exists |

## Open Questions

1. **Schema format for UI display**: Should the config panel show the raw JSON Schema, a human-friendly summary, or both?
2. **Schema validation strictness**: Should schema validation failures block execution (error signal) or just warn?
3. **Multi-output LLM nodes**: If an LLM node has edges to both a typed node AND an untyped node, should the schema still be injected? (Probably yes, with clear instructions about the expected format.)
4. **Iteration state persistence**: Should `lastReviewedIteration` be stored in the node config (part of the flow JSON) or in a separate execution state table?
5. **Diff format**: Should the Read node output unified diffs, side-by-side diffs, or the raw Azure DevOps change objects?

---

## References

- [azure-devops-node-api on npm](https://www.npmjs.com/package/azure-devops-node-api) (v15.1.1)
- [Azure DevOps REST API — Pull Request Threads](https://learn.microsoft.com/en-us/rest/api/azure/devops/git/pull-request-threads?view=azure-devops-rest-7.1)
- [Azure DevOps REST API — Create Thread](https://learn.microsoft.com/en-us/rest/api/azure/devops/git/pull-request-threads/create?view=azure-devops-rest-7.1)
- [microsoft/azure-devops-node-api GitHub](https://github.com/microsoft/azure-devops-node-api)
