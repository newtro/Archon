/**
 * Claude Code CLI Runner.
 * Alternative to the Agent SDK that uses the Claude Code CLI process,
 * authenticating via the user's Anthropic Max subscription instead of API keys.
 *
 * This provides the same agentic capabilities (tool use, multi-turn, file ops)
 * but runs against the subscription rather than pay-per-token API billing.
 *
 * Usage pattern mirrors openrouter-runner.ts — used by flow LLM nodes when
 * provider === "claude-code", and by the chat agent when the user opts in.
 */

import { spawn, type ChildProcess } from "child_process";
import { EventEmitter } from "events";

// ── Public Types ─────────────────────────────────────────────────

export interface ClaudeCodeOptions {
  model?: string; // e.g. "sonnet", "opus" — maps to Claude Code model flags
  /** System prompt — replaces Claude Code's default. Use appendSystemPrompt to add to it instead. */
  systemPrompt?: string;
  /** Appended to Claude Code's built-in system prompt instead of replacing it. */
  appendSystemPrompt?: string;
  cwd: string;
  abortSignal?: AbortSignal;
  /** Max turns for the agentic loop (Claude Code --max-turns) */
  maxTurns?: number;
  /** Permission mode: default "bypassPermissions" to match SDK behavior */
  permissionMode?: "default" | "acceptEdits" | "bypassPermissions";
  /** MCP server config file path (optional) */
  mcpConfigPath?: string;
  /** Whether to allow network access (adds --allow-network flag) */
  allowNetwork?: boolean;
  /** Timeout in ms — kills the CLI process if exceeded */
  timeoutMs?: number;
  /** Enable verbose/debug output on stderr */
  verbose?: boolean;
  /** Additional CLI flags */
  additionalFlags?: string[];
}

export interface ClaudeCodeStreamCallbacks {
  onTextDelta: (text: string) => void;
  onToolCallStart: (id: string, name: string, args: Record<string, unknown>) => void;
  onToolCallDone: (id: string, result: string, isError: boolean, durationMs: number) => void;
  /** Called when result event arrives with usage info */
  onResult?: (result: ClaudeCodeResult) => void;
}

export interface ClaudeCodeResult {
  result: string;
  totalCost: number;
  inputTokens: number;
  outputTokens: number;
  sessionId?: string;
}

// ── Auth Check ───────────────────────────────────────────────────

/**
 * Check if the user is authenticated with Claude Code CLI.
 * Uses `claude auth status` which is lightweight (no model call).
 * Only caches positive results — negative results are rechecked each time
 * so that logging in takes effect immediately.
 */
let authCacheResult: boolean | null = null;
let authCacheTime = 0;
const AUTH_CACHE_TTL_MS = 60_000;

export async function isClaudeCodeAuthenticated(): Promise<boolean> {
  const now = Date.now();
  // Only use cache for positive results
  if (authCacheResult === true && now - authCacheTime < AUTH_CACHE_TTL_MS) {
    return true;
  }

  const result = await new Promise<boolean>((resolve) => {
    const proc = spawn("claude", ["auth", "status"], {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 5000,
    });
    proc.on("error", () => resolve(false));
    proc.on("close", (code) => resolve(code === 0));
  });

  authCacheResult = result;
  authCacheTime = now;
  return result;
}

/**
 * Check if Claude Code CLI is installed.
 */
export async function isClaudeCodeInstalled(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn("claude", ["--version"], {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 5000,
    });
    proc.on("error", () => resolve(false));
    proc.on("close", (code) => resolve(code === 0));
  });
}

// ── Streaming JSON Parser ────────────────────────────────────────

/**
 * Parse newline-delimited JSON from Claude Code CLI --output-format stream-json.
 * Each line is a JSON object representing an event.
 */
class StreamJsonParser extends EventEmitter {
  private buffer = "";

