import { useState, useRef, useEffect } from "react";
import { Trash2, Download, Filter } from "lucide-react";
import type { ChatMessage } from "../../lib/types";
import "./LogStreamPanel.css";

export interface LogEntry {
  id: string;
  timestamp: number;
  level: "info" | "tool" | "llm" | "error" | "flow";
  source: string;
  message: string;
  detail?: string;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  durationMs?: number;
}

interface LogStreamPanelProps {
  messages: ChatMessage[];
}

function buildLogs(messages: ChatMessage[]): LogEntry[] {
  const logs: LogEntry[] = [];
  for (const msg of messages) {
    if (msg.role === "assistant") {
      // LLM response log
      logs.push({
        id: `llm-${msg.id}`,
        timestamp: msg.timestamp,
        level: "llm",
        source: msg.model ?? "unknown",
        message: msg.content ? msg.content.slice(0, 120) + (msg.content.length > 120 ? "..." : "") : "(streaming)",
        tokensIn: msg.tokensIn,
        tokensOut: msg.tokensOut,
        costUsd: msg.costUsd,
      });

      // Tool call logs
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          logs.push({
            id: `tool-${tc.id}`,
            timestamp: tc.startedAt,
            level: tc.status === "error" ? "error" : "tool",
            source: tc.name,
            message: getToolSummary(tc),
            durationMs: tc.durationMs,
          });
        }
      }
    } else if (msg.role === "system") {
      logs.push({
        id: `sys-${msg.id}`,
        timestamp: msg.timestamp,
        level: "error",
        source: "system",
        message: msg.content,
      });
    }
  }
  return logs.sort((a, b) => a.timestamp - b.timestamp);
}

function getToolSummary(tc: { name: string; args: Record<string, unknown>; result?: string; status: string }): string {
  switch (tc.name) {
    case "Read": return `Read ${(tc.args.file_path as string)?.split(/[/\\]/).pop() ?? ""}`;
    case "Write": return `Write ${(tc.args.file_path as string)?.split(/[/\\]/).pop() ?? ""}`;
    case "Edit": return `Edit ${(tc.args.file_path as string)?.split(/[/\\]/).pop() ?? ""}`;
    case "Bash": return `$ ${((tc.args.command as string) ?? "").slice(0, 80)}`;
    case "Glob": return `Glob ${(tc.args.pattern as string) ?? ""}`;
    case "Grep": return `Grep "${(tc.args.pattern as string) ?? ""}"`;
    default: return tc.name;
  }
}

const LEVEL_COLORS: Record<string, string> = {
  info: "var(--text-muted)",
  tool: "var(--accent-cyan)",
  llm: "var(--accent-purple)",
  error: "var(--accent-red)",
  flow: "var(--accent-amber)",
};

export function LogStreamPanel({ messages }: LogStreamPanelProps) {
  const [filterLevel, setFilterLevel] = useState<string | null>(null);
  const [filterText, setFilterText] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  const allLogs = buildLogs(messages);
  const filteredLogs = allLogs.filter((log) => {
    if (filterLevel && log.level !== filterLevel) return false;
    if (filterText && !log.message.toLowerCase().includes(filterText.toLowerCase())) return false;
    return true;
  });

  // Cumulative stats
  const totalTokensIn = allLogs.reduce((s, l) => s + (l.tokensIn ?? 0), 0);
  const totalTokensOut = allLogs.reduce((s, l) => s + (l.tokensOut ?? 0), 0);
  const totalCost = allLogs.reduce((s, l) => s + (l.costUsd ?? 0), 0);
  const llmCalls = allLogs.filter((l) => l.level === "llm").length;
  const toolCalls = allLogs.filter((l) => l.level === "tool").length;

  useEffect(() => {
    if (autoScroll) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [filteredLogs.length, autoScroll]);

  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 60);
  };

  const handleExport = () => {
    const text = filteredLogs.map((l) =>
      `[${new Date(l.timestamp).toISOString()}] [${l.level.toUpperCase()}] [${l.source}] ${l.message}`
    ).join("\n");
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `archon-logs-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="log-panel">
      <div className="log-header">
        <h2 className="log-title">Log Stream</h2>
        <div className="log-stats">
          <span className="log-stat">{llmCalls} LLM</span>
          <span className="log-stat">{toolCalls} tools</span>
          <span className="log-stat">{(totalTokensIn + totalTokensOut).toLocaleString()} tokens</span>
          <span className="log-stat">${totalCost.toFixed(4)}</span>
        </div>
      </div>

      <div className="log-toolbar">
        <div className="log-filter-group">
          <Filter size={14} />
          <input
            className="log-filter-input"
            placeholder="Filter logs..."
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
          />
        </div>
        <div className="log-level-filters">
          {["llm", "tool", "error"].map((level) => (
            <button
              key={level}
              className={`log-level-btn ${filterLevel === level ? "active" : ""}`}
              style={{ "--level-color": LEVEL_COLORS[level] } as React.CSSProperties}
              onClick={() => setFilterLevel(filterLevel === level ? null : level)}
            >
              {level}
            </button>
          ))}
        </div>
        <button className="log-action-btn" onClick={handleExport} title="Export logs">
          <Download size={14} />
        </button>
        <button className="log-action-btn" onClick={() => {}} title="Clear display">
          <Trash2 size={14} />
        </button>
      </div>

      <div className="log-entries" ref={containerRef} onScroll={handleScroll}>
        {filteredLogs.length === 0 ? (
          <div className="log-empty">No log entries yet</div>
        ) : (
          filteredLogs.map((log) => (
            <div key={log.id} className={`log-entry log-${log.level}`}>
              <span className="log-time">
                {new Date(log.timestamp).toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </span>
              <span className="log-level-badge" style={{ color: LEVEL_COLORS[log.level] }}>
                {log.level}
              </span>
              <span className="log-source">{log.source}</span>
              <span className="log-msg">{log.message}</span>
              <span className="log-meta">
                {log.durationMs != null && (
                  <span>{log.durationMs < 1000 ? `${log.durationMs}ms` : `${(log.durationMs / 1000).toFixed(1)}s`}</span>
                )}
                {log.tokensIn != null && <span>{log.tokensIn.toLocaleString()} in</span>}
                {log.tokensOut != null && <span>{log.tokensOut.toLocaleString()} out</span>}
                {log.costUsd != null && <span>${log.costUsd.toFixed(4)}</span>}
              </span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
