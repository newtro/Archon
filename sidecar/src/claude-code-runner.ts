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
  systemPrompt?: string;
  cwd: string;
  abortSignal?: AbortSignal;
  /** Max turns for the agentic loop (Claude Code --max-turns) */
  maxTurns?: number;
  /** Permission mode: default "bypassPermissions" to match SDK behavior */
  permissionMode?: "default" | "acceptEdits" | "bypassPermissions";
  /** MCP server config file path (optional) */
  mcpConfigPath?: string;
  /** Whether to allow network access */
  allowNetwork?: boolean;
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
 * Returns true if logged in, false otherwise.
 */
export async function isClaudeCodeAuthenticated(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn("claude", ["--version"], {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 5000,
    });
    let stdout = "";
    proc.stdout?.on("data", (d) => (stdout += d.toString()));
    proc.on("error", () => resolve(false));
    proc.on("close", (code) => {
      // If claude CLI exists and runs, check auth status
      if (code === 0 && stdout.includes("claude")) {
        // Try a simple auth check
        const authProc = spawn("claude", ["--print", "--message", "ping", "--max-turns", "1", "--output-format", "json"], {
          stdio: ["pipe", "pipe", "pipe"],
          timeout: 10000,
        });
        authProc.on("error", () => resolve(false));
        authProc.on("close", (authCode) => {
          resolve(authCode === 0);
        });
      } else {
        resolve(false);
      }
    });
  });
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
    "--verbose",
  ];

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

  // System prompt
  if (options.systemPrompt) {
    args.push("--system-prompt", options.systemPrompt);
  }

  // MCP config
  if (options.mcpConfigPath) {
    args.push("--mcp-config", options.mcpConfigPath);
  }

  // Additional flags
  if (options.additionalFlags) {
    args.push(...options.additionalFlags);
  }

  // The prompt itself
  args.push("--message", prompt);

  return new Promise<ClaudeCodeResult>((resolve, reject) => {
    const proc: ChildProcess = spawn("claude", args, {
      cwd: options.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        // Don't pass ANTHROPIC_API_KEY — we want CLI auth (subscription)
      },
    });

    const parser = new StreamJsonParser();
    let fullResult = "";
    let inputTokens = 0;
    let outputTokens = 0;
    let totalCost = 0;
    let sessionId: string | undefined;
    let stderr = "";

    // Track tool call timings
    const toolStartTimes = new Map<string, number>();

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
          // Log unknown event types for debugging
          console.log(`[claude-code-runner] Event: ${type}`);
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
      reject(new Error(`Failed to spawn claude CLI: ${err.message}. Is Claude Code installed? Run: curl -fsSL https://claude.ai/install.sh | bash`));
    });

    proc.on("close", (code) => {
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
