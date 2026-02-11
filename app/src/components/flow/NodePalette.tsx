import {
  NODE_REGISTRY,
  CATEGORY_COLORS,
  type NodeKind,
  type NodeCategory,
} from "../../lib/flow-types";
import "./NodePalette.css";

interface NodePaletteProps {
  onAddNode: (kind: NodeKind) => void;
}

const CATEGORIES: { key: NodeCategory; label: string }[] = [
  { key: "structure", label: "Structure" },
  { key: "ai", label: "AI" },
  { key: "execution", label: "Execution" },
  { key: "control", label: "Control Flow" },
  { key: "context", label: "Context" },
];

export function NodePalette({ onAddNode }: NodePaletteProps) {
  const grouped = Object.values(NODE_REGISTRY).reduce(
    (acc, meta) => {
      (acc[meta.category] ??= []).push(meta);
      return acc;
    },
    {} as Record<NodeCategory, typeof NODE_REGISTRY[NodeKind][]>
  );

  return (
    <div className="node-palette">
      <div className="node-palette-header">
        <span className="node-palette-title">Nodes</span>
      </div>
      <div className="node-palette-list">
        {CATEGORIES.map(({ key, label }) => (
          <div key={key} className="node-palette-group">
            <div className="node-palette-group-label" style={{ color: CATEGORY_COLORS[key] }}>
              {label}
            </div>
            {(grouped[key] ?? []).map((meta) => (
              <button
                key={meta.kind}
                className="node-palette-item"
                onClick={() => onAddNode(meta.kind)}
                title={meta.description}
              >
                <div
                  className="node-palette-icon"
                  style={{ background: meta.color }}
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="white"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d={meta.icon} />
                  </svg>
                </div>
                <span className="node-palette-label">{meta.label}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
