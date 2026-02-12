# Context Management View — Implementation Plan

## Vision

Add a 4th view tab ("Context") to the FlowExecutionPanel that provides complete transparency into the context window state — what's in it, how full it is, what was included vs. excluded by the Context Agent, and how context evolves in real-time. This view exists because ArchonIDE's core promise is "no black boxes" — the Context Agent's decisions should be as visible as the flow diagram itself.

**One-liner:** A live debugging dashboard that makes the invisible context window visible.

---

## Problem Statement

The Context Agent makes critical decisions behind the scenes: classifying intent, routing to models, generating curated briefings that exclude parts of the conversation, and tracking structured state. Currently, these decisions are partially visible in the Debug Log (as text events) but there's no dedicated, structured view for understanding:

1. How full is the context window right now?
2. What exactly was sent to the LLM (and what was left out)?
3. Where are tokens being consumed — system prompt? briefing? tool results? conversation?
4. Why did the Context Agent make a specific routing or curation decision?

The Context View answers all of these questions in real-time.

---

## Goals

- Full visibility into context window state (token usage, % full, composition breakdown)
- Show both included and excluded content from Context Agent briefings (diff-style)
- Session-level overview + per-node drill-down (hierarchical)
- Real-time streaming updates as flow executes
- Context budget warnings (75% yellow, 90% red)
- Visual composition chart showing where tokens are being consumed
- Always available (flows, chat, idle) — not just during flow execution

## Non-Goals

- Manually editing context contents from this view
- Context replay/scrubber (future enhancement)
- Briefing quality scoring (future enhancement)
- Export/share context snapshots (future enhancement)
- User-configurable context limits (derive from model config)

---

## Architecture

### Data Flow

```
Sidecar (Node.js)                          Frontend (React)
┌─────────────────┐                        ┌─────────────────────┐
│ Flow Engine      │                        │ FlowExecutionPanel  │
│                  │  WebSocket events      │                     │
│ Context Agent    │ ───────────────────>   │ useContextView hook │
│  - classify      │  context_window_snap   │                     │
│  - brief         │  briefing_diff         │ ContextView         │
│  - state update  │  token_usage_update    │  - OverviewPanel    │
│                  │                        │  - CompositionChart │
│ Token Counter    │                        │  - NodeDrillDown    │
│  (countTokens)   │                        │  - BriefingDiff     │
└─────────────────┘                        │  - BudgetWarnings   │
                                           └─────────────────────┘
```

### Token Counting Strategy

**Primary:** Anthropic's free `messages.countTokens()` API — accurate for all current Claude models, free to use, separate rate limits from message creation. Call this from the sidecar before each LLM invocation to get an accurate pre-call token count.

**Secondary:** `usage` field from API responses — provides actual input/output tokens after each call. Use these to correct and confirm estimates.

**Model context limits** (derived from node config):
| Model | Context Window |
|-------|---------------|
| Claude Opus 4.6 | 200,000 tokens |
| Claude Sonnet 4.5 | 200,000 tokens |
| Claude Haiku 4.5 | 200,000 tokens |
| Extended context (1M) | 1,000,000 tokens |

### New WebSocket Event Types

Three new event types added to the sidecar-to-frontend protocol:

#### `context_window_snapshot`
Emitted before each LLM call. Contains the structured breakdown of what's in the context window.

```typescript
interface ContextWindowSnapshot {
  type: "context_window_snapshot";
  sessionId: string;
  executionId?: string;
  nodeId: string;
  model: string;
  maxTokens: number;           // Model's context limit
  timestamp: number;
  breakdown: {
    systemPrompt: number;      // Token count
    briefing: number;
    toolDefinitions: number;
    conversationHistory: number;
    toolResults: number;
    fileContents: number;
    other: number;
  };
  totalInputTokens: number;    // Sum of breakdown
  percentFull: number;         // (total / maxTokens) * 100
  // Summary descriptions (streamed in real-time)
  sections: ContextSection[];
}

interface ContextSection {
  name: string;                // "System Prompt", "Briefing", etc.
  tokenCount: number;
  summary: string;             // 1-2 line summary of contents
  category: "system" | "briefing" | "tools" | "conversation" | "files" | "other";
  // Full content loaded on-demand via separate request
}
```

#### `briefing_diff`
Emitted when the Context Agent generates a briefing. Shows what was included and what was excluded.

```typescript
interface BriefingDiff {
  type: "briefing_diff";
  sessionId: string;
  executionId?: string;
  nodeId: string;
  timestamp: number;
  included: BriefingItem[];
  excluded: BriefingItem[];
  originalTokens: number;      // Raw conversation token count
  briefingTokens: number;      // Curated briefing token count
  tokensSaved: number;         // Difference
  compressionRatio: number;    // briefingTokens / originalTokens
}

interface BriefingItem {
  type: "message" | "tool_result" | "file_content" | "decision" | "error" | "other";
  summary: string;             // What this item contains
  tokenCount: number;
  reason?: string;             // Why included/excluded (e.g., "stale", "resolved error", "irrelevant file")
}
```

