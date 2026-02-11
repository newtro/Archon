import { useState } from "react";
import {
  FileText, FilePlus, Pencil, Terminal, FolderSearch, Search,
  Globe, Wrench, CheckCircle, XCircle, ChevronDown,
} from "lucide-react";
import { parseAnsi } from "../../lib/ansi";
import type { ToolCall } from "../../lib/types";
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
    default:
      return name;
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

export function ToolCallCard({ toolCall }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false);
  const config = TOOL_CONFIG[toolCall.name] ?? { icon: "wrench", color: "var(--accent-slate)", label: toolCall.name };
  const summary = getToolSummary(toolCall);
  const isLoading = toolCall.status === "loading";
  const isError = toolCall.status === "error";

  const elapsed = toolCall.durationMs
    ? toolCall.durationMs < 1000
      ? `${toolCall.durationMs}ms`
      : `${(toolCall.durationMs / 1000).toFixed(1)}s`
    : isLoading
      ? `${Math.round((Date.now() - toolCall.startedAt))}ms`
      : "";

  const renderExpandedContent = () => {
    if (!toolCall.result) return null;

    // Edit tool: show inline diff
    if (toolCall.name === "Edit") {
      return <EditDiffView toolCall={toolCall} />;
    }

    // Bash tool: render ANSI colors
    if (toolCall.name === "Bash") {
      return <BashResultView result={toolCall.result} />;
    }

    // Default: plain text
    return <pre className="tool-result">{toolCall.result}</pre>;
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
          <span className={`tool-status ${toolCall.status}`}>
            {toolCall.status === "success" ? (
              <CheckCircle size={14} />
            ) : toolCall.status === "error" ? (
              <XCircle size={14} />
            ) : null}
          </span>
        )}
        {!isLoading && toolCall.result && (
          <ChevronDown size={12} className={`tool-chevron ${expanded ? "open" : ""}`} />
        )}
      </button>
      {isLoading && <div className="tool-progress-bar" />}
      {expanded && toolCall.result && (
        <div className="tool-card-content">
          {renderExpandedContent()}
        </div>
      )}
    </div>
  );
}
