import { useCallback } from "react";
import type { Node } from "@xyflow/react";
import { NODE_REGISTRY, type FlowNodeData, type NodeKind } from "../../lib/flow-types";
import { LLMConfig } from "./config/LLMConfig";
import { IntentConfig } from "./config/IntentConfig";
import { EvaluatorConfig } from "./config/EvaluatorConfig";
import { ToolConfig } from "./config/ToolConfig";
import { TransformerConfig } from "./config/TransformerConfig";
import { RouterConfig } from "./config/RouterConfig";
import { ParallelConfig } from "./config/ParallelConfig";
import { JoinConfig } from "./config/JoinConfig";
import { HumanReviewConfig } from "./config/HumanReviewConfig";
import { SubFlowConfig } from "./config/SubFlowConfig";
import { MemoryConfig } from "./config/MemoryConfig";
import { HandoffConfig } from "./config/HandoffConfig";
import { ProjectContextConfig } from "./config/ProjectContextConfig";
import { StartConfig } from "./config/StartConfig";
import { EndConfig } from "./config/EndConfig";
import "./NodeConfigPanel.css";

interface NodeConfigPanelProps {
  node: Node;
  onConfigChange: (nodeId: string, data: FlowNodeData) => void;
  onDelete: (nodeId: string) => void;
}

const CONFIG_COMPONENTS: Record<NodeKind, React.ComponentType<{ config: Record<string, unknown>; onChange: (p: Record<string, unknown>) => void }>> = {
  llm: LLMConfig,
  intent: IntentConfig,
  evaluator: EvaluatorConfig,
  tool: ToolConfig,
  transformer: TransformerConfig,
  router: RouterConfig,
  parallel: ParallelConfig,
  join: JoinConfig,
  "human-review": HumanReviewConfig,
  "sub-flow": SubFlowConfig,
  memory: MemoryConfig,
  handoff: HandoffConfig,
  "project-context": ProjectContextConfig,
  start: StartConfig,
  end: EndConfig,
};

export function NodeConfigPanel({ node, onConfigChange, onDelete }: NodeConfigPanelProps) {
  const data = node.data as unknown as FlowNodeData;
  const meta = NODE_REGISTRY[data.kind];

  const updateLabel = useCallback(
    (label: string) => {
      onConfigChange(node.id, { ...data, label });
    },
    [node.id, data, onConfigChange]
  );

  const updateConfig = useCallback(
    (patch: Record<string, unknown>) => {
      const current = data.config as { kind: NodeKind; config: Record<string, unknown> };
      onConfigChange(node.id, {
        ...data,
        config: {
          ...current,
          config: { ...current.config, ...patch },
        } as FlowNodeData["config"],
      });
    },
    [node.id, data, onConfigChange]
  );

  const ConfigComponent = CONFIG_COMPONENTS[data.kind];

  return (
    <div className="node-config-panel">
      <div className="node-config-header">
        <div className="node-config-header-row">
          <div className="node-config-icon" style={{ background: meta.color }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d={meta.icon} />
            </svg>
          </div>
          <span className="node-config-kind" style={{ color: meta.color }}>{meta.label}</span>
        </div>
        <p className="node-config-desc">{meta.description}</p>
      </div>

      <div className="node-config-body">
        {/* Common: Label */}
        <div className="config-field">
          <label className="config-label">Label</label>
          <input
            className="config-input"
            value={data.label}
            onChange={(e) => updateLabel(e.target.value)}
          />
        </div>

        {/* Kind-specific config fields */}
        {ConfigComponent && (
          <ConfigComponent
            config={data.config.config as unknown as Record<string, unknown>}
            onChange={updateConfig}
          />
        )}
      </div>

      <div className="node-config-footer">
        <button className="node-config-delete" onClick={() => onDelete(node.id)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
            <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
          </svg>
          Delete Node
        </button>
      </div>
    </div>
  );
}