#### `token_usage_update`
Emitted after each LLM call completes. Provides actual usage from the API response.

```typescript
interface TokenUsageUpdate {
  type: "token_usage_update";
  sessionId: string;
  executionId?: string;
  nodeId: string;
  timestamp: number;
  actual: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens?: number;
    cacheReadInputTokens?: number;
  };
  estimated: number;           // What we estimated before the call
  delta: number;               // Difference (actual - estimated)
  cumulativeSession: {
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCost: number;         // USD
  };
}
```

### On-Demand Raw Content

For the "show raw" toggle on per-node drill-down, raw message arrays are NOT streamed by default (too heavy). Instead:

1. Frontend requests raw content via a WebSocket request message:
   ```typescript
   { type: "get_context_raw", nodeId: string, executionId: string }
   ```
2. Sidecar responds with the full messages array:
   ```typescript
   { type: "context_raw_response", nodeId: string, messages: SDKMessage[] }
   ```

This keeps the default view lightweight while allowing full inspection on demand.

---

## UI Components

### Tab Addition

Add a 4th tab button to [FlowExecutionPanel.tsx](app/src/components/flow/FlowExecutionPanel.tsx) alongside the existing Debug, List, and Diagram tabs:

- Icon: `Brain` (from Lucide) — consistent with thinking indicator iconography
- Label: "Context" (shown on hover tooltip)
- Always enabled (not conditionally disabled like Diagram tab)

### View Layout (ContextView component)

```
┌─────────────────────────────────────────────┐
│  Context Overview Bar                        │
│  [████████████░░░░░] 67% (134k / 200k)      │
│  Model: Sonnet 4.5  |  Turn 5  |  $0.12     │
├─────────────────────────────────────────────┤
│                                              │
│  Composition Chart (stacked horizontal bar)  │
│  [System][Briefing][Tools][Conv][Files]       │
│   12k     8k       45k    52k   17k          │
│                                              │
├─────────────────────────────────────────────┤
│  Context State (collapsible JSON tree)       │
│  ├── task: "Implement user auth"             │
│  ├── taskStatus: "in_progress"               │
│  ├── files: { 3 tracked }                   │
│  ├── decisions: [ 2 items ]                  │
│  └── errors: [ 1 resolved ]                 │
├─────────────────────────────────────────────┤
│  Node Context History (scrollable list)      │
│  ┌─ [Context Agent] Classification ────┐    │
│  │  Intent: feature | Complexity: high │    │
│  │  Routed to: Opus                    │    │
│  └─────────────────────────────────────┘    │
│  ┌─ [LLM: Opus] Context Window ───────┐    │
│  │  ████████░░ 78% (156k/200k)         │    │
│  │  [Structured] [Raw]                 │    │
│  │  System Prompt:  12,400 tokens      │    │
│  │  Briefing:        8,200 tokens      │    │
│  │  Tool Defs:      14,800 tokens      │    │
│  │  Conversation:   52,100 tokens      │    │
│  │  File Contents:  68,500 tokens      │    │
│  └─────────────────────────────────────┘    │
│  ┌─ [Briefing Diff] ──────────────────┐    │
│  │  Included: 12 items (12k tokens)    │    │
│  │  Excluded: 8 items (33k tokens)     │    │
│  │  Compression: 73% saved             │    │
│  │  [Show details...]                  │    │
│  └─────────────────────────────────────┘    │
└─────────────────────────────────────────────┘
```

### Sub-Components

1. **ContextOverviewBar** — Top-level summary with progress bar, % full, model info, cumulative cost. Persistent at top of view.

2. **CompositionChart** — Horizontal stacked bar showing token allocation by category. Each segment is color-coded:
   - System prompt: `#8B5CF6` (purple)
   - Briefing: `#3B82F6` (blue)
   - Tool definitions: `#06B6D4` (cyan)
   - Conversation: `#22C55E` (green)
   - File contents: `#F59E0B` (amber)
   - Other: `#64748B` (slate)

3. **ContextStateTree** — Collapsible JSON tree view of the current `ContextState` object. Updates in real-time. Highlights changed fields briefly (flash animation on update).

4. **NodeContextHistory** — Scrollable list of context events, newest at bottom. Each entry is a card showing:
   - Classification results (intent, complexity, routing decision)
   - Per-node context window snapshots (structured breakdown)
   - Briefing diffs (included vs. excluded, with expansion)
   - Token usage actuals vs. estimates

5. **BudgetWarningBanner** — Conditional banner that appears when context usage exceeds thresholds:
   - 75%+: Yellow banner — "Context window 78% full — large tool results or file loads may exceed limit"
   - 90%+: Red banner — "Context window 94% full — risk of context truncation"
   - Shows which categories are consuming the most tokens

