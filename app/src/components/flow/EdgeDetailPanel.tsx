import type { EdgeExecInfo } from "../../hooks/useFlowExecution";
import { NODE_REGISTRY, type NodeKind } from "../../lib/flow-types";

interface EdgeDetailPanelProps {
  edge: EdgeExecInfo;
  onClose: () => void;
}

export function EdgeDetailPanel({ edge, onClose }: EdgeDetailPanelProps) {
  const sourceMeta = NODE_REGISTRY[edge.sourceKind as NodeKind];
  const targetMeta = NODE_REGISTRY[edge.targetKind as NodeKind];
  const hasExecData = edge.timestamp > 0 && edge.dataFull.length > 0;
  const timestamp = hasExecData ? new Date(edge.timestamp) : null;
  const timeStr = timestamp
    ? timestamp.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : null;

  // Determine if data looks like JSON for pretty display
  let formattedData = edge.dataFull;
  let isJson = false;
  if (hasExecData) {
    try {
      const parsed = JSON.parse(edge.dataFull);
      formattedData = JSON.stringify(parsed, null, 2);
      isJson = true;
    } catch {
      // Not JSON, use raw text
    }
  }

  return (
    <div className="edge-detail-overlay" onClick={onClose}>
      <div className="edge-detail-panel" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="edge-detail-header">
          <div className="edge-detail-title">Connection Data</div>
          <button className="edge-detail-close" onClick={onClose} title="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18" /><path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        {/* Route info */}
        <div className="edge-detail-route">
          <div className="edge-detail-node-badge" style={sourceMeta ? { borderColor: sourceMeta.color } : undefined}>
            <span className="edge-detail-node-kind" style={sourceMeta ? { color: sourceMeta.color } : undefined}>
              {sourceMeta?.label ?? edge.sourceKind}
            </span>
            <span className="edge-detail-node-name">{edge.sourceLabel}</span>
          </div>
          <div className="edge-detail-arrow">
            <svg width="20" height="12" viewBox="0 0 20 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 6h16M14 2l4 4-4 4" />
            </svg>
            <span className="edge-detail-signal" data-signal={edge.signal}>{edge.signal}</span>
          </div>
          <div className="edge-detail-node-badge" style={targetMeta ? { borderColor: targetMeta.color } : undefined}>
            <span className="edge-detail-node-kind" style={targetMeta ? { color: targetMeta.color } : undefined}>
              {targetMeta?.label ?? edge.targetKind}
            </span>
            <span className="edge-detail-node-name">{edge.targetLabel}</span>
          </div>
        </div>

        {/* Metadata */}
        <div className="edge-detail-meta">
          <div className="edge-detail-meta-item">
            <span className="edge-detail-meta-label">Signal</span>
            <span className="edge-detail-meta-value">{edge.signal}</span>
          </div>
          {timeStr && (
            <div className="edge-detail-meta-item">
              <span className="edge-detail-meta-label">Traversed at</span>
              <span className="edge-detail-meta-value">{timeStr}</span>
            </div>
          )}
          {hasExecData && (
            <div className="edge-detail-meta-item">
              <span className="edge-detail-meta-label">Data size</span>
              <span className="edge-detail-meta-value">
                {edge.dataFull.length < 1024
                  ? `${edge.dataFull.length} chars`
                  : `${(edge.dataFull.length / 1024).toFixed(1)} KB`}
              </span>
            </div>
          )}
        </div>

        {/* Data content */}
        <div className="edge-detail-section">
          {hasExecData ? (
            <>
              <div className="edge-detail-section-header">
                Data passed to {edge.targetLabel}
                {isJson && <span className="edge-detail-format-badge">JSON</span>}
              </div>
              <pre className="edge-detail-data">{formattedData}</pre>
            </>
          ) : (
            <div className="edge-detail-section-header">
              Not yet traversed — run the flow to see data
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
