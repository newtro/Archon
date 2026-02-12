# AI Flow Creation Plan

> **Feature**: Enable the AI chat to create, read, update, and delete flows via natural language.

## Vision

Users describe flows in plain English through the chat interface, and the AI generates complete visual flows — nodes, edges, and configurations — using custom tools. The AI adapts: one-shot generation for clear requests ("Create a PR review flow with Opus"), conversational guidance for vague ones ("Help me build a flow for my project").

## Goals

- Full CRUD: AI can create, read, update, duplicate, and delete flows from chat
- All 13 node types supported from day one
- Both natural intent detection and explicit `/flow` command
- Reuse existing `FlowExecutionDiagram` in chat for preview
- Patch-style updates for efficient modification
- Auto-apply with version history for undo/safety
- Hybrid auto-layout: AI provides structure hints, frontend refines with dagre

## Non-Goals

- No code generation from flows (flows are visual constructs only)
- No flow execution from this feature (execution is a separate concern)

---

## Architecture

```
User Chat
  │
  ▼
Sidecar (agent.ts)
  │  Creates SDK MCP server with flow tools
  │  Passes to Agent SDK via mcpServers option
  ▼
Claude Agent SDK
  │  Claude discovers & calls flow tools
  │  e.g. mcp__flow-tools__create_flow
  ▼
MCP Tool Handler (sidecar)
  │  Validates flow JSON against schema
  │  Sends WebSocket message to frontend
  ▼
Frontend (React)
  │  Performs SQLite CRUD via flow-storage
  │  Sends confirmation back via WebSocket
  │  Updates FlowExecutionDiagram preview
  ▼
Sidecar returns tool result to Claude
```

### Key Architectural Decisions

1. **Custom MCP Tools in Agent SDK**: Use `createSdkMcpServer` + `tool()` + `zod` to define flow tools. These run alongside the `claude_code` preset tools.
2. **Sidecar validates**: The sidecar validates flow JSON against the schema before forwarding to frontend. AI gets clear error messages for self-correction.
3. **Frontend is the source of truth**: SQLite lives in Tauri; the sidecar relays, the frontend stores.
4. **Patch-style updates**: `update_flow` sends diffs (added/modified/removed nodes/edges), not full replacements.
5. **Version snapshots**: Each mutation saves a snapshot for undo.

---

## Tool Definitions

Five custom tools exposed via an MCP server named `flow-tools`:

### 1. `create_flow`

Creates a new flow with nodes and edges.

**Parameters:**
- `name` (string, required): Flow name
- `description` (string, optional): Flow description
- `nodes` (array, required): Array of node definitions
  - Each node: `{ id, kind, label, x?, y?, config }`
  - `kind` is one of the 13 NodeKind values
  - `config` matches the kind-specific config type (LLMNodeConfig, IntentNodeConfig, etc.)
  - `x`/`y` are optional — frontend auto-layout fills them if omitted
- `edges` (array, required): Array of edge definitions
  - Each edge: `{ source, target, sourceHandle?, targetHandle?, signal }`
  - `signal` is "success" | "fail" | "default" | custom string
- `contextAgentConfig` (object, optional): Context agent settings

**Returns:** `{ flowId, name, nodeCount, edgeCount }` on success, error message on failure.

### 2. `get_flow`

Retrieves a flow by ID or name.

**Parameters:**
- `flowId` (string, optional): Flow ID
- `name` (string, optional): Flow name (fuzzy match)

**Returns:** Full FlowDefinition JSON.

### 3. `list_flows`

Lists all available flows.

**Parameters:** None.

**Returns:** Array of `{ id, name, description, nodeCount, edgeCount, updatedAt }`.

### 4. `update_flow`

Applies a patch to an existing flow.

**Parameters:**
- `flowId` (string, required): Flow to update
- `name` (string, optional): New name
- `description` (string, optional): New description
- `addNodes` (array, optional): Nodes to add
- `updateNodes` (array, optional): Nodes to modify (by ID, partial config merge)
- `removeNodeIds` (array, optional): Node IDs to remove (also removes connected edges)
- `addEdges` (array, optional): Edges to add
- `removeEdgeIds` (array, optional): Edge IDs to remove
- `contextAgentConfig` (object, optional): Updated context agent config