  feed(chunk: string): void {
    this.buffer += chunk;
    const lines = this.buffer.split("\n");
    // Keep the last (potentially incomplete) line in the buffer
    this.buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const obj = JSON.parse(trimmed);
        this.emit("event", obj);
      } catch {
        // Skip malformed JSON lines
        console.warn("[claude-code-runner] Malformed JSON line:", trimmed.slice(0, 200));
      }
    }
  }

  flush(): void {
    if (this.buffer.trim()) {
      try {
        const obj = JSON.parse(this.buffer.trim());
        this.emit("event", obj);
      } catch {
        // ignore
      }
      this.buffer = "";
    }
  }
}

// ── Agentic Runner ───────────────────────────────────────────────

/**
 * Run Claude Code CLI as an agentic subprocess.
 * Uses --output-format stream-json for real-time event streaming.
 */
export async function runClaudeCodeAgent(
  prompt: string,
  options: ClaudeCodeOptions,
  callbacks: ClaudeCodeStreamCallbacks,
): Promise<ClaudeCodeResult> {
  // Build CLI arguments
  const args: string[] = [
    "--print",
    "--output-format", "stream-json",
  ];

  // Only enable verbose when explicitly requested
  if (options.verbose) {
    args.push("--verbose");
  }

  // Model
  if (options.model) {
    args.push("--model", options.model);
  }

  // Max turns
  if (options.maxTurns) {
    args.push("--max-turns", String(options.maxTurns));
  }

  // Permission mode
  const permMode = options.permissionMode ?? "bypassPermissions";
  if (permMode === "bypassPermissions") {
    args.push("--dangerously-skip-permissions");
  } else if (permMode === "acceptEdits") {
    args.push("--allowedTools", "Edit,Write,MultiEdit");
  }

  // System prompt: prefer append (keeps Claude Code's built-in context) over replace
  if (options.appendSystemPrompt) {
    args.push("--append-system-prompt", options.appendSystemPrompt);
  } else if (options.systemPrompt) {
    args.push("--system-prompt", options.systemPrompt);
  }

  // MCP config
  if (options.mcpConfigPath) {
    args.push("--mcp-config", options.mcpConfigPath);
  }

  // Network access
  if (options.allowNetwork) {
    args.push("--allow-network");
  }

  // Additional flags
  if (options.additionalFlags) {
    args.push(...options.additionalFlags);
  }

  // The prompt itself
  args.push("--message", prompt);

  return new Promise<ClaudeCodeResult>((resolve, reject) => {
    // Strip ANTHROPIC_API_KEY so the CLI uses subscription auth, not API billing
    const cleanEnv = { ...process.env };
    delete cleanEnv.ANTHROPIC_API_KEY;

    const proc: ChildProcess = spawn("claude", args, {
      cwd: options.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: cleanEnv,
    });

    const parser = new StreamJsonParser();
    let fullResult = "";
    let inputTokens = 0;
    let outputTokens = 0;
    let totalCost = 0;
    let sessionId: string | undefined;
    let stderr = "";
    let settled = false;

    // Track tool call timings
    const toolStartTimes = new Map<string, number>();

    const settle = (fn: () => void) => {
      if (!settled) {
        settled = true;
        fn();
      }
    };

    // Handle timeout
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    if (options.timeoutMs && options.timeoutMs > 0) {
      timeoutTimer = setTimeout(() => {
        proc.kill("SIGTERM");
        // Give it 5s to exit gracefully, then SIGKILL
        setTimeout(() => {
          try { proc.kill("SIGKILL"); } catch { /* already dead */ }
        }, 5000);
        settle(() => {
          if (fullResult) {
            // Partial result is better than nothing
            resolve({ result: fullResult, totalCost, inputTokens, outputTokens, sessionId });
          } else {
            reject(new Error(`Claude Code CLI timed out after ${options.timeoutMs}ms`));
          }
        });
      }, options.timeoutMs);
    }

    // Handle abort
    if (options.abortSignal) {
      const onAbort = () => {
        proc.kill("SIGTERM");
      };
      options.abortSignal.addEventListener("abort", onAbort, { once: true });
      proc.on("close", () => {
        options.abortSignal?.removeEventListener("abort", onAbort);
      });
    }

    // Parse streaming events
    parser.on("event", (event: Record<string, unknown>) => {
      const type = event.type as string;

      switch (type) {
        case "assistant": {
          // Assistant message with content blocks
          const message = event.message as Record<string, unknown>;
          const content = message?.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              const b = block as Record<string, unknown>;
              if (b.type === "text") {
                const text = b.text as string;
                fullResult += text;
                callbacks.onTextDelta(text);
              } else if (b.type === "tool_use") {
                const toolId = b.id as string;
                const toolName = b.name as string;
                const toolArgs = (b.input as Record<string, unknown>) ?? {};
                toolStartTimes.set(toolId, Date.now());
                callbacks.onToolCallStart(toolId, toolName, toolArgs);
              }
            }
          }
          break;
        }

        case "user": {
          // Tool result
          const parentToolId = event.parent_tool_use_id as string;
          if (parentToolId) {
            let resultText = "";
            let isError = false;

            const msgContent = (event.message as Record<string, unknown>)?.content;
            if (Array.isArray(msgContent)) {
              for (const block of msgContent) {
                const b = block as Record<string, unknown>;
                if (b.type === "tool_result") {
                  if (b.is_error) isError = true;
                  const c = b.content;
                  if (typeof c === "string") resultText = c;
                  else if (Array.isArray(c)) {
                    resultText = c
                      .filter((x: Record<string, unknown>) => x.type === "text")
                      .map((x: Record<string, unknown>) => x.text as string)
                      .join("\n");
                  }
                }
              }
            }

            const startTime = toolStartTimes.get(parentToolId) ?? Date.now();
            const durationMs = Date.now() - startTime;
            toolStartTimes.delete(parentToolId);
            callbacks.onToolCallDone(parentToolId, resultText, isError, durationMs);
          }
          break;
        }

        case "result": {
          // Final result with usage stats
          const usage = event.usage as Record<string, number> | undefined;
          if (usage) {
            inputTokens = usage.input_tokens ?? 0;
            outputTokens = usage.output_tokens ?? 0;
          }
          totalCost = (event.total_cost_usd as number) ?? 0;
          sessionId = event.session_id as string | undefined;

          // Extract final text if we missed it from streaming
          if (!fullResult && event.result) {
            fullResult = event.result as string;
          }
          break;
        }

        case "system": {
          // System init event — log for debugging
          console.log(`[claude-code-runner] System event: model=${event.model}, cwd=${event.cwd}`);
          break;
        }

        default: {
          // Only log unknown types in verbose mode to reduce noise
          if (options.verbose) {
            console.log(`[claude-code-runner] Event: ${type}`);
          }
          break;
        }
      }
    });

    proc.stdout?.on("data", (chunk: Buffer) => {
      parser.feed(chunk.toString());
    });

    proc.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("error", (err) => {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      settle(() => {
        reject(new Error(`Failed to spawn claude CLI: ${err.message}. Is Claude Code installed? Run: curl -fsSL https://claude.ai/install.sh | bash`));
      });
    });

    proc.on("close", (code) => {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      parser.flush();

      const result: ClaudeCodeResult = {
        result: fullResult,
        totalCost,
        inputTokens,
        outputTokens,
        sessionId,
      };

      if (callbacks.onResult) {
        callbacks.onResult(result);
      }

      settle(() => {
        if (code !== 0 && !options.abortSignal?.aborted) {
          // Non-zero exit but may still have partial results
          if (fullResult) {
            resolve(result);
          } else {
            reject(new Error(`Claude Code exited with code ${code}: ${stderr.slice(0, 500)}`));
          }
        } else {
          resolve(result);
        }
      });
    });
  });
}

// ── Session Resume ───────────────────────────────────────────────

/**
 * Resume a previous Claude Code session for multi-turn conversation.
 */
export async function resumeClaudeCodeSession(
  prompt: string,
  sessionId: string,
  options: ClaudeCodeOptions,
  callbacks: ClaudeCodeStreamCallbacks,
): Promise<ClaudeCodeResult> {
  const resumeOptions = {
    ...options,
    additionalFlags: [
      ...(options.additionalFlags ?? []),
      "--resume", sessionId,
    ],
  };
  return runClaudeCodeAgent(prompt, resumeOptions, callbacks);
}
