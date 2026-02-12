import { useState } from "react";
import type {
  ContextViewState,
  ContextWindowSnapshot,
  BriefingDiff,
  ContextClassification,
  TokenUsageUpdate,
  ContextSection,
} from "../../lib/types";
import "./ContextView.css";

// ── Category Colors (consistent with plan) ───────────────────

const CATEGORY_COLORS: Record<string, string> = {
  system: "#8B5CF6",     // purple
  briefing: "#3B82F6",   // blue
  tools: "#06B6D4",      // cyan
  conversation: "#22C55E", // green
  files: "#F59E0B",      // amber
  other: "#64748B",      // slate
};

// ── Main ContextView Component ──────────────────────────────

interface ContextViewProps {
  state: ContextViewState;
  onRequestRaw?: (executionId: string, nodeId: string) => void;
  getRawMessages?: (executionId: string, nodeId: string) => unknown[] | null;
}

export function ContextView({ state, onRequestRaw, getRawMessages }: ContextViewProps) {
  const { latestSnapshot, snapshots, briefingDiffs, tokenUsageUpdates, classifications, contextState, cumulativeStats, budgetWarning } = state;

  const hasData = latestSnapshot || classifications.length > 0 || contextState;

  return (
    <div className="context-view">
      {!hasData ? (
        <div className="context-view-empty">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" opacity="0.2">
            <path d="M12 2a8.5 8.5 0 0 0-8.5 8.5c0 3.03 1.6 5.69 4 7.18V20a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1v-2.32c2.4-1.49 4-4.15 4-7.18A8.5 8.5 0 0 0 12 2Z" />
            <line x1="10" y1="22" x2="14" y2="22" />
          </svg>
          <span>No context data yet</span>
          <span className="context-view-empty-hint">Start a chat or run a flow to see context window state</span>
        </div>
      ) : (
        <div className="context-view-content">
          {/* Budget Warning Banner */}
          {budgetWarning !== "none" && latestSnapshot && (
            <BudgetWarningBanner warning={budgetWarning} snapshot={latestSnapshot} />
          )}

          {/* Overview Bar */}
          <ContextOverviewBar
            snapshot={latestSnapshot}
            cumulativeStats={cumulativeStats}
          />

          {/* Composition Chart */}
          {latestSnapshot && (
            <CompositionChart snapshot={latestSnapshot} />
          )}

          {/* Context State Tree */}
          {contextState != null ? (
            <ContextStateTree state={contextState} />
          ) : null}

          {/* Node Context History */}
          <NodeContextHistory
            snapshots={snapshots}
            briefingDiffs={briefingDiffs}
            classifications={classifications}
            tokenUsageUpdates={tokenUsageUpdates}
            onRequestRaw={onRequestRaw}
            getRawMessages={getRawMessages}
          />
        </div>
      )}
    </div>
  );
}

// ── Budget Warning Banner ───────────────────────────────────

function BudgetWarningBanner({ warning, snapshot }: { warning: "yellow" | "red"; snapshot: ContextWindowSnapshot }) {
  const isRed = warning === "red";
  return (
    <div className={`context-budget-warning ${warning}`}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
        <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
      <span>
        Context window {Math.round(snapshot.percentFull)}% full
        {isRed ? " — risk of context truncation" : " — large additions may exceed limit"}
      </span>
    </div>
  );
}

// ── Overview Bar ────────────────────────────────────────────

interface OverviewBarProps {
  snapshot: ContextWindowSnapshot | null;
  cumulativeStats: { totalInputTokens: number; totalOutputTokens: number; totalCost: number };
}

function ContextOverviewBar({ snapshot, cumulativeStats }: OverviewBarProps) {
  const percentFull = snapshot?.percentFull ?? 0;
  const totalTokens = snapshot?.totalInputTokens ?? 0;
  const maxTokens = snapshot?.maxTokens ?? 0;
  const model = snapshot?.model ?? "—";

  return (
    <div className="context-overview-bar">
      <div className="context-overview-progress-row">
        <div className="context-overview-progress-bar">
          <div
            className={`context-overview-progress-fill ${percentFull >= 90 ? "danger" : percentFull >= 75 ? "warning" : ""}`}
            style={{ width: `${Math.min(percentFull, 100)}%` }}
          />
        </div>
        <span className="context-overview-percent">{Math.round(percentFull)}%</span>
      </div>
      <div className="context-overview-stats">
        <span>{formatTokens(totalTokens)} / {formatTokens(maxTokens)}</span>
        <span className="context-overview-separator">|</span>
        <span>{model}</span>
        {cumulativeStats.totalCost > 0 && (
          <>
            <span className="context-overview-separator">|</span>
            <span>${cumulativeStats.totalCost.toFixed(4)}</span>
          </>
        )}
      </div>
    </div>
  );
}