**Returns:** `{ flowId, name, nodeCount, edgeCount }` on success, error message on failure.

### 5. `delete_flow`

Deletes a flow by ID.

**Parameters:**
- `flowId` (string, required): Flow to delete

**Returns:** `{ deleted: true, name }` on success.

---

## Node Schema in Tool Descriptions

The full node type schema is encoded in the `create_flow` and `update_flow` tool parameter descriptions via zod. This gives Claude complete knowledge of:

- All 13 `NodeKind` values and their categories
- Each kind's config structure (LLMNodeConfig, IntentNodeConfig, etc.)
- Valid `ModelId` values: "haiku", "sonnet", "opus"
- Valid `ToolPreset` values: "none", "read-only", "full-access"
- Valid `EdgeSignal` values: "success", "fail", "default", or custom strings
- Default config values for each node kind

The zod schemas mirror the TypeScript interfaces in `flow-types.ts` exactly.

---

## WebSocket Protocol

New message types for sidecar ↔ frontend relay:

### Frontend-bound (sidecar → frontend):

```typescript
// Request frontend to create a flow
{ type: "flow_tool_create", requestId: string, flow: FlowDefinition }

// Request frontend to update a flow
{ type: "flow_tool_update", requestId: string, flowId: string, patch: FlowPatch }

// Request frontend to delete a flow
{ type: "flow_tool_delete", requestId: string, flowId: string }

// Request frontend to get a flow
{ type: "flow_tool_get", requestId: string, flowId?: string, name?: string }

// Request frontend to list flows
{ type: "flow_tool_list", requestId: string }
```

### Sidecar-bound (frontend → sidecar):

```typescript
// Response to any flow tool request
{ type: "flow_tool_response", requestId: string, success: boolean, data?: any, error?: string }
```

The `requestId` correlates request/response pairs, allowing the sidecar tool handler to await the frontend's response before returning the tool result to Claude.

---

## Auto-Layout

### Hybrid Approach

1. **AI provides hints**: Nodes include optional `x`/`y` coordinates. The AI is guided (via tool description) to place nodes in a left-to-right DAG layout with ~250px horizontal spacing and ~150px vertical spacing.

2. **Frontend refines**: When a flow is created or updated, the frontend applies dagre auto-layout to compute final positions. This handles:
   - Overlapping nodes
   - Optimal edge routing
   - Consistent spacing
   - Branching/merging alignment

3. **Library**: Use `@dagrejs/dagre` (already a peer of `@xyflow/react` ecosystem). Configure for left-to-right (`rankdir: 'LR'`) layout.

---

## Patch Model

The `update_flow` tool uses a patch model for efficient modifications:

```typescript
interface FlowPatch {
  name?: string;
  description?: string;
  addNodes?: SerializedNode[];
  updateNodes?: Array<{
    id: string;
    label?: string;
    config?: Partial<FlowNodeConfig>;
  }>;
  removeNodeIds?: string[];
  addEdges?: SerializedEdge[];
  removeEdgeIds?: string[];
  contextAgentConfig?: FlowDefinition['contextAgentConfig'];
}
```

### Patch Application Rules

1. `removeNodeIds` removes nodes AND all connected edges (source or target match)
2. `removeEdgeIds` removes specific edges by ID
3. `addNodes` adds new nodes (IDs must not conflict)
4. `updateNodes` merges config shallowly — the node's `kind` cannot change
5. `addEdges` adds new edges (validated: source/target must exist)
6. Operations apply in order: remove → add → update

---

## Version History

Each flow mutation (create, update, delete) saves a snapshot:

### Storage

Add a new SQLite table:

```sql
CREATE TABLE flow_versions (
  id TEXT PRIMARY KEY,
  flow_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  data TEXT NOT NULL,          -- JSON FlowDefinition snapshot
  action TEXT NOT NULL,        -- "create" | "update" | "delete"
  description TEXT DEFAULT '', -- Human-readable change description
  created_at INTEGER NOT NULL,
  FOREIGN KEY (flow_id) REFERENCES flows(id)
);
```

### Behavior

