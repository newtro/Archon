/**
 * Context Agent — orchestrates multi-turn conversations.
 *
 * Classifies user intent, routes to the right model, generates curated
 * briefings for execution agents, and tracks structured state. Uses Sonnet
 * with 1M context as the orchestration brain.
 *
 * See docs/archon-ide-plan.md § "Context Agent Architecture" and
 * docs/Sample Agentic loop.md for the full design.
 */

import { WebSocket } from "ws";
import { query, type Options } from "@anthropic-ai/claude-agent-sdk";
import {
  type ContextState,
  type ContextAgentConfig,
  createInitialState,
  DEFAULT_CONTEXT_AGENT_CONFIG,
} from "./context-state.js";
import { saveSession, loadSession, searchSessions } from "./session-store.js";
import { getGlobalProjectRoot } from "./agent.js";

// ── Classification Result ───────────────────────────────────

export interface ClassificationResult {
  intent: string; // feature | bug | question | approval | refactor | docs
  complexity: "low" | "medium" | "high";
  routeToModel: "haiku" | "sonnet" | "opus";
  handleDirectly: boolean; // true = Context Agent handles without routing
  reasoning: string;
}

// ── Briefing ────────────────────────────────────────────────

export interface Briefing {
  task: string;
  context: string; // full curated briefing text for the execution agent
  tokensSaved: number; // estimated tokens saved vs raw history
}

// ── Helpers ─────────────────────────────────────────────────

function send(ws: WebSocket, data: unknown): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

/** Extract text from an SDK query response. */
async function queryForText(
  prompt: string,
  options: Options,
): Promise<{ text: string; sessionId?: string; costUsd: number }> {
  let text = "";
  let sessionId: string | undefined;
  let costUsd = 0;

  for await (const event of query({ prompt, options })) {
    if (event.type === "assistant") {
      for (const block of event.message?.content ?? []) {
        if ("text" in block) text += (block as { text: string }).text;
      }
    } else if (event.type === "result" && event.subtype === "success") {
      sessionId = (event as Record<string, unknown>).session_id as string | undefined;
      costUsd = event.total_cost_usd ?? 0;
    }
  }

  return { text: text.trim(), sessionId, costUsd };
}

/** Try to parse JSON from a model response, stripping markdown fences. */
function parseJSON<T>(raw: string): T | null {
  let cleaned = raw.trim();
  // Strip markdown code fences
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    return null;
  }
}

// ── Context Agent System Prompt ─────────────────────────────

const CONTEXT_AGENT_SYSTEM_PROMPT = `You are the Context Agent for ArchonIDE, an AI-powered IDE. You orchestrate multi-turn coding conversations.

Your responsibilities:
1. CLASSIFY user intent: feature | bug | question | approval | refactor | docs
2. ASSESS complexity: low (Haiku) | medium (Sonnet) | high (Opus)
3. GENERATE focused briefings for execution agents
4. TRACK structured state across turns

State schema you maintain:
{
  "task": "current task",
  "taskStatus": "pending | in_progress | implemented | completed | failed",
  "files": { "path": { "summary": "...", "changes": "...", "modified": "turn N" } },
  "decisions": ["decision 1", ...],
  "errors": [{ "turn": N, "error": "...", "resolution": "..." }],
  "keyInsight": "critical constraint",
  "pendingUserAction": "what user needs to do"
}

Briefing rules:
- Include ONLY context relevant to the current task
- Exclude raw tool outputs superseded by later changes
- Exclude resolved errors unrelated to current task
- Include current file contents when the agent will modify them
- A good briefing is 20-40% the size of raw history

Always respond with structured JSON when asked to classify or update state.`;

// ── Context Agent Class ─────────────────────────────────────

export class ContextAgent {
  readonly sessionId: string;
  private state: ContextState;
  private config: ContextAgentConfig;
  private sdkSessionId: string | null = null;

