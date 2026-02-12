/**
 * Structured state tracked by the Context Agent across turns.
 * Implements the state object defined in docs/archon-ide-plan.md.
 */

// ── State Types ─────────────────────────────────────────────

export interface FileState {
  summary: string;
  changes?: string;
  modified: string; // "turn N"
  lines?: number;
}

export interface ErrorRecord {
  turn: number;
  error: string;
  resolution?: string;
  file?: string;
}

export interface IntentRecord {
  turn: number;
  intent: string;
  complexity: "low" | "medium" | "high";
  routedTo: string;
}

export interface ContextState {
  /** Current task description */
  task: string;
  /** Task lifecycle status */
  taskStatus: "pending" | "in_progress" | "implemented" | "completed" | "failed";
  /** Map of file paths to their tracked state */
  files: Record<string, FileState>;
  /** Key decisions made during the session */
  decisions: string[];
  /** Errors encountered and their resolutions */
  errors: ErrorRecord[];
  /** The single most important constraint or insight */
  keyInsight?: string;
  /** What the user needs to do next (if anything) */
  pendingUserAction?: string;
  /** Current turn number */
  turn: number;
  /** Intent classification results per turn */
  intentHistory: IntentRecord[];
}

export function createInitialState(task: string): ContextState {
  return {
    task,
    taskStatus: "pending",
    files: {},
    decisions: [],
    errors: [],
    turn: 0,
    intentHistory: [],
  };
}

// ── Configuration ───────────────────────────────────────────

export interface ContextAgentConfig {
  /** Model for the Context Agent itself (default: "sonnet") */
  model: "haiku" | "sonnet" | "opus";
  /** Enable 1M context window beta (default: true for Sonnet) */
  extendedContext: boolean;
  /** Complexity thresholds for routing */
  routingRules: {
    highComplexityModel: "opus" | "sonnet";
    mediumComplexityModel: "sonnet" | "haiku";
    lowComplexityModel: "haiku" | "sonnet";
  };
  /** Whether to persist state across sessions */
  persistState: boolean;
}

export const DEFAULT_CONTEXT_AGENT_CONFIG: ContextAgentConfig = {
  model: "sonnet",
  extendedContext: true,
  routingRules: {
    highComplexityModel: "opus",
    mediumComplexityModel: "sonnet",
    lowComplexityModel: "haiku",
  },
  persistState: true,
};