- Before any mutation, save the current flow state as a version
- Version numbers auto-increment per flow
- `delete` saves the final state before deletion (enables undelete)
- Keep last 50 versions per flow (prune oldest on save)

### Undo Mechanism

Add a `restore_flow_version` function to `flow-storage.ts` that:
1. Loads a version snapshot by ID
2. Overwrites the current flow data
3. Saves a new version recording the restore action

The AI does NOT have a tool for undo — this is a frontend-only feature (accessible from the flow designer UI).

---

## Frontend Integration

### Flow Preview in Chat

Reuse the existing `FlowExecutionDiagram` component:

1. When a `flow_tool_create` or `flow_tool_update` WebSocket message arrives, the frontend:
   - Performs the CRUD operation
   - Sends back `flow_tool_response`
   - Emits a `flow_preview` event that the chat panel picks up
   - Renders the flow in the `FlowExecutionDiagram` pane

2. The diagram shows the flow structure with node types, labels, and edge signals. Users can click to open the full flow designer.

### `/flow` Command

Register a `/flow` command in the chat input that:
- Sets a flag on the next message indicating flow-management intent
- The sidecar includes additional context in the system prompt when this flag is set
- This is an optimization — the AI should also detect flow intent naturally

### Intent Detection

The AI detects flow management intent from natural language. The system prompt includes guidance:

> "When the user asks you to create, modify, delete, or describe a flow/workflow/pipeline, use the flow management tools (create_flow, update_flow, delete_flow, list_flows, get_flow)."

No special routing needed — Claude naturally decides when to use these tools based on the conversation.

---

## Implementation Checklist

### Sidecar Changes

1. **New file: `sidecar/src/flow-tools.ts`**
   - Define the MCP server with `createSdkMcpServer`
   - Define all 5 tools with `tool()` + zod schemas
   - Each tool handler sends a WebSocket message to the frontend and awaits the response
   - Include a pending request map (`Map<requestId, { resolve, reject }>`) for request/response correlation

2. **New dependency: `zod`**
   - Required for tool schema definitions
   - `npm install zod` in sidecar

3. **Modify: `sidecar/src/agent.ts`**
   - Import the flow tools MCP server
   - Pass it via `mcpServers` option alongside existing tools
   - Handle `flow_tool_response` WebSocket messages from frontend (route to pending request map)
   - Add flow intent guidance to the system prompt

4. **Modify: `sidecar/src/flow-types.ts`**
   - Export `FlowPatch` interface
   - Ensure types are importable by `flow-tools.ts`

### Frontend Changes

5. **Modify: `app/src/hooks/useWebSocket.ts`**
   - Handle new `flow_tool_*` message types
   - Route to flow-storage functions
   - Send `flow_tool_response` back to sidecar
   - Emit `flow_preview` events for the chat panel

6. **Modify: `app/src/lib/flow-storage.ts`**
   - Add `applyFlowPatch(flowId, patch)` function
   - Add `saveFlowVersion(flowId, action, description)` function
   - Add `restoreFlowVersion(versionId)` function
   - Add `getFlowVersions(flowId)` function
   - Add `flow_versions` table creation in DB init
   - Add `getFlowByName(name)` function for fuzzy lookup

7. **Modify: `app/src/App.tsx`**
   - Wire up flow preview events from WebSocket to FlowExecutionDiagram
   - Handle `/flow` command prefix in chat input

8. **New dependency: `@dagrejs/dagre`**
   - For auto-layout refinement
   - `npm install @dagrejs/dagre` in app
   - Create `app/src/lib/flow-layout.ts` with `autoLayoutFlow(flow: FlowDefinition): FlowDefinition`

9. **Modify: `app/src/components/flow/FlowExecutionDiagram.tsx`**
   - Support rendering a flow preview (not just execution state)
   - Add "Open in Designer" button on preview

### Testing

10. **Manual test plan:**
    - "Create a simple flow with Start → LLM → End"
    - "List my flows"
    - "Add a Router node between Start and LLM in [flow name]"
    - "Delete [flow name]"
    - "Create a PR review flow with intent classification, Opus for complex tasks, Sonnet for simple ones, and a test runner"
    - Verify auto-layout produces clean diagrams
    - Verify version history captures each mutation
    - Verify undo restores previous state
