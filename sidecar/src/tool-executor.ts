/**
 * Tool Executor for OpenRouter LLM nodes.
 * Implements the same tools as the Claude Agent SDK (Read, Write, Edit, Bash, Glob, Grep)
 * in OpenAI function-calling format, with standalone execution functions.
 */

import * as fs from "fs/promises";
import * as path from "path";
import { execSync } from "child_process";
import { glob } from "glob";

// ── OpenAI Function-Calling Tool Definitions ─────────────────────

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "Read",
      description:
        "Read the contents of a file at the given absolute path. Returns the file content with line numbers.",
      parameters: {
        type: "object",
        properties: {
          file_path: {
            type: "string",
            description: "Absolute path to the file to read",
          },
          offset: {
            type: "number",
            description:
              "Line number to start reading from (1-based). Optional.",
          },
          limit: {
            type: "number",
            description: "Maximum number of lines to read. Optional.",
          },
        },
        required: ["file_path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "Write",
      description:
        "Write content to a file at the given absolute path. Creates the file if it does not exist, or overwrites it.",
      parameters: {
        type: "object",
        properties: {
          file_path: {
            type: "string",
            description: "Absolute path to the file to write",
          },
          content: {
            type: "string",
            description: "The content to write to the file",
          },
        },
        required: ["file_path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "Edit",
      description:
        "Edit a file by replacing a specific string with a new string. The old_string must match exactly (including whitespace).",
      parameters: {
        type: "object",
        properties: {
          file_path: {
            type: "string",
            description: "Absolute path to the file to edit",
          },
          old_string: {
            type: "string",
            description: "The exact string to find and replace",
          },
          new_string: {
            type: "string",
            description: "The replacement string",
          },
        },
        required: ["file_path", "old_string", "new_string"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "Bash",
      description:
        "Execute a shell command and return stdout + stderr. The command runs in the project working directory.",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "The shell command to execute",
          },
          timeout: {
            type: "number",
            description: "Timeout in milliseconds (max 120000). Optional.",
          },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "Glob",
      description:
        "Find files matching a glob pattern. Returns matching file paths.",
      parameters: {
        type: "object",
        properties: {
          pattern: {
            type: "string",
            description:
              "Glob pattern to match (e.g., '**/*.ts', 'src/**/*.tsx')",
          },
          path: {
            type: "string",
            description:
              "Directory to search in. Optional, defaults to working directory.",
          },
        },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "Grep",
      description:
        "Search file contents using a regex pattern. Returns matching file paths or matching lines with context.",
      parameters: {
        type: "object",
        properties: {
          pattern: {
            type: "string",
            description: "Regex pattern to search for",
          },
          path: {
            type: "string",
            description:
              "File or directory to search in. Optional, defaults to working directory.",
          },
          glob: {
            type: "string",
            description:
              "Glob pattern to filter files (e.g., '*.ts'). Optional.",
          },
          output_mode: {
            type: "string",
            enum: ["content", "files_with_matches", "count"],
            description: "Output mode. Default: files_with_matches.",
          },
          context: {
            type: "number",
            description: "Lines of context around matches. Optional.",
          },
        },
        required: ["pattern"],
      },
    },
  },
];

// ── Preset Resolution ────────────────────────────────────────────

const READ_ONLY_TOOLS = new Set(["Read", "Glob", "Grep"]);

export function resolveToolsForPreset(preset: string): ToolDefinition[] {
  switch (preset) {
    case "none":
      return [];
    case "read-only":
      return TOOL_DEFINITIONS.filter((t) =>
        READ_ONLY_TOOLS.has(t.function.name),
      );
    case "full-access":
      return [...TOOL_DEFINITIONS];
    default:
      return TOOL_DEFINITIONS.filter((t) =>
        READ_ONLY_TOOLS.has(t.function.name),
      );
  }
}

// ── Tool Execution ───────────────────────────────────────────────

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  cwd: string,
): Promise<{ result: string; isError: boolean }> {
  try {
    let result: string;
    switch (name) {
      case "Read":
        result = await executeRead(args);
        break;
      case "Write":
        result = await executeWrite(args);
        break;
      case "Edit":
        result = await executeEdit(args);
        break;
      case "Bash":
        result = await executeBash(args, cwd);
        break;
      case "Glob":
        result = await executeGlob(args, cwd);
        break;
      case "Grep":
        result = await executeGrep(args, cwd);
        break;
      default:
        return { result: `Unknown tool: ${name}`, isError: true };
    }
    return { result, isError: false };
  } catch (err) {
    return {
      result: err instanceof Error ? err.message : String(err),
      isError: true,
    };
  }
}

// ── Individual Tool Implementations ──────────────────────────────

async function executeRead(args: Record<string, unknown>): Promise<string> {
  const filePath = args.file_path as string;
  const content = await fs.readFile(filePath, "utf-8");
  const lines = content.split("\n");
  const offset = (args.offset as number) ?? 1;
  const limit = (args.limit as number) ?? lines.length;
  const slice = lines.slice(offset - 1, offset - 1 + limit);
  return slice
    .map((line, i) => `${String(offset + i).padStart(6)}\t${line}`)
    .join("\n");
}

async function executeWrite(args: Record<string, unknown>): Promise<string> {
  const filePath = args.file_path as string;
  const content = args.content as string;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf-8");
  return `Successfully wrote ${content.length} characters to ${filePath}`;
}

async function executeEdit(args: Record<string, unknown>): Promise<string> {
  const filePath = args.file_path as string;
  const oldStr = args.old_string as string;
  const newStr = args.new_string as string;
  const content = await fs.readFile(filePath, "utf-8");
  if (!content.includes(oldStr)) {
    throw new Error(
      `old_string not found in ${filePath}. Make sure it matches exactly including whitespace.`,
    );
  }
  const updated = content.replace(oldStr, newStr);
  await fs.writeFile(filePath, updated, "utf-8");
  return `Successfully edited ${filePath}`;
}

async function executeBash(
  args: Record<string, unknown>,
  cwd: string,
): Promise<string> {
  const command = args.command as string;
  const timeout = Math.min((args.timeout as number) ?? 120000, 120000);
  try {
    const output = execSync(command, {
      cwd,
      encoding: "utf-8",
      timeout,
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });
    return output || "(no output)";
  } catch (err: unknown) {
    const e = err as {
      stdout?: string;
      stderr?: string;
      message?: string;
      status?: number;
    };
    const parts = [e.stdout, e.stderr].filter(Boolean);
    return parts.length > 0
      ? parts.join("\n")
      : `Command failed with exit code ${e.status ?? "unknown"}: ${e.message ?? ""}`;
  }
}

async function executeGlob(
  args: Record<string, unknown>,
  cwd: string,
): Promise<string> {
  const pattern = args.pattern as string;
  const searchPath = (args.path as string) ?? cwd;
  const matches = await glob(pattern, {
    cwd: searchPath,
    absolute: true,
    nodir: true,
  });
  if (matches.length === 0) {
    return `No files matched pattern: ${pattern}`;
  }
  return matches.join("\n");
}

async function executeGrep(
  args: Record<string, unknown>,
  cwd: string,
): Promise<string> {
  const pattern = args.pattern as string;
  const searchPath = (args.path as string) ?? cwd;
  const outputMode =
    (args.output_mode as string) ?? "files_with_matches";
  const contextLines = (args.context as number) ?? 0;
  const fileGlob = args.glob as string | undefined;

  const rgArgs: string[] = [JSON.stringify(pattern), JSON.stringify(searchPath)];
  if (fileGlob) rgArgs.push(`--glob ${JSON.stringify(fileGlob)}`);
  if (outputMode === "files_with_matches") rgArgs.push("-l");
  if (outputMode === "count") rgArgs.push("-c");
  if (contextLines > 0) rgArgs.push(`-C ${contextLines}`);
  rgArgs.push("-n"); // line numbers

  try {
    const cmd = `rg ${rgArgs.join(" ")}`;
    return execSync(cmd, {
      cwd,
      encoding: "utf-8",
      timeout: 30000,
      maxBuffer: 5 * 1024 * 1024,
    });
  } catch (err: unknown) {
    const e = err as { stdout?: string; status?: number };
    // rg exits with code 1 when no matches found — that's not an error
    if (e.status === 1) {
      return `No matches found for pattern: ${pattern}`;
    }
    if (e.stdout) return e.stdout;
    return `No matches found for pattern: ${pattern}`;
  }
}