### Interactions

- **Expand/collapse** sections in the context state tree
- **Click node entries** to drill down into structured breakdown or raw messages
- **Toggle "Structured / Raw"** on per-node context to switch between the visual breakdown and the raw messages array
- **Hover composition chart segments** to see exact token counts and category details
- **Click briefing diff entries** to expand and see individual included/excluded items with reasons

---

## Key Decisions

1. **Anthropic's `countTokens()` API** over client-side tokenizer — it's free, accurate for all Claude models, and doesn't add dependency on stale tokenizer libraries. Rate limited separately from message creation.

2. **New event types** (not extending existing ones) — clean separation of concerns. Existing `context_agent_event` continues to work for the debug log; new events serve the Context View specifically.

3. **Summary + on-demand** for raw content — prevents streaming 200k+ token payloads over WebSocket for every LLM call. Structured summaries and token counts stream in real-time; full raw messages loaded only when explicitly requested.

4. **Always available** — the Context View works in all modes (flow execution, chat, idle). During idle, it shows the last known context state. During chat (without a flow), it shows the Context Agent's state and conversation context.

5. **Model-derived context limits** — no user-configurable limits. The % full indicator uses the model's actual context window size. Keeps the feature simple and accurate.

---

## Implementation Phases

### Phase A: Sidecar Events (Backend)

Add the three new WebSocket event types to the sidecar:

1. **Token counting integration** — Add `messages.countTokens()` calls before each LLM invocation in the flow engine and context agent. Emit `context_window_snapshot` with the breakdown.

2. **Briefing diff tracking** — Modify the Context Agent's briefing generation to track what was included vs. excluded. Emit `briefing_diff` events.

3. **Token usage reporting** — After each LLM call, emit `token_usage_update` with actual usage from the API response and cumulative session stats.

4. **On-demand raw content** — Handle `get_context_raw` requests from the frontend. Cache the last messages array per node for retrieval.

### Phase B: Frontend State Management

1. **`useContextView` hook** — New hook that listens for the three new event types and maintains:
   - Current context state (latest snapshot)
   - Context event history (all snapshots, diffs, usage updates)
   - Budget warning state (derived from latest snapshot)
   - Cumulative session stats

2. **Wire into `useWebSocket`** — Register handlers for the new event types in the WebSocket hook.

3. **Extend `FlowExecutionState`** (or create parallel state) with context-specific data.

### Phase C: UI Components

1. **Tab addition** — Add the 4th "Context" tab to FlowExecutionPanel with Brain icon.

2. **ContextView container** — Main component with the four sub-panels.

3. **ContextOverviewBar** — Progress bar, stats, model info.

4. **CompositionChart** — Stacked horizontal bar with color-coded segments. Pure CSS/SVG (no chart library needed for a stacked bar).

5. **ContextStateTree** — Collapsible JSON viewer. Can use a simple recursive component or a lightweight library.

6. **NodeContextHistory** — Scrollable card list with expand/collapse per entry.

7. **BriefingDiffPanel** — Included/excluded items with color coding (green for included, gray/red for excluded) and reason labels.

8. **BudgetWarningBanner** — Conditional rendering based on % full threshold.

### Phase D: Integration & Polish

1. **CSS styling** — Consistent with existing FlowExecutionPanel design language. Dark theme, accent colors from the icon system.

2. **Performance** — Debounce real-time updates (batch UI renders every ~200ms). Virtualize the NodeContextHistory list if it gets long.

3. **Chat mode support** — Ensure the Context View works during regular chat sessions (non-flow), showing the Context Agent's state.

4. **Idle state** — When nothing is executing, show the last known state or a helpful empty state.

---

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| `countTokens()` API adds latency before each LLM call | Call in parallel with other pre-call setup. It's typically fast (<100ms). Can skip for non-Context View users if needed. |
| `countTokens()` rate limits (100-8000 RPM depending on tier) | Cache token counts for unchanged message prefixes. Only re-count when messages change. |
| Large context snapshots bloating WebSocket traffic | Summary-only by default. Raw content on-demand. Batch updates. |
| Real-time rendering of rapidly changing state | Debounce renders to 200ms intervals. Use React.memo aggressively. |
| Context View always available but no data during idle | Show helpful empty state: "No active session. Start a chat or run a flow to see context data." |

---

## Open Questions

1. **Should the composition chart be a stacked bar or a donut/pie chart?** Stacked bar is more space-efficient in a narrow panel. Donut is more visually striking. Suggest starting with stacked bar.

2. **Should we persist context history across sessions?** Currently ephemeral (lost on app restart). Could store in SQLite for post-mortem analysis.

3. **Should briefing diff show the actual text content or just summaries?** Summaries by default (with expand to see text) keeps it manageable. Full text could be overwhelming for large contexts.
