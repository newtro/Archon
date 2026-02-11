import { Handle, Position, NodeResizer, type NodeProps } from "@xyflow/react";
import { NODE_REGISTRY, type FlowNodeData, type NodeKind } from "../../../lib/flow-types";
import type { NodeExecState } from "../../../hooks/useFlowExecution";
import "./BaseNode.css";

interface BaseNodeProps {
  kind: NodeKind;
  label: string;
  selected: boolean;
  children?: React.ReactNode;
  subtitle?: string;
  execState?: NodeExecState;
  streamingText?: string;
  durationMs?: number;
  hideDefaultOutput?: boolean;
  /** Rendered after body/exec-bar but still inside root div — for custom output handles */
  outputHandles?: React.ReactNode;
}

export function BaseNode({ kind, label, selected, children, subtitle, execState, streamingText, durationMs, hideDefaultOutput, outputHandles }: BaseNodeProps) {
  const meta = NODE_REGISTRY[kind];
  const stateClass = execState && execState !== "idle" ? `exec-${execState}` : "";

  return (
    <div
      className={`flow-node ${selected ? "selected" : ""} ${stateClass}`}
      style={{ "--node-color": meta.color } as React.CSSProperties}
    >
      <NodeResizer
        isVisible={selected}
        minWidth={180}
        minHeight={50}
        lineClassName="flow-node-resize-line"
        handleClassName="flow-node-resize-handle"
      />
      {meta.maxInputs !== 0 && (
        <Handle
          type="target"
          position={Position.Top}
          className="flow-handle flow-handle-target"
        />
      )}

      <div className="flow-node-header">
        <div className="flow-node-icon" style={{ background: meta.color }}>
          <svg
            width="14"
            height="14"
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
        <div className="flow-node-title-group">
          <span className="flow-node-label">{label}</span>
          {subtitle && <span className="flow-node-subtitle">{subtitle}</span>}
        </div>
        <span className="flow-node-kind">{meta.label}</span>
      </div>

      {children && <div className="flow-node-body">{children}</div>}

      {/* Execution state indicator */}
      {execState === "running" && (
        <div className="flow-node-exec-bar">
          <div className="flow-node-exec-spinner" />
          <span>Running...</span>
        </div>
      )}
      {execState === "streaming" && streamingText && (
        <div className="flow-node-exec-bar">
          <div className="flow-node-exec-spinner" />
          <span className="flow-node-streaming-text">
            {streamingText.length > 60 ? `...${streamingText.slice(-60)}` : streamingText}
          </span>
        </div>
      )}
      {execState === "completed" && (
        <div className="flow-node-exec-bar exec-completed">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
          <span>{durationMs != null ? `${(durationMs / 1000).toFixed(1)}s` : "Done"}</span>
        </div>
      )}
      {execState === "error" && (
        <div className="flow-node-exec-bar exec-error">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6 6 18" /><path d="m6 6 12 12" />
          </svg>
          <span>Error</span>
        </div>
      )}

      {meta.maxOutputs !== 0 && !hideDefaultOutput && (
        <Handle
          type="source"
          position={Position.Bottom}
          className="flow-handle flow-handle-source"
          id="default"
        />
      )}

      {/* Named output handles for multi-output nodes */}
      {meta.maxOutputs === 2 && kind !== "parallel" && (
        <>
          <Handle
            type="source"
            position={Position.Bottom}
            className="flow-handle flow-handle-source flow-handle-success"
            id="success"
            style={{ left: "35%" }}
          />
          <Handle
            type="source"
            position={Position.Bottom}
            className="flow-handle flow-handle-source flow-handle-fail"
            id="fail"
            style={{ left: "65%" }}
          />
        </>
      )}

      {/* Custom output handles (e.g. intent per-classification) */}
      {outputHandles}
    </div>
  );
}

// ── Typed node components for React Flow registration ────────────

// Helper to extract exec props from FlowNodeData
function execProps(d: FlowNodeData) {
  return {
    execState: d.execState as NodeExecState | undefined,
    streamingText: d.streamingText as string | undefined,
    durationMs: d.durationMs as number | undefined,
  };
}

export function StartNode({ data, selected }: NodeProps) {
  const d = data as unknown as FlowNodeData;
  return (
    <BaseNode kind="start" label={d.label} selected={!!selected} {...execProps(d)} />
  );
}

export function EndNode({ data, selected }: NodeProps) {
  const d = data as unknown as FlowNodeData;
  return (
    <BaseNode kind="end" label={d.label} selected={!!selected} {...execProps(d)} />
  );
}

export function LLMNode({ data, selected }: NodeProps) {
  const d = data as unknown as FlowNodeData;
  const cfg = d.config.kind === "llm" ? d.config.config : null;
  return (
    <BaseNode kind="llm" label={d.label} selected={!!selected} subtitle={cfg?.model} {...execProps(d)}>
      {cfg?.systemPrompt && (
        <div className="flow-node-preview">{cfg.systemPrompt.slice(0, 80)}...</div>
      )}
    </BaseNode>
  );
}

export function IntentNode({ data, selected }: NodeProps) {
  const d = data as unknown as FlowNodeData;
  const cfg = d.config.kind === "intent" ? d.config.config : null;
  const classifications = cfg?.classifications ?? [];

  const intentHandles = classifications.length > 0 ? (
    <>
      {classifications.map((c, i) => {
        const pct = ((i + 1) / (classifications.length + 1)) * 100;
        return (
          <Handle
            key={c.name}
            type="source"
            position={Position.Bottom}
            className="flow-handle flow-handle-source"
            id={c.name}
            style={{ left: `${pct}%` }}
          />
        );
      })}
      <div className="flow-node-handle-labels">
        {classifications.map((c, i) => {
          const pct = ((i + 1) / (classifications.length + 1)) * 100;
          return (
            <span key={c.name} className="flow-node-handle-label" style={{ left: `${pct}%` }}>{c.name}</span>
          );
        })}
      </div>
    </>
  ) : null;

  return (
    <BaseNode kind="intent" label={d.label} selected={!!selected} hideDefaultOutput outputHandles={intentHandles} {...execProps(d)} />
  );
}