// ── Composition Chart ───────────────────────────────────────

function CompositionChart({ snapshot }: { snapshot: ContextWindowSnapshot }) {
  const { breakdown, totalInputTokens } = snapshot;
  if (totalInputTokens === 0) return null;

  const segments: Array<{ key: string; label: string; tokens: number; color: string }> = [
    { key: "system", label: "System", tokens: breakdown.systemPrompt, color: CATEGORY_COLORS.system },
    { key: "briefing", label: "Briefing", tokens: breakdown.briefing, color: CATEGORY_COLORS.briefing },
    { key: "tools", label: "Tools", tokens: breakdown.toolDefinitions, color: CATEGORY_COLORS.tools },
    { key: "conversation", label: "Conv", tokens: breakdown.conversationHistory, color: CATEGORY_COLORS.conversation },
    { key: "files", label: "Files", tokens: breakdown.fileContents, color: CATEGORY_COLORS.files },
    { key: "toolResults", label: "Results", tokens: breakdown.toolResults, color: CATEGORY_COLORS.other },
    { key: "other", label: "Other", tokens: breakdown.other, color: "#94A3B8" },
  ].filter((s) => s.tokens > 0);

  return (
    <div className="context-composition">
      <div className="context-composition-label">Token Composition</div>
      <div className="context-composition-bar">
        {segments.map((seg) => (
          <div
            key={seg.key}
            className="context-composition-segment"
            style={{
              width: `${(seg.tokens / totalInputTokens) * 100}%`,
              backgroundColor: seg.color,
            }}
            title={`${seg.label}: ${formatTokens(seg.tokens)} (${Math.round((seg.tokens / totalInputTokens) * 100)}%)`}
          />
        ))}
      </div>
      <div className="context-composition-legend">
        {segments.map((seg) => (
          <div key={seg.key} className="context-composition-legend-item">
            <span className="context-composition-dot" style={{ backgroundColor: seg.color }} />
            <span className="context-composition-legend-label">{seg.label}</span>
            <span className="context-composition-legend-value">{formatTokens(seg.tokens)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Context State Tree ──────────────────────────────────────

function ContextStateTree({ state }: { state: unknown }) {
  const [expanded, setExpanded] = useState(false);
  const stateObj = state as Record<string, unknown> | null;
  if (!stateObj) return null;

  return (
    <div className="context-state-tree">
      <div className="context-state-tree-header" onClick={() => setExpanded(!expanded)}>
        <svg
          width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
          strokeLinecap="round" strokeLinejoin="round"
          style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s" }}
        >
          <path d="m9 18 6-6-6-6" />
        </svg>
        <span>Context State</span>
        {stateObj.taskStatus != null ? (
          <span className={`context-state-badge ${String(stateObj.taskStatus)}`}>
            {String(stateObj.taskStatus)}
          </span>
        ) : null}
      </div>
      {expanded && (
        <div className="context-state-tree-body">
          <JsonTree data={stateObj} depth={0} />
        </div>
      )}
    </div>
  );
}

/** Simple recursive JSON tree viewer */
function JsonTree({ data, depth }: { data: unknown; depth: number }) {
  if (data === null || data === undefined) {
    return <span className="json-null">null</span>;
  }
  if (typeof data === "string") {
    return <span className="json-string">"{data.length > 100 ? data.slice(0, 100) + "..." : data}"</span>;
  }
  if (typeof data === "number") {
    return <span className="json-number">{data}</span>;
  }
  if (typeof data === "boolean") {
    return <span className="json-boolean">{String(data)}</span>;
  }
  if (Array.isArray(data)) {
    if (data.length === 0) return <span className="json-bracket">[]</span>;
    return (
      <div className="json-array" style={{ paddingLeft: depth > 0 ? 12 : 0 }}>
        {data.map((item, i) => (
          <div key={i} className="json-array-item">
            <span className="json-index">[{i}]</span> <JsonTree data={item} depth={depth + 1} />
          </div>
        ))}
      </div>
    );
  }
  if (typeof data === "object") {
    const entries = Object.entries(data as Record<string, unknown>);
    if (entries.length === 0) return <span className="json-bracket">{"{}"}</span>;
    return (
      <div className="json-object" style={{ paddingLeft: depth > 0 ? 12 : 0 }}>
        {entries.map(([key, value]) => (
          <div key={key} className="json-property">
            <span className="json-key">{key}:</span> <JsonTree data={value} depth={depth + 1} />
          </div>
        ))}
      </div>
    );
  }
  return <span>{String(data)}</span>;
}

// ── Node Context History ────────────────────────────────────

interface NodeContextHistoryProps {
  snapshots: ContextWindowSnapshot[];
  briefingDiffs: BriefingDiff[];
  classifications: ContextClassification[];
  tokenUsageUpdates: TokenUsageUpdate[];
  onRequestRaw?: (executionId: string, nodeId: string) => void;
  getRawMessages?: (executionId: string, nodeId: string) => unknown[] | null;
}

/** Merge all context events into a unified timeline sorted by timestamp */
type TimelineEntry =
  | { kind: "snapshot"; ts: number; data: ContextWindowSnapshot }
  | { kind: "briefing"; ts: number; data: BriefingDiff }
  | { kind: "classification"; ts: number; data: ContextClassification }
  | { kind: "usage"; ts: number; data: TokenUsageUpdate };

function NodeContextHistory({ snapshots, briefingDiffs, classifications, tokenUsageUpdates, onRequestRaw, getRawMessages }: NodeContextHistoryProps) {
  const timeline: TimelineEntry[] = [
    ...snapshots.map((s) => ({ kind: "snapshot" as const, ts: s.timestamp, data: s })),
    ...briefingDiffs.map((b) => ({ kind: "briefing" as const, ts: b.timestamp, data: b })),
    ...classifications.map((c) => ({ kind: "classification" as const, ts: c.timestamp, data: c })),
    ...tokenUsageUpdates.map((u) => ({ kind: "usage" as const, ts: u.timestamp, data: u })),
  ].sort((a, b) => a.ts - b.ts);

  if (timeline.length === 0) return null;

  return (
    <div className="context-history">
      <div className="context-history-label">Context Events</div>
      <div className="context-history-list">
        {timeline.map((entry, i) => (
          <TimelineCard key={`${entry.kind}-${i}`} entry={entry} onRequestRaw={onRequestRaw} getRawMessages={getRawMessages} />
        ))}
      </div>
    </div>
  );
}

function TimelineCard({ entry, onRequestRaw, getRawMessages }: { entry: TimelineEntry; onRequestRaw?: (executionId: string, nodeId: string) => void; getRawMessages?: (executionId: string, nodeId: string) => unknown[] | null }) {
  const [expanded, setExpanded] = useState(false);
  const [showRaw, setShowRaw] = useState(false);

  switch (entry.kind) {
    case "classification":
      return (
        <div className="context-event-card classification">
          <div className="context-event-header">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a8.5 8.5 0 0 0-8.5 8.5c0 3.03 1.6 5.69 4 7.18V20a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1v-2.32c2.4-1.49 4-4.15 4-7.18A8.5 8.5 0 0 0 12 2Z" />
            </svg>
            <span className="context-event-title">Classification</span>
          </div>
          <div className="context-event-badges">
            <span className="context-event-badge">{entry.data.intent}</span>
            <span className={`context-event-badge complexity-${entry.data.complexity}`}>{entry.data.complexity}</span>
            <span className="context-event-badge">{entry.data.routedTo}</span>
            {entry.data.handleDirectly && <span className="context-event-badge direct">direct</span>}
          </div>
        </div>
      );

    case "snapshot": {
      const executionId = entry.data.executionId ?? entry.data.sessionId;
      const rawMessages = getRawMessages?.(executionId, entry.data.nodeId) ?? null;

      const handleToggleRaw = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!showRaw && !rawMessages && onRequestRaw) {
          onRequestRaw(executionId, entry.data.nodeId);
        }
        setShowRaw(!showRaw);
      };

      return (
        <div className="context-event-card snapshot" onClick={() => setExpanded(!expanded)}>
          <div className="context-event-header">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="2" width="20" height="20" rx="2" />
              <path d="M7 2v20" /><path d="M17 2v20" /><path d="M2 12h20" />
            </svg>
            <span className="context-event-title">
              {entry.data.nodeLabel ?? entry.data.nodeId} — {entry.data.model}
            </span>
            <span className={`context-event-percent ${entry.data.percentFull >= 90 ? "danger" : entry.data.percentFull >= 75 ? "warning" : ""}`}>
              {Math.round(entry.data.percentFull)}%
            </span>
          </div>
          <div className="context-snapshot-bar">
            <div
              className={`context-snapshot-fill ${entry.data.percentFull >= 90 ? "danger" : entry.data.percentFull >= 75 ? "warning" : ""}`}
              style={{ width: `${Math.min(entry.data.percentFull, 100)}%` }}
            />
          </div>
          {expanded && (
            <div className="context-snapshot-detail">
              {/* Structured / Raw toggle */}
              <div className="context-snapshot-toggle" onClick={(e) => e.stopPropagation()}>
                <button
                  className={`context-toggle-btn ${!showRaw ? "active" : ""}`}
                  onClick={(e) => { e.stopPropagation(); setShowRaw(false); }}
                >
                  Structured
                </button>
                <button
                  className={`context-toggle-btn ${showRaw ? "active" : ""}`}
                  onClick={handleToggleRaw}
                >
                  Raw
                </button>
              </div>

              {showRaw ? (
                <div className="context-snapshot-raw">
                  {rawMessages ? (
                    <JsonTree data={rawMessages} depth={0} />
                  ) : (
                    <span className="context-snapshot-raw-loading">Loading raw messages...</span>
                  )}
                </div>
              ) : (
                entry.data.sections.map((section, idx) => (
                  <SectionRow key={idx} section={section} total={entry.data.totalInputTokens} />
                ))
              )}
            </div>
          )}
        </div>
      );
    }

    case "briefing":
      return (
        <div className="context-event-card briefing" onClick={() => setExpanded(!expanded)}>
          <div className="context-event-header">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
              <path d="M14 2v6h6" /><path d="M16 13H8" /><path d="M16 17H8" />
            </svg>
            <span className="context-event-title">Briefing</span>
            <span className="context-event-savings">
              {Math.round(entry.data.compressionRatio * 100)}% compression ({formatTokens(entry.data.tokensSaved)} saved)
            </span>
          </div>
          <div className="context-briefing-summary">
            <span className="context-briefing-included">{entry.data.included.length} included</span>
            <span className="context-briefing-excluded">{entry.data.excluded.length} excluded</span>
          </div>
          {expanded && (
            <div className="context-briefing-detail">
              {entry.data.included.length > 0 && (
                <div className="context-briefing-section">
                  <div className="context-briefing-section-label included">Included</div>
                  {entry.data.included.map((item, idx) => (
                    <BriefingItemRow key={idx} item={item} included />
                  ))}
                </div>
              )}
              {entry.data.excluded.length > 0 && (
                <div className="context-briefing-section">
                  <div className="context-briefing-section-label excluded">Excluded</div>
                  {entry.data.excluded.map((item, idx) => (
                    <BriefingItemRow key={idx} item={item} included={false} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      );

    case "usage":
      return (
        <div className="context-event-card usage">
          <div className="context-event-header">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20V10" /><path d="M18 20V4" /><path d="M6 20v-4" />
            </svg>
            <span className="context-event-title">{entry.data.nodeId}</span>
          </div>
          <div className="context-usage-stats">
            <span>In: {formatTokens(entry.data.actual.inputTokens)}</span>
            <span>Out: {formatTokens(entry.data.actual.outputTokens)}</span>
            {entry.data.delta !== 0 && (
              <span className={entry.data.delta > 0 ? "delta-over" : "delta-under"}>
                {entry.data.delta > 0 ? "+" : ""}{formatTokens(entry.data.delta)} vs estimate
              </span>
            )}
          </div>
        </div>
      );
  }
}

function SectionRow({ section, total }: { section: ContextSection; total: number }) {
  const pct = total > 0 ? (section.tokenCount / total) * 100 : 0;
  const color = CATEGORY_COLORS[section.category] ?? CATEGORY_COLORS.other;
  return (
    <div className="context-section-row">
      <span className="context-section-dot" style={{ backgroundColor: color }} />
      <span className="context-section-name">{section.name}</span>
      <span className="context-section-tokens">{formatTokens(section.tokenCount)}</span>
      <span className="context-section-pct">{Math.round(pct)}%</span>
    </div>
  );
}

function BriefingItemRow({ item, included }: { item: { type: string; summary: string; tokenCount: number; reason?: string }; included: boolean }) {
  return (
    <div className={`context-briefing-item ${included ? "included" : "excluded"}`}>
      <span className="context-briefing-item-type">{item.type}</span>
      <span className="context-briefing-item-summary">{item.summary}</span>
      <span className="context-briefing-item-tokens">{formatTokens(item.tokenCount)}</span>
      {item.reason && <span className="context-briefing-item-reason">{item.reason}</span>}
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
