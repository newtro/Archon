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
    const cleanEnv = { ...process.env };
    delete cleanEnv.CLAUDECODE;
    const proc = spawn("claude", ["auth", "status"], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 5000,
      env: cleanEnv,
      shell: true,
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
    const cleanEnv = { ...process.env };
    delete cleanEnv.CLAUDECODE;
    const proc = spawn("claude", ["--version"], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 5000,
      env: cleanEnv,
      shell: true,
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
  // --verbose is required when using --output-format stream-json with --print
  // --include-partial-messages enables real-time streaming of text deltas
  const args: string[] = [
    "--print",
    "--output-format", "stream-json",
    "--verbose",
    "--include-partial-messages",
  ];

  // Model
  if (options.model) {
    args.push("--model", options.model);
  }

  // Max turns
  if (options.maxTurns) {
    args.push("--max-turns", String(options.maxTurns));
  }

  // Permission mode — use the --permission-mode flag (preferred in current CLI)
  const permMode = options.permissionMode ?? "bypassPermissions";
  if (permMode === "bypassPermissions") {
    args.push("--permission-mode", "bypassPermissions");
  } else if (permMode === "acceptEdits") {
    args.push("--permission-mode", "acceptEdits");
  } else if (permMode === "default") {
    args.push("--permission-mode", "default");
  }

  // System prompt: prefer append (keeps Claude Code's built-in context) over replace.
  // On Windows with shell: true, newlines in arguments break cmd.exe's command parsing.
  // Replace literal newlines with spaces to keep it as a single command-line token.
  if (options.appendSystemPrompt) {
    args.push("--append-system-prompt", options.appendSystemPrompt.replace(/\n/g, " "));
  } else if (options.systemPrompt) {
    args.push("--system-prompt", options.systemPrompt.replace(/\n/g, " "));
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

  // The prompt is sent via stdin (not as a positional arg) to avoid Windows cmd.exe
  // shell escaping issues — cmd.exe breaks on newlines and special chars in arguments.
  // --print reads from stdin in text format by default when no positional arg is given.

  console.log(`[claude-code-runner] Spawning: claude ${args.join(" ")}`);
  console.log(`[claude-code-runner] cwd: ${options.cwd}`);
  console.log(`[claude-code-runner] Prompt (${prompt.length} chars): ${prompt.slice(0, 200)}`);

  return new Promise<ClaudeCodeResult>((resolve, reject) => {
    // Strip ANTHROPIC_API_KEY so the CLI uses subscription auth, not API billing
    // Strip CLAUDECODE to avoid nested-session detection when sidecar runs under Claude Code
    const cleanEnv = { ...process.env };
    delete cleanEnv.ANTHROPIC_API_KEY;
    delete cleanEnv.CLAUDECODE;

    const proc: ChildProcess = spawn("claude", args, {
      cwd: options.cwd,
      // stdin is "pipe" — we write the user prompt to it and close immediately.
      stdio: ["pipe", "pipe", "pipe"],
      env: cleanEnv,
      shell: true, // Required on Windows to resolve .cmd/.bat shims (e.g. npm-installed CLIs)
    });

    // Send the user prompt via stdin to avoid shell escaping issues on Windows.
    // Close stdin immediately so the CLI doesn't hang waiting for more input.
    if (proc.stdin) {
      proc.stdin.write(prompt);
      proc.stdin.end();
    }

    const parser = new StreamJsonParser();
    let fullResult = "";
    let inputTokens = 0;
    let outputTokens = 0;
    let totalCost = 0;
    let sessionId: string | undefined;
    let stderr = "";
    let settled = false;
    // Track whether we've been emitting via stream_event deltas,
    // so we skip the final "assistant" event's text (which duplicates)
    let streamedViaDeltas = false;

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
    // With --include-partial-messages, the CLI emits:
    //   system (init) → stream_event (message_start, content_block_start,
    //   content_block_delta×N, content_block_stop, message_delta, message_stop)
    //   → assistant (full message, duplicates delta text) → result (usage/cost)
    // Tool use flows: stream_event content_block_start with type "tool_use",
    //   then input_json_delta events, then the "user" event with tool results.
    parser.on("event", (event: Record<string, unknown>) => {
      const type = event.type as string;

      switch (type) {
        case "stream_event": {
          // Real-time streaming events from the Anthropic API
          const inner = event.event as Record<string, unknown>;
          if (!inner) break;
          const eventType = inner.type as string;

          switch (eventType) {
            case "content_block_delta": {
              const delta = inner.delta as Record<string, unknown>;
              if (!delta) break;
              if (delta.type === "text_delta") {
                const text = delta.text as string;
                if (text) {
                  fullResult += text;
                  streamedViaDeltas = true;
                  callbacks.onTextDelta(text);
                }
              }
              // input_json_delta is for tool call arguments — we handle
              // tool_use from the full "assistant" message instead
              break;
            }
            case "content_block_start": {
              // Tool use blocks start here with partial info
              const block = inner.content_block as Record<string, unknown>;
              if (block?.type === "tool_use") {
                const toolId = block.id as string;
                toolStartTimes.set(toolId, Date.now());
                // Args arrive incrementally via input_json_delta — we'll
                // emit onToolCallStart from the full "assistant" message
                // which has complete args. Store the start time now.
              }
              break;
            }
            // message_start, content_block_stop, message_delta, message_stop
            // are lifecycle events — no action needed
            default:
              break;
          }
          break;
        }

        case "assistant": {
          // Full assistant message — arrives after all stream_event deltas.
          // If we already streamed text via deltas, skip re-emitting text.
          // But we still need this for tool_use blocks (complete args).
          const message = event.message as Record<string, unknown>;
          const content = message?.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              const b = block as Record<string, unknown>;
              if (b.type === "text" && !streamedViaDeltas) {
                // Fallback: if deltas weren't emitted, use the full text
                const text = b.text as string;
                fullResult += text;
                callbacks.onTextDelta(text);
              } else if (b.type === "tool_use") {
                const toolId = b.id as string;
                const toolName = b.name as string;
                const toolArgs = (b.input as Record<string, unknown>) ?? {};
                // Set start time if not already set by stream_event
                if (!toolStartTimes.has(toolId)) {
                  toolStartTimes.set(toolId, Date.now());
                }
                callbacks.onToolCallStart(toolId, toolName, toolArgs);
              }
            }
          }
          // Reset for next turn (multi-turn agentic loops)
          streamedViaDeltas = false;
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
          // Log unknown types to help debug future format changes
          console.log(`[claude-code-runner] Unhandled event type: ${type}`, JSON.stringify(event).slice(0, 200));
          break;
        }
      }
    });

    proc.stdout?.on("data", (chunk: Buffer) => {
      parser.feed(chunk.toString());
    });

    proc.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      // Log stderr in real-time to help debug CLI issues
      console.error(`[claude-code-runner:stderr] ${text.trimEnd()}`);
    });

    proc.on("error", (err) => {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      settle(() => {
        reject(new Error(`Failed to spawn claude CLI: ${err.message}. Is Claude Code installed? Run: curl -fsSL https://claude.ai/install.sh | bash`));
      });
    });

    proc.on("close", (code) => {
      console.log(`[claude-code-runner] Process exited with code ${code}`);
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