  constructor(
    sessionId: string,
    config?: Partial<ContextAgentConfig>,
    existingState?: ContextState,
  ) {
    this.sessionId = sessionId;
    this.config = { ...DEFAULT_CONTEXT_AGENT_CONFIG, ...config };
    this.state = existingState ?? createInitialState("");
  }

  // ── Classification ──────────────────────────────────────

  /**
   * Classify user intent and determine routing.
   * Uses Haiku for speed — a single structured JSON response.
   */
  async classifyIntent(
    userMessage: string,
    ws: WebSocket,
    abortController: AbortController,
  ): Promise<ClassificationResult> {
    this.state.turn++;

    const prompt = `Classify this user message in the context of an ongoing coding session.

Current task context:
${JSON.stringify({ task: this.state.task, taskStatus: this.state.taskStatus, turn: this.state.turn }, null, 2)}

User message: "${userMessage}"

Respond with ONLY a JSON object:
{
  "intent": "feature" | "bug" | "question" | "approval" | "refactor" | "docs",
  "complexity": "low" | "medium" | "high",
  "handleDirectly": true | false,
  "reasoning": "brief explanation"
}

Complexity guide:
- HIGH: new features, architecture decisions, multi-file refactors, test suites
- MEDIUM: bug fixes, feature enhancements, moderate refactors
- LOW: logging, comments, simple config changes, questions about code, approvals

Set handleDirectly=true ONLY for trivial tasks (logging, comments, simple questions).`;

    const options: Options = {
      model: "haiku",
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      tools: [],
      abortController,
    };

    const { text } = await queryForText(prompt, options);
    const parsed = parseJSON<{
      intent: string;
      complexity: "low" | "medium" | "high";
      handleDirectly: boolean;
      reasoning: string;
    }>(text);

    const intent = parsed?.intent ?? "feature";
    const complexity = parsed?.complexity ?? "medium";
    const handleDirectly = parsed?.handleDirectly ?? false;
    const reasoning = parsed?.reasoning ?? "";

    // Route based on complexity using config rules
    let routeToModel: "haiku" | "sonnet" | "opus";
    switch (complexity) {
      case "high":
        routeToModel = this.config.routingRules.highComplexityModel;
        break;
      case "medium":
        routeToModel = this.config.routingRules.mediumComplexityModel;
        break;
      case "low":
        routeToModel = this.config.routingRules.lowComplexityModel;
        break;
    }

    // Update task description on first real message
    if (this.state.turn === 1 || this.state.task === "") {
      this.state.task = userMessage.slice(0, 200);
      this.state.taskStatus = "in_progress";
    }

    const result: ClassificationResult = {
      intent,
      complexity,
      routeToModel,
      handleDirectly,
      reasoning,
    };

    // Track classification in state
    this.state.intentHistory.push({
      turn: this.state.turn,
      intent,
      complexity,
      routedTo: handleDirectly ? "context-agent" : routeToModel,
    });

    // Emit classification event for frontend transparency
    send(ws, {
      type: "context_agent_event",
      sessionId: this.sessionId,
      event: {
        type: "classification",
        intent,
        complexity,
        routedTo: handleDirectly ? "context-agent" : routeToModel,
        handleDirectly,
      },
    });

    console.log(
      `[context-agent] Turn ${this.state.turn}: intent=${intent} complexity=${complexity} route=${handleDirectly ? "direct" : routeToModel} — ${reasoning}`,
    );

    return result;
  }

  // ── Briefing Generation (Phase C) ─────────────────────────

  /**
   * Generate a curated briefing for the execution agent.
   * Uses the Context Agent's own Sonnet session with 1M context.
   */
  async generateBriefing(
    userMessage: string,
    classification: ClassificationResult,
    ws: WebSocket,
    abortController: AbortController,
  ): Promise<Briefing> {
    const stateJson = JSON.stringify(this.state, null, 2);

    // Check for cross-session references by extracting keywords
    const keywords = userMessage
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3 && !["this", "that", "from", "with", "about", "what", "when", "where", "there", "their", "here", "have", "been", "will", "would", "could", "should"].includes(w));
    const crossSessionContext = this.searchCrossSession(keywords);

