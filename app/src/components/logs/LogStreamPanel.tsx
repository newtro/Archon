import { useState, useRef, useEffect } from "react";
import { Trash2, Download, Copy, Check, Filter, ChevronRight, ChevronDown, Loader } from "lucide-react";
import type { LogEntry } from "../../lib/types";
import "./LogStreamPanel.css";

interface LogStreamPanelProps {
  logEntries: LogEntry[];
  onClear: () => void;
}

const LEVEL_COLORS: Record<string, string> = {
  info: "var(--text-muted)",
  tool: "var(--accent-cyan)",
  llm: "var(--accent-purple)",
  error: "var(--accent-red)",
  flow: "var(--accent-amber)",
  debug: "var(--accent-slate, #94a3b8)",
};

export function LogStreamPanel({ logEntries, onClear }: LogStreamPanelProps) {
  const [filterLevel, setFilterLevel] = useState<string | null>(null);
  const [filterText, setFilterText] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  const filteredLogs = logEntries.filter((log) => {
    if (filterLevel && log.level !== filterLevel) return false;
    if (filterText && !log.message.toLowerCase().includes(filterText.toLowerCase())
        && !log.source.toLowerCase().includes(filterText.toLowerCase())) return false;
    return true;
  });

  // Stats from ALL entries (not filtered)
  const totalTokensIn = logEntries.reduce((s, l) => s + (l.tokensIn ?? 0), 0);
  const totalTokensOut = logEntries.reduce((s, l) => s + (l.tokensOut ?? 0), 0);
  const totalCost = logEntries.reduce((s, l) => s + (l.costUsd ?? 0), 0);
  const llmCalls = logEntries.filter((l) => l.level === "llm").length;
  const toolCalls = logEntries.filter((l) => l.level === "tool").length;

  useEffect(() => {
    if (autoScroll) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [filteredLogs.length, autoScroll]);

  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 60);
  };

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const [copied, setCopied] = useState(false);

  const formatLogs = () =>
    filteredLogs.map((l) =>
      `[${new Date(l.timestamp).toISOString()}] [${l.level.toUpperCase()}] [${l.source}] ${l.message}${l.detail ? "\n  " + l.detail : ""}`
    ).join("\n");

  const handleCopyAll = () => {
    navigator.clipboard.writeText(formatLogs()).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const handleExport = () => {
    const text = formatLogs();
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
          {["info", "llm", "tool", "flow", "error", "debug"].map((level) => (
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
        <button className="log-action-btn" onClick={handleCopyAll} title="Copy all logs">
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
        <button className="log-action-btn" onClick={handleExport} title="Export logs">
          <Download size={14} />
        </button>
        <button className="log-action-btn" onClick={onClear} title="Clear logs">
          <Trash2 size={14} />
        </button>
      </div>

      <div className="log-entries" ref={containerRef} onScroll={handleScroll}>
        {filteredLogs.length === 0 ? (
          <div className="log-empty">No log entries yet</div>
        ) : (
          filteredLogs.map((log) => {
            const isExpanded = expandedIds.has(log.id);
            const hasDetail = !!log.detail;

            return (
              <div key={log.id} className={`log-entry-wrapper ${log.status === "pending" ? "log-pending" : ""}`}>
                <div
                  className={`log-entry log-${log.level} ${hasDetail ? "log-expandable" : ""}`}
                  onClick={hasDetail ? () => toggleExpand(log.id) : undefined}
                >
                  <span className="log-expand-icon">
                    {hasDetail ? (
                      isExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />
                    ) : null}
                  </span>

                  {log.status === "pending" && (
                    <span className="log-spinner"><Loader size={10} /></span>
                  )}

                  <span className="log-time">
                    {new Date(log.timestamp).toLocaleTimeString([], {
                      hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit",
                    })}
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

                {isExpanded && log.detail && (
                  <div className="log-detail">
                    <pre className="log-detail-content">{log.detail}</pre>
                  </div>
                )}
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
