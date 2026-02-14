import { useState, useEffect } from "react";
import {
  FileText, FilePlus, Pencil, Terminal, FolderSearch, Search,
  Globe, Wrench, CheckCircle, XCircle, ChevronDown,
  ListTodo, Cpu, NotebookPen,
} from "lucide-react";
import { parseAnsi } from "../../lib/ansi";
import type { ToolCall } from "../../lib/types";
import { getToolCompletion } from "../../lib/tool-completion-store";
import "./ToolCallCard.css";

interface ToolCallCardProps {
  toolCall: ToolCall;
}

const TOOL_CONFIG: Record<string, { icon: string; color: string; label: string }> = {
  Read: { icon: "file-text", color: "var(--accent-blue)", label: "Read" },
  Write: { icon: "file-plus", color: "var(--accent-green)", label: "Write" },
  Edit: { icon: "pencil", color: "var(--accent-amber)", label: "Edit" },
  Bash: { icon: "terminal", color: "var(--accent-purple)", label: "Bash" },
  Glob: { icon: "folder-search", color: "var(--accent-cyan)", label: "Glob" },
  Grep: { icon: "search", color: "var(--accent-teal)", label: "Grep" },
  WebSearch: { icon: "globe", color: "var(--accent-indigo)", label: "WebSearch" },
  WebFetch: { icon: "globe", color: "var(--accent-indigo)", label: "WebFetch" },
  Task: { icon: "cpu", color: "var(--accent-purple)", label: "Task" },
  TodoWrite: { icon: "list-todo", color: "var(--accent-amber)", label: "Todo" },
  NotebookEdit: { icon: "notebook", color: "var(--accent-green)", label: "Notebook" },
};

function getToolSummary(toolCall: ToolCall): string {
  const { name, args, result, status } = toolCall;

  switch (name) {
    case "Read": {
      const path = (args.file_path as string) ?? "";
      const fileName = path.split(/[/\\]/).pop() ?? path;
      if (status === "success" && result) {
        const lineCount = result.split("\n").length;
        return `${fileName} -- ${lineCount} lines`;
      }
      return fileName;
    }
    case "Write": {
      const path = (args.file_path as string) ?? "";
      const fileName = path.split(/[/\\]/).pop() ?? path;
      return `Created ${fileName}`;
    }
    case "Edit": {
      const path = (args.file_path as string) ?? "";
      const fileName = path.split(/[/\\]/).pop() ?? path;
      return `${fileName}`;
    }
    case "Bash": {
      const cmd = (args.command as string) ?? "";
      const shortCmd = cmd.length > 60 ? cmd.slice(0, 60) + "..." : cmd;
      if (status === "success" && result) {
        const lines = result.trim().split("\n");
        const lastLine = lines[lines.length - 1] ?? "";
        return `$ ${shortCmd} -> ${lastLine.slice(0, 50)}`;
      }
      return `$ ${shortCmd}`;
    }
    case "Glob": {
      const pattern = (args.pattern as string) ?? "";
      if (status === "success" && result) {
        const count = result.trim().split("\n").filter(Boolean).length;
        return `Found ${count} files matching ${pattern}`;
      }
      return `Searching for ${pattern}`;
    }
    case "Grep": {
      const pattern = (args.pattern as string) ?? "";
      return `Searching for "${pattern}"`;
    }
    case "Task": {
      const desc = (args.description as string) ?? "";
      const agentType = (args.subagent_type as string) ?? "";
      if (desc) return `${agentType ? agentType + ": " : ""}${desc}`;
      const prompt = (args.prompt as string) ?? "";
      if (prompt) return prompt.length > 80 ? prompt.slice(0, 80) + "..." : prompt;
      return agentType || "Running agent";
    }
    case "TodoWrite": {
      const todos = args.todos as Array<Record<string, unknown>> | undefined;
      if (!todos || !Array.isArray(todos)) return "Updating tasks";
      const inProgress = todos.filter((t) => t.status === "in_progress");
      const completed = todos.filter((t) => t.status === "completed");
      const pending = todos.filter((t) => t.status === "pending");
      const parts: string[] = [];
      if (inProgress.length > 0) {
        const active = (inProgress[0].activeForm as string) ?? (inProgress[0].content as string) ?? "";
        parts.push(active);
      }
      parts.push(`${completed.length}/${todos.length} done`);
      if (pending.length > 0) parts.push(`${pending.length} pending`);
      return parts.join(" -- ");
    }
    case "WebSearch": {
      const query = (args.query as string) ?? "";
      return query ? `"${query}"` : "Searching...";
    }
    case "WebFetch": {
      const url = (args.url as string) ?? "";
      if (url) {
        try {
          const hostname = new URL(url).hostname;
          return hostname;
        } catch {
          return url.length > 60 ? url.slice(0, 60) + "..." : url;
        }
      }
      return "Fetching...";
    }
    case "NotebookEdit": {
      const nbPath = (args.notebook_path as string) ?? "";
      const nbName = nbPath.split(/[/\\]/).pop() ?? nbPath;
      return nbName || "Editing notebook";
    }
    default: {
      // Generic fallback: try common arg patterns
      if (args.file_path) {
        const fp = (args.file_path as string).split(/[/\\]/).pop() ?? args.file_path;
        return String(fp);
      }
      if (args.command) {
        const cmd = String(args.command);
        return cmd.length > 60 ? cmd.slice(0, 60) + "..." : cmd;
      }
      if (args.query) return String(args.query);
      if (args.pattern) return String(args.pattern);
      if (args.prompt) {
        const p = String(args.prompt);
        return p.length > 60 ? p.slice(0, 60) + "..." : p;
      }
      // Show arg keys if there are any
      const keys = Object.keys(args);
      if (keys.length > 0) return keys.join(", ");
      return name;
    }
  }
}

