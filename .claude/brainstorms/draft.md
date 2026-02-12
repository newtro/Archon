---
topic: "Azure DevOps PR Code Review Node"
phase: "exploration"
started: "2026-02-12T12:00:00"
---

## Seed
Add a new node type to the ArchonIDE flow designer for Azure DevOps PR code reviews. The node is a **data-gathering / context node** — it fetches PR information (diffs, metadata, comments, file changes) from Azure DevOps via their API and passes structured data to downstream nodes. The actual code review logic happens in subsequent LLM nodes. The project loaded in Archon provides codebase context.

## Discovery

### Q: What should the primary output of this node be?
A: This node gathers information from the PR, then passes it on to the next node. It's a data-gathering node, not an execution node.

### Q: How should the node authenticate with Azure DevOps?
A: PAT (Personal Access Token) — simple, well-supported, fits the existing BYOK pattern.

### Q: What specific data should the node pull from the PR?
A: Everything available — diffs, metadata, comments, work items, commit history, build status, policy evaluations, reviewer assignments.

### Q: How should the user specify which PR to review?
A: Org URL and project name are static config on the node. PR number flows dynamically from upstream node output (typically from chat input).

### Q: Should the node output structured JSON or prompt-ready text?
A: Structured JSON — keeps it flexible for downstream nodes to decide formatting.

### Q: Where should Azure DevOps settings (org URL, PAT) live?
A: Global settings panel — shared across all Azure DevOps nodes in all flows.

## Exploration

### Q: HTTP client for Azure DevOps API?
A: `azure-devops-node-api` (v15.1.1) — Microsoft's official typed SDK. Full PR API coverage, typed responses, handles auth/pagination. Preferred over raw fetch or axios due to the breadth of data being pulled (6-8 API endpoints).

### Q: Which node category?
A: New "Integration" category — future-proofs for GitHub, Jira, Slack nodes.

### Q: Diff size limits?
A: Pull full PR data always. The context agent orchestrator handles any trimming needed (1M context Sonnet).

### Q: Output signals for routing?
A: Rich signals — success, error, no-changes, draft-pr, merged. Enables conditional flow branching based on PR state.

### Q: Non-goals / constraints?
A: Pull-based only (no webhook triggers). Webhooks are a future separate concern.

### Q: ADO PR Write node?
A: Yes — include a companion ADO PR Write node. Full capability: inline comments on specific lines, overall review comment, set vote status (approve/reject/wait). Configurable human approval gate (default on).

### Q: Schema-aware node chaining?
A: General approach — every node type declares input/output JSON schemas. The flow engine inspects outgoing edges and auto-injects the next node's expected input schema into LLM system prompts. This enables LLM nodes between typed integration nodes to automatically produce correctly formatted output.

### Q: Plan scope?
A: All in one plan — schema system + ADO PR Read + ADO PR Write. Built together since the pieces are interdependent.

## Expansion

### Suggestions Offered
- [ ] File-aware context loading (cross-reference PR changed files with loaded project)
- [ ] PR template flow presets (pre-built review flow template)
- [x] Incremental iteration support (track last-reviewed iteration, fetch only new changes)
- [x] ADO Write-back node (inline comments, summary, vote status)
- [ ] Multi-PR batch mode
- [ ] PR complexity scoring
- [ ] Security-focused diff analysis

### Schema awareness discussion
- General approach chosen: all nodes get input/output schemas
- Flow engine auto-injects downstream node's inputSchema into LLM prompts
- Enables any integration node pair to work with LLM nodes automatically
