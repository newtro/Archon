import { X, Download, Star, User, Calendar, RefreshCw, ArrowDownToLine } from "lucide-react";
import type { CommunityFlowMeta } from "../../lib/registry-types";
import { NODE_CATEGORY, CATEGORY_COLORS } from "../../lib/flow-types";
import type { NodeKind } from "../../lib/flow-types";
import "./FlowDetailModal.css";

interface FlowDetailModalProps {
  flow: CommunityFlowMeta;
  isInstalled: boolean;
  installedVersion: string | null;
  onInstall: () => void;
  onClose: () => void;
  installing: boolean;
}

export function FlowDetailModal({
  flow,
  isInstalled,
  installedVersion,
  onInstall,
  onClose,
  installing,
}: FlowDetailModalProps) {
  const hasUpdate = isInstalled && installedVersion && installedVersion !== flow.version;

  return (
    <div className="flow-detail-backdrop" onClick={onClose}>
      <div className="flow-detail-modal" onClick={(e) => e.stopPropagation()}>
        <div className="flow-detail-header">
          <div className="flow-detail-title-row">
            <h2 className="flow-detail-name">{flow.name}</h2>
            <button className="flow-detail-close" onClick={onClose}>
              <X size={16} />
            </button>
          </div>
          <div className="flow-detail-meta-row">
            <span className="flow-detail-meta-item">
              <User size={12} />
              {flow.author}
            </span>
            <span className="flow-detail-meta-item">
              <Star size={12} />
              {flow.stars}
            </span>
            <span className="flow-detail-meta-item">
              <ArrowDownToLine size={12} />
              {flow.downloads}
            </span>
            <span className="flow-detail-meta-item">
              v{flow.version}
            </span>
            <span className="flow-detail-meta-item">
              <Calendar size={12} />
              {new Date(flow.updatedAt).toLocaleDateString()}
            </span>
          </div>
        </div>

        <div className="flow-detail-body">
          <p className="flow-detail-description">{flow.description}</p>

          <div className="flow-detail-section">
            <h4 className="flow-detail-section-title">Tags</h4>
            <div className="flow-detail-tags">
              {flow.tags.map((tag) => (
                <span key={tag} className="flow-detail-tag">{tag}</span>
              ))}
            </div>
          </div>

          <div className="flow-detail-section">
            <h4 className="flow-detail-section-title">
              Node Types ({flow.nodeCount} nodes)
            </h4>
            <div className="flow-detail-node-types">
              {flow.nodeTypes.map((kind) => {
                const category = NODE_CATEGORY[kind as NodeKind];
                const color = category ? CATEGORY_COLORS[category] : "#64748b";
                return (
                  <span
                    key={kind}
                    className="flow-detail-node-chip"
                    style={{ borderColor: color, color }}
                  >
                    {kind}
                  </span>
                );
              })}
            </div>
          </div>
        </div>

        <div className="flow-detail-footer">
          {isInstalled && !hasUpdate ? (
            <span className="flow-detail-installed-badge">Installed (v{installedVersion})</span>
          ) : (
            <button
              className="flow-detail-install-btn"
              onClick={onInstall}
              disabled={installing}
            >
              {installing ? (
                <>Installing...</>
              ) : hasUpdate ? (
                <>
                  <RefreshCw size={14} />
                  Update to v{flow.version}
                </>
              ) : (
                <>
                  <Download size={14} />
                  Install Flow
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