const TOOL_ICONS: Record<string, React.ComponentType<{ size?: number }>> = {
  Read: FileText,
  Write: FilePlus,
  Edit: Pencil,
  Bash: Terminal,
  Glob: FolderSearch,
  Grep: Search,
  WebSearch: Globe,
  WebFetch: Globe,
  Task: Cpu,
  TodoWrite: ListTodo,
  NotebookEdit: NotebookPen,
};

function ToolIcon({ name }: { name: string }) {
  const Icon = TOOL_ICONS[name] ?? Wrench;
  return <Icon size={14} />;
}

/** Render an inline diff for Edit tool calls showing old_string vs new_string */
function EditDiffView({ toolCall }: { toolCall: ToolCall }) {
  const oldStr = toolCall.args.old_string as string | undefined;
  const newStr = toolCall.args.new_string as string | undefined;

  if (!oldStr && !newStr) {
    return <pre className="tool-result">{toolCall.result}</pre>;
  }

  const oldLines = (oldStr ?? "").split("\n");
  const newLines = (newStr ?? "").split("\n");

  return (
    <div className="diff-view">
      {oldLines.map((line, i) => (
        <div key={`r-${i}`} className="diff-line-removed">{line}</div>
      ))}
      {newLines.map((line, i) => (
        <div key={`a-${i}`} className="diff-line-added">{line}</div>
      ))}
    </div>
  );
}

/** Render Bash tool output with ANSI color code support */
function BashResultView({ result }: { result: string }) {
  const segments = parseAnsi(result);

  // Check if there are any styled segments
  const hasAnsi = segments.some((s) => s.className);

  if (!hasAnsi) {
    return <pre className="tool-result">{result}</pre>;
  }

  return (
    <pre className="tool-result">
      {segments.map((segment, i) =>
        segment.className ? (
          <span key={i} className={segment.className}>{segment.text}</span>
        ) : (
          segment.text
        ),
      )}
    </pre>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function ToolCallCard({ toolCall }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [tick, setTick] = useState(0);
  const config = TOOL_CONFIG[toolCall.name] ?? { icon: "wrench", color: "var(--accent-slate)", label: toolCall.name };

  // Check global completion store — this is the authoritative source for tool completion
  // It bypasses React state entirely, so it's immune to state update race conditions
  const completion = getToolCompletion(toolCall.id);

  // Derive effective status: global store takes priority over prop
  const effectiveStatus = completion?.status ?? toolCall.status;
  const effectiveDuration = completion?.durationMs ?? toolCall.durationMs;
  const effectiveResult = completion?.result ?? toolCall.result;

  const summary = getToolSummary(toolCall);
  const isLoading = effectiveStatus === "loading";
  const isError = effectiveStatus === "error";

  // Tick every 100ms while loading so the elapsed timer updates smoothly
  useEffect(() => {
    if (!isLoading) return;
    const id = setInterval(() => setTick((t) => t + 1), 100);
    return () => clearInterval(id);
  }, [isLoading]);

  // tick is only used to force re-renders; Date.now() computes the actual elapsed time
  void tick;
  const elapsed = effectiveDuration
    ? formatDuration(effectiveDuration)
    : isLoading
      ? formatDuration(Date.now() - toolCall.startedAt)
      : "";

  const renderExpandedContent = () => {
    if (!effectiveResult) return null;

    // Edit tool: show inline diff
    if (toolCall.name === "Edit") {
      return <EditDiffView toolCall={toolCall} />;
    }

    // Bash tool: render ANSI colors
    if (toolCall.name === "Bash") {
      return <BashResultView result={effectiveResult} />;
    }

    // Default: plain text
    return <pre className="tool-result">{effectiveResult}</pre>;
  };

  return (
    <div
      className={`tool-card ${isLoading ? "loading" : ""} ${isError ? "error" : ""}`}
      style={{ "--tool-color": config.color } as React.CSSProperties}
    >
      <button
        className="tool-card-header"
        onClick={() => !isLoading && setExpanded(!expanded)}
      >
        <span className="tool-icon">
          <ToolIcon name={toolCall.name} />
        </span>
        <span className="tool-name">{config.label}</span>
        <span className="tool-summary">{summary}</span>
        <span className="tool-spacer" />
        {elapsed && <span className="tool-duration">{elapsed}</span>}
        {!isLoading && (
          <span className={`tool-status ${effectiveStatus}`}>
            {effectiveStatus === "success" ? (
              <CheckCircle size={14} />
            ) : effectiveStatus === "error" ? (
              <XCircle size={14} />
            ) : null}
          </span>
        )}
        {!isLoading && effectiveResult && (
          <ChevronDown size={12} className={`tool-chevron ${expanded ? "open" : ""}`} />
        )}
      </button>
      {isLoading && <div className="tool-progress-bar" />}
      {expanded && effectiveResult && (
        <div className="tool-card-content">
          {renderExpandedContent()}
        </div>
      )}
    </div>
  );
}
