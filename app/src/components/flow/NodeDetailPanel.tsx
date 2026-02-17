import { NODE_REGISTRY, CATEGORY_COLORS, type NodeKind } from "../../lib/flow-types";
import type { NodeInspectInfo } from "./FlowExecutionDiagram";

interface NodeDetailPanelProps {
  node: NodeInspectInfo;
  onClose: () => void;
}

const STATE_LABELS: Record<string, { label: string; color: string }> = {
  idle: { label: "Idle", color: "#64748b" },
  running: { label: "Running", color: "#6366f1" },
  streaming: { label: "Streaming", color: "#6366f1" },
  completed: { label: "Completed", color: "#22c55e" },
  error: { label: "Error", color: "#ef4444" },
  review: { label: "Awaiting Review", color: "#f59e0b" },
};

export function NodeDetailPanel({ node, onClose }: NodeDetailPanelProps) {
  const meta = NODE_REGISTRY[node.kind as NodeKind];
  const categoryColor = meta ? CATEGORY_COLORS[meta.category] : "#64748b";
  const { execInfo } = node;
  const stateInfo = STATE_LABELS[execInfo.state] ?? STATE_LABELS.idle;

  // Format output result
  let formattedResult = execInfo.output?.result ?? "";
  let resultIsJson = false;
  if (formattedResult) {
    try {
      const parsed = JSON.parse(formattedResult);
      formattedResult = JSON.stringify(parsed, null, 2);
      resultIsJson = true;
    } catch {
      // Not JSON
    }
  }

  // Format input
  let formattedInput = execInfo.input ?? "";
  let inputIsJson = false;
  if (formattedInput) {
    try {
      const parsed = JSON.parse(formattedInput);
      formattedInput = JSON.stringify(parsed, null, 2);
      inputIsJson = true;
    } catch {
      // Not JSON
    }
  }

  // Structured data from output.data
  const structuredData = execInfo.output?.data;
  const hasStructuredData = structuredData && Object.keys(structuredData).length > 0;

  // Tool calls
  const toolCalls = execInfo.toolCalls ?? [];

  return (
    <div className="node-detail-overlay" onClick={onClose}>
      <div className="node-detail-panel" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="node-detail-header">
          <div className="node-detail-title-row">
            <span
              className="node-detail-kind-badge"
              style={{ borderColor: categoryColor, color: categoryColor }}
            >
              {meta?.label ?? node.kind}
            </span>
            <span className="node-detail-label">{node.label}</span>
          </div>
          <button className="node-detail-close" onClick={onClose} title="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18" /><path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        {/* State & metadata */}
        <div className="node-detail-meta">
          <div className="node-detail-meta-item">
            <span className="node-detail-meta-label">State</span>
            <span className="node-detail-meta-value" style={{ color: stateInfo.color }}>
              {stateInfo.label}
            </span>
          </div>
          {execInfo.output?.durationMs != null && (
            <div className="node-detail-meta-item">
              <span className="node-detail-meta-label">Duration</span>
              <span className="node-detail-meta-value">
                {execInfo.output.durationMs < 1000
                  ? `${execInfo.output.durationMs}ms`
                  : `${(execInfo.output.durationMs / 1000).toFixed(1)}s`}
              </span>
            </div>
          )}
          {execInfo.output?.signal && (
            <div className="node-detail-meta-item">
              <span className="node-detail-meta-label">Signal</span>
              <span className="node-detail-meta-value">{execInfo.output.signal}</span>
            </div>
          )}
          {toolCalls.length > 0 && (
            <div className="node-detail-meta-item">
              <span className="node-detail-meta-label">Tool calls</span>
              <span className="node-detail-meta-value">{toolCalls.length}</span>
            </div>
          )}
        </div>

        {/* Structured data (model, cost, classification, etc.) */}
        {hasStructuredData && (
          <div className="node-detail-section">
            <div className="node-detail-section-header">Structured Data</div>
            <div className="node-detail-kv-grid">
              {Object.entries(structuredData!).map(([key, value]) => (
                <div key={key} className="node-detail-kv-row">
                  <span className="node-detail-kv-key">{key}</span>
                  <span className="node-detail-kv-value">
                    {typeof value === "object" ? JSON.stringify(value) : String(value)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Input */}
        {formattedInput && (
          <div className="node-detail-section">
            <div className="node-detail-section-header">
              Input
              {inputIsJson && <span className="node-detail-format-badge">JSON</span>}
              <span className="node-detail-size-badge">
                {(execInfo.input?.length ?? 0) < 1024
                  ? `${execInfo.input?.length ?? 0} chars`
                  : `${((execInfo.input?.length ?? 0) / 1024).toFixed(1)} KB`}
              </span>
            </div>
            <pre className="node-detail-data">{formattedInput}</pre>
          </div>
        )}

        {/* Output */}
        {formattedResult && (
          <div className="node-detail-section">
            <div className="node-detail-section-header">
              Output
              {resultIsJson && <span className="node-detail-format-badge">JSON</span>}
              <span className="node-detail-size-badge">
                {(execInfo.output?.result?.length ?? 0) < 1024
                  ? `${execInfo.output?.result?.length ?? 0} chars`
                  : `${((execInfo.output?.result?.length ?? 0) / 1024).toFixed(1)} KB`}
              </span>
            </div>
            <pre className="node-detail-data">{formattedResult}</pre>
          </div>
        )}

        {/* Tool calls */}
        {toolCalls.length > 0 && (
          <div className="node-detail-section">
            <div className="node-detail-section-header">Tool Calls</div>
            <div className="node-detail-tool-list">
              {toolCalls.map((tc) => (
                <div key={tc.id} className="node-detail-tool-item" data-status={tc.status}>
                  <div className="node-detail-tool-header">
                    <span className="node-detail-tool-name">{tc.name}</span>
                    <span className="node-detail-tool-status" data-status={tc.status}>
                      {tc.status}
                    </span>
                    {tc.durationMs != null && (
                      <span className="node-detail-tool-duration">
                        {tc.durationMs < 1000 ? `${tc.durationMs}ms` : `${(tc.durationMs / 1000).toFixed(1)}s`}
                      </span>
                    )}
                  </div>
                  {Object.keys(tc.args).length > 0 && (
                    <pre className="node-detail-tool-args">
                      {JSON.stringify(tc.args, null, 2)}
                    </pre>
                  )}
                  {tc.result && (
                    <pre className="node-detail-tool-result">
                      {tc.result.length > 500 ? tc.result.slice(0, 500) + "..." : tc.result}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Error */}
        {execInfo.error && (
          <div className="node-detail-section">
            <div className="node-detail-section-header node-detail-error-header">Error</div>
            <pre className="node-detail-data node-detail-error-data">{execInfo.error}</pre>
          </div>
        )}

        {/* Idle state message */}
        {execInfo.state === "idle" && (
          <div className="node-detail-section">
            <div className="node-detail-section-header">
              Not yet executed — run the flow to see data
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