    const prompt = `Generate a focused briefing for a ${classification.routeToModel} execution agent.

CLASSIFICATION:
- Intent: ${classification.intent}
- Complexity: ${classification.complexity}
- User message: "${userMessage}"

CURRENT STATE:
${stateJson}
${crossSessionContext ? `\nPRIOR SESSION CONTEXT:\n${crossSessionContext}\n` : ""}
Generate a briefing that includes:
1. TASK: Clear description of what needs to be done
2. CONTEXT: Relevant prior decisions, constraints, and insights from the conversation
3. FILES: Summaries of relevant files the agent will need (include paths and what was done to them)
4. PRIOR ERRORS: Only errors relevant to the current task (omit resolved/unrelated ones)

EXCLUDE from the briefing:
- Raw tool outputs from earlier turns that have been superseded
- Resolved errors unrelated to the current task
- File contents the agent won't need to reference
- Intermediate states superseded by later changes

Format the briefing as clear, structured text that the execution agent can use immediately.
Start with "TASK:" and include sections as needed. Be concise — aim for 20-40% of what raw history would be.`;

    const options: Options = {
      model: this.config.model,
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      tools: [],
      systemPrompt: CONTEXT_AGENT_SYSTEM_PROMPT,
      ...(this.sdkSessionId ? { resume: this.sdkSessionId } : { persistSession: true }),
      ...(this.config.extendedContext ? { betas: ["context-1m-2025-08-07" as never] } : {}),
      abortController,
    };

    const { text, sessionId: newSdkSessionId } = await queryForText(prompt, options);

    // Update SDK session ID for future resume
    if (newSdkSessionId) {
      this.sdkSessionId = newSdkSessionId;
    }

    // Estimate token savings (rough: 4 chars per token)
    const rawHistoryTokens = Math.ceil(stateJson.length / 4);
    const briefingTokens = Math.ceil(text.length / 4);
    const tokensSaved = Math.max(0, rawHistoryTokens - briefingTokens);

    // Emit briefing event
    send(ws, {
      type: "context_agent_event",
      sessionId: this.sessionId,
      event: { type: "briefing_generated", tokensSaved },
    });

    console.log(
      `[context-agent] Briefing generated: ~${briefingTokens} tokens (saved ~${tokensSaved} vs raw)`,
    );