export function EvaluatorNode({ data, selected }: NodeProps) {
  const d = data as unknown as FlowNodeData;
  const cfg = d.config.kind === "evaluator" ? d.config.config : null;
  return (
    <BaseNode kind="evaluator" label={d.label} selected={!!selected} subtitle={cfg ? `>= ${cfg.passThreshold}%` : undefined} {...execProps(d)} />
  );
}

export function ToolNode({ data, selected }: NodeProps) {
  const d = data as unknown as FlowNodeData;
  const cfg = d.config.kind === "tool" ? d.config.config : null;
  return (
    <BaseNode kind="tool" label={d.label} selected={!!selected} subtitle={cfg?.toolName || "Not configured"} {...execProps(d)} />
  );
}

export function TransformerNode({ data, selected }: NodeProps) {
  const d = data as unknown as FlowNodeData;
  return (
    <BaseNode kind="transformer" label={d.label} selected={!!selected} {...execProps(d)} />
  );
}

export function RouterNode({ data, selected }: NodeProps) {
  const d = data as unknown as FlowNodeData;
  const cfg = d.config.kind === "router" ? d.config.config : null;
  const rules = cfg?.rules ?? [];
  const isRulesMode = (cfg?.mode ?? "rules") === "rules";
  const llmOutputs = cfg?.llmOutputs ?? [];

  // Collect output labels: from rules in rules mode, from llmOutputs in LLM mode
  const outputLabels = isRulesMode
    ? rules.map((r) => r.output)
    : llmOutputs;

  const routerHandles = outputLabels.length > 0 ? (
    <>
      {outputLabels.map((label, i) => {
        const pct = ((i + 1) / (outputLabels.length + 1)) * 100;
        return (
          <Handle
            key={label}
            type="source"
            position={Position.Bottom}
            className="flow-handle flow-handle-source"
            id={label}
            style={{ left: `${pct}%` }}
          />
        );
      })}
      <div className="flow-node-handle-labels">
        {outputLabels.map((label, i) => {
          const pct = ((i + 1) / (outputLabels.length + 1)) * 100;
          return (
            <span key={label} className="flow-node-handle-label" style={{ left: `${pct}%` }}>{label}</span>
          );
        })}
      </div>
    </>
  ) : null;

  return (
    <BaseNode
      kind="router"
      label={d.label}
      selected={!!selected}
      subtitle={cfg?.mode || "rules"}
      hideDefaultOutput={outputLabels.length > 0}
      outputHandles={routerHandles}
      {...execProps(d)}
    />
  );
}

export function ParallelNode({ data, selected }: NodeProps) {
  const d = data as unknown as FlowNodeData;
  const cfg = d.config.kind === "parallel" ? d.config.config : null;
  return (
    <BaseNode kind="parallel" label={d.label} selected={!!selected} subtitle={cfg ? `${cfg.branches} branches` : undefined} {...execProps(d)} />
  );
}

export function JoinNode({ data, selected }: NodeProps) {
  const d = data as unknown as FlowNodeData;
  const cfg = d.config.kind === "join" ? d.config.config : null;
  const subtitle = cfg?.mode === "count" ? `${cfg.requiredCount ?? 0} of N` : cfg?.mode ?? "all";
  return (
    <BaseNode kind="join" label={d.label} selected={!!selected} subtitle={subtitle} {...execProps(d)} />
  );
}

export function HumanReviewNode({ data, selected }: NodeProps) {
  const d = data as unknown as FlowNodeData;
  return (
    <BaseNode kind="human-review" label={d.label} selected={!!selected} {...execProps(d)} />
  );
}

export function SubFlowNode({ data, selected }: NodeProps) {
  const d = data as unknown as FlowNodeData;
  const cfg = d.config.kind === "sub-flow" ? d.config.config : null;
  return (
    <BaseNode kind="sub-flow" label={d.label} selected={!!selected} subtitle={cfg?.flowId || "Not linked"} {...execProps(d)} />
  );
}

export function MemoryNode({ data, selected }: NodeProps) {
  const d = data as unknown as FlowNodeData;
  const cfg = d.config.kind === "memory" ? d.config.config : null;
  return (
    <BaseNode kind="memory" label={d.label} selected={!!selected} subtitle={cfg?.operation || "read"} {...execProps(d)} />
  );
}

export function HandoffNode({ data, selected }: NodeProps) {
  const d = data as unknown as FlowNodeData;
  return (
    <BaseNode kind="handoff" label={d.label} selected={!!selected} {...execProps(d)} />
  );
}

export function ProjectContextNode({ data, selected }: NodeProps) {
  const d = data as unknown as FlowNodeData;
  return (
    <BaseNode kind="project-context" label={d.label} selected={!!selected} {...execProps(d)} />
  );
}

// ── Node type map for React Flow ─────────────────────────────────

export const nodeTypes = {
  start: StartNode,
  end: EndNode,
  llm: LLMNode,
  intent: IntentNode,
  evaluator: EvaluatorNode,
  tool: ToolNode,
  transformer: TransformerNode,
  router: RouterNode,
  parallel: ParallelNode,
  join: JoinNode,
  "human-review": HumanReviewNode,
  "sub-flow": SubFlowNode,
  memory: MemoryNode,
  handoff: HandoffNode,
  "project-context": ProjectContextNode,
};
