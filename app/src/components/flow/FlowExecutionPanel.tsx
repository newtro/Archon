import { useState } from "react";
import { NODE_REGISTRY, type NodeKind } from "../../lib/flow-types";
import type { FlowExecutionState, FlowNodeMeta, NodeExecInfo } from "../../hooks/useFlowExecution";
import { FlowExecutionDiagram } from "./FlowExecutionDiagram";
import "./FlowExecutionPanel.css";

type ViewMode = "list" | "diagram";

interface FlowExecutionPanelProps {
  execState: FlowExecutionState;
  onCancel: () => void;
  onReset: () => void;
}

export function FlowExecutionPanel({ execState, onCancel, onReset }: FlowExecutionPanelProps) {
  const { status, nodeList, nodeStates, flow } = execState;
  const [viewMode, setViewMode] = useState<ViewMode>("list");

  const completedCount = nodeList.filter((n) => nodeStates[n.id]?.state === "completed").length;

  return (
    <div className={`flow-exec-panel ${viewMode === "diagram" ? "diagram-mode" : ""}`}>
      {/* Header */}
      <div className="flow-exec-header">
        <div className="flow-exec-header-left">
          <div className={`flow-exec-status-dot ${status}`} />
          <span className="flow-exec-title">
            {status === "running" ? "Executing Flow" : status === "completed" ? "Flow Complete" : status === "error" ? "Flow Error" : "Flow"}
          </span>
        </div>
        <div className="flow-exec-header-actions">
          {/* View mode toggle */}
          <div className="flow-exec-view-toggle">
            <button
              className={`flow-exec-toggle-btn ${viewMode === "list" ? "active" : ""}`}
              onClick={() => setViewMode("list")}
              title="List view"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
                <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
              </svg>
            </button>
            <button
              className={`flow-exec-toggle-btn ${viewMode === "diagram" ? "active" : ""}`}
              onClick={() => setViewMode("diagram")}
              title="Diagram view"
              disabled={!flow}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="6" height="6" rx="1" /><rect x="15" y="3" width="6" height="6" rx="1" /><rect x="9" y="15" width="6" height="6" rx="1" />
                <path d="M6 9v3a1 1 0 0 0 1 1h4" /><path d="M18 9v3a1 1 0 0 1-1 1h-4" />
              </svg>
            </button>
          </div>

          {status === "running" && (
            <button className="flow-exec-btn danger" onClick={onCancel} title="Cancel">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" />
              </svg>
            </button>
          )}
          {(status === "completed" || status === "error") && (
            <button className="flow-exec-btn" onClick={onReset} title="Dismiss">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6 6 18" /><path d="m6 6 12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Content: list or diagram */}
      {viewMode === "list" ? (
        <>
          <div className="flow-exec-nodes">
            {nodeList.map((node, i) => (
              <NodeRow
                key={node.id}
                node={node}
                info={nodeStates[node.id]}
                isLast={i === nodeList.length - 1}
              />
            ))}
          </div>

          {/* Footer */}
          <div className="flow-exec-footer">
            <span>{completedCount}/{nodeList.length} nodes</span>
            {execState.error && <span style={{ color: "var(--accent-red)" }}>Error</span>}
            {status === "completed" && <span style={{ color: "var(--accent-green)" }}>Done</span>}
          </div>
        </>
      ) : flow ? (
        <FlowExecutionDiagram flow={flow} execState={execState} />
      ) : null}
    </div>
  );
}

// ── Node Row ──────────────────────────────────────────────────

interface NodeRowProps {
  node: FlowNodeMeta;
  info?: NodeExecInfo;
  isLast: boolean;
}

function NodeRow({ node, info, isLast }: NodeRowProps) {
  const [expanded, setExpanded] = useState(false);
  const state = info?.state ?? "idle";
  const meta = NODE_REGISTRY[node.kind as NodeKind];
  const hasResult = state === "completed" && info?.output?.result;

  return (
    <div className={`flow-exec-node ${state}`}>
      {/* Timeline dot + line */}
      <div className="flow-exec-timeline">
        <div className="flow-exec-node-dot" style={state !== "idle" && meta ? { borderColor: meta.color } : undefined} />
        {!isLast && <div className="flow-exec-node-line" />}
      </div>

      {/* Content */}
      <div className="flow-exec-node-content">
        <div className="flow-exec-node-header">
          <span className="flow-exec-node-label">{node.label}</span>
          <span className="flow-exec-node-kind" style={meta ? { color: meta.color } : undefined}>
            {meta?.label ?? node.kind}
          </span>
        </div>

        {/* State indicator */}
        {state === "running" && (
          <div className="flow-exec-node-state running">
            <div className="flow-exec-mini-spinner" />
            <span>Running</span>
          </div>
        )}

        {state === "streaming" && (
          <>
            <div className="flow-exec-node-state streaming">
              <div className="flow-exec-mini-spinner" />
              <span>Streaming</span>
            </div>
            {info?.streamingText && (
              <div className="flow-exec-streaming-preview">
                {info.streamingText.length > 80
                  ? `...${info.streamingText.slice(-80)}`
                  : info.streamingText}
              </div>
            )}
          </>
        )}

        {state === "completed" && info?.output && (
          <>
            <div className="flow-exec-node-state completed">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6 9 17l-5-5" />
              </svg>
              <span>{info.output.durationMs > 0 ? `${(info.output.durationMs / 1000).toFixed(1)}s` : "Done"}</span>
            </div>

            {/* Data badges for interesting outputs */}
            {info.output.data && Object.keys(info.output.data).length > 0 && (
              <div className="flow-exec-node-data">
                {"classification" in info.output.data && info.output.data.classification != null && (
                  <span className="flow-exec-data-badge">{String(info.output.data.classification)}</span>
                )}
                {"matchedRule" in info.output.data && info.output.data.matchedRule != null && (
                  <span className="flow-exec-data-badge">{String(info.output.data.matchedRule)}</span>
                )}
                {"model" in info.output.data && info.output.data.model != null && (
                  <span className="flow-exec-data-badge">{String(info.output.data.model)}</span>
                )}
                {"score" in info.output.data && info.output.data.score != null && (
                  <span className="flow-exec-data-badge">score: {String(info.output.data.score)}</span>
                )}
              </div>
            )}

            {/* Expandable result preview */}
            {hasResult && (
              <div
                className={`flow-exec-node-result ${expanded ? "" : "collapsed"}`}
                onClick={() => setExpanded(!expanded)}
              >
                {info.output.result}
              </div>
            )}
          </>
        )}

        {state === "error" && (
          <div className="flow-exec-node-state error">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18" /><path d="m6 6 12 12" />
            </svg>
            <span>{info?.error ? info.error.slice(0, 60) : "Error"}</span>
          </div>
        )}
      </div>
    </div>
  );
}