    return {
      task: userMessage,
      context: text || `TASK: ${userMessage}`,
      tokensSaved,
    };
  }

  // ── Result Ingestion (Phase C) ────────────────────────────

  /**
   * Ingest execution results and update structured state.
   * The Context Agent processes the result and updates its state JSON.
   */
  async ingestResult(
    executionResult: string,
    toolCalls: Array<{ name: string; args: Record<string, unknown>; result?: string }>,
    model: string,
    ws: WebSocket,
    abortController: AbortController,
  ): Promise<void> {
    const toolSummary = toolCalls
      .map((tc) => `- ${tc.name}(${JSON.stringify(tc.args)})${tc.result ? ` -> ${tc.result.slice(0, 200)}` : ""}`)
      .join("\n");

    const prompt = `The execution agent (${model}) has completed. Update the structured state.

EXECUTION RESULT:
${executionResult.slice(0, 2000)}

TOOL CALLS:
${toolSummary || "(none)"}

CURRENT STATE:
${JSON.stringify(this.state, null, 2)}

Return the UPDATED state as a JSON object. Update:
- files: add/update entries for any files read, written, or edited
- decisions: add any new decisions made
- errors: add any errors encountered (with resolution if fixed)
- taskStatus: update if the task progressed
- keyInsight: update if a critical constraint was discovered
- pendingUserAction: set if the user needs to do something

Return ONLY the JSON object.`;

    const options: Options = {
      model: this.config.model,
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      tools: [],
      systemPrompt: CONTEXT_AGENT_SYSTEM_PROMPT,
      ...(this.sdkSessionId ? { resume: this.sdkSessionId } : { persistSession: true }),
      ...(this.config.extendedContext ? { betas: ["context-1m-2025-08-07" as never] } : {}),
      abortController,
    };

    const { text, sessionId: newSdkSessionId } = await queryForText(prompt, options);

    if (newSdkSessionId) {
      this.sdkSessionId = newSdkSessionId;
    }

    // Parse and apply the updated state
    const updatedState = parseJSON<ContextState>(text);
    if (updatedState) {
      // Preserve turn and intentHistory (Context Agent manages these internally)
      updatedState.turn = this.state.turn;
      updatedState.intentHistory = this.state.intentHistory;
      this.state = updatedState;

      // Emit state update event
      send(ws, {
        type: "context_agent_event",
        sessionId: this.sessionId,
        event: { type: "state_updated", state: this.state },
      });

      console.log(
        `[context-agent] State updated: taskStatus=${this.state.taskStatus}, files=${Object.keys(this.state.files).length}, decisions=${this.state.decisions.length}`,
      );
    } else {
      console.warn("[context-agent] Failed to parse state update response, keeping previous state");
    }

    // Persist to session store
    this.persist();
  }

  // ── Direct Handling ───────────────────────────────────────

  /**
   * Handle a message directly when complexity is low enough.
   * The Context Agent itself acts as the execution agent.
   */
  async handleDirectly(
    userMessage: string,
    ws: WebSocket,
    messageId: string,
    abortController: AbortController,
  ): Promise<string> {
    send(ws, {
      type: "context_agent_event",
      sessionId: this.sessionId,
      event: {
        type: "classification",
        intent: "direct",
        complexity: "low",
        routedTo: this.config.model,
        handleDirectly: true,
      },
    });

    const projectRoot = getGlobalProjectRoot();

    const options: Options = {
      model: this.config.model,
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      tools: { type: "preset" as const, preset: "claude_code" as const },
      ...(projectRoot ? { cwd: projectRoot } : {}),
      settingSources: ["project" as const],
      includePartialMessages: true,
      systemPrompt: CONTEXT_AGENT_SYSTEM_PROMPT,
      ...(this.sdkSessionId ? { resume: this.sdkSessionId } : { persistSession: true }),
      ...(this.config.extendedContext ? { betas: ["context-1m-2025-08-07" as never] } : {}),
      abortController,
    };

    let result = "";

    for await (const event of query({ prompt: userMessage, options })) {
      if (event.type === "stream_event") {
        const streamEvent = event.event;
        if (
          streamEvent.type === "content_block_delta" &&
          "delta" in streamEvent &&
          streamEvent.delta.type === "text_delta"
        ) {
          result += streamEvent.delta.text;
          send(ws, {
            type: "assistant_text",
            messageId,
            delta: streamEvent.delta.text,
          });
        }
      } else if (event.type === "result" && event.subtype === "success") {
        const resultSessionId = (event as Record<string, unknown>).session_id as string | undefined;
        if (resultSessionId) {
          this.sdkSessionId = resultSessionId;
        }
        send(ws, {
          type: "assistant_text_done",
          messageId,
          model: this.config.model,
          tokensIn: event.usage?.input_tokens ?? 0,
          tokensOut: event.usage?.output_tokens ?? 0,
          costUsd: event.total_cost_usd ?? 0,
        });
      }
    }

    return result;
  }

  // ── Cross-Session Memory ────────────────────────────────────

  /**
   * Search for prior sessions related to keywords.
   * Returns context from matching sessions that can be included in briefings.
   */
  searchCrossSession(keywords: string[]): string | null {
    if (keywords.length === 0) return null;

    const matches = searchSessions(keywords);
    if (matches.length === 0) return null;

    const contextParts: string[] = [];

    for (const match of matches.slice(0, 3)) {
      const session = loadSession(match.sessionId);
      if (!session) continue;

      const state = session.contextState as ContextState | undefined;
      if (state) {
        const fileSummaries = Object.entries(state.files)
          .map(([path, info]) => `  - ${path}: ${info.summary}${info.changes ? ` (${info.changes})` : ""}`)
          .join("\n");

        contextParts.push(
          `PRIOR SESSION: "${match.taskDescription}" (${new Date(match.updatedAt).toLocaleDateString()})` +
          `\n  Status: ${state.taskStatus}` +
          (state.decisions.length > 0 ? `\n  Decisions: ${state.decisions.join("; ")}` : "") +
          (fileSummaries ? `\n  Files:\n${fileSummaries}` : "") +
          (state.keyInsight ? `\n  Key insight: ${state.keyInsight}` : "") +
          (state.pendingUserAction ? `\n  Pending: ${state.pendingUserAction}` : ""),
        );
      } else {
        contextParts.push(
          `PRIOR SESSION: "${match.taskDescription}" (${new Date(match.updatedAt).toLocaleDateString()})`,
        );
      }
    }

    if (contextParts.length === 0) return null;

    console.log(`[context-agent] Cross-session search: ${matches.length} match(es) for [${keywords.join(", ")}]`);
    return contextParts.join("\n\n");
  }

  // ── State Access ──────────────────────────────────────────

  getState(): ContextState {
    return this.state;
  }

  getConfig(): ContextAgentConfig {
    return this.config;
  }

  getSdkSessionId(): string | null {
    return this.sdkSessionId;
  }

  // ── Persistence ───────────────────────────────────────────

  persist(): void {
    if (!this.config.persistState) return;

    saveSession(this.sessionId, {
      sessionId: this.sessionId,
      taskDescription: this.state.task,
      messages: [], // Messages are tracked by the SDK session, not here
      contextState: this.state as unknown as Record<string, unknown>,
      sdkSessionId: this.sdkSessionId ?? undefined,
      contextAgentConfig: this.config as unknown as Record<string, unknown>,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }

  /**
   * Load a Context Agent from the session store.
   * Returns null if no persisted session exists.
   */
  static loadFromStore(
    sessionId: string,
    config?: Partial<ContextAgentConfig>,
  ): ContextAgent | null {
    const session = loadSession(sessionId);
    if (!session?.contextState) return null;

    const agent = new ContextAgent(
      sessionId,
      { ...DEFAULT_CONTEXT_AGENT_CONFIG, ...(session.contextAgentConfig as Partial<ContextAgentConfig> | undefined), ...config },
      session.contextState as unknown as ContextState,
    );

    if (session.sdkSessionId) {
      agent.sdkSessionId = session.sdkSessionId;
    }

    console.log(
      `[context-agent] Restored session ${sessionId}: turn=${agent.state.turn}, task="${agent.state.task.slice(0, 60)}"`,
    );

    return agent;
  }
}

// ── Context Agent Manager ───────────────────────────────────

export class ContextAgentManager {
  private agents = new Map<string, ContextAgent>();

  /**
   * Get an existing Context Agent or create a new one for a session.
   * Tries to load from the session store first.
   */
  getOrCreate(
    sessionId: string,
    config?: Partial<ContextAgentConfig>,
  ): ContextAgent {
    let agent = this.agents.get(sessionId);
    if (agent) return agent;

    // Try to restore from persistent store
    agent = ContextAgent.loadFromStore(sessionId, config) ?? undefined;
    if (agent) {
      this.agents.set(sessionId, agent);
      return agent;
    }

    // Create fresh
    agent = new ContextAgent(sessionId, config);
    this.agents.set(sessionId, agent);
    console.log(`[context-agent] Created new agent for session ${sessionId}`);
    return agent;
  }

  /** Remove an agent (e.g., when frontend deletes a session). */
  remove(sessionId: string): void {
    this.agents.delete(sessionId);
  }

  /** Persist all active agents to the session store. */
  persistAll(): void {
    for (const agent of this.agents.values()) {
      agent.persist();
    }
  }

  /** Get an agent without creating one. */
  get(sessionId: string): ContextAgent | undefined {
    return this.agents.get(sessionId);
  }
}
