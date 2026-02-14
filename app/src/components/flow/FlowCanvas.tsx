import { useCallback, useEffect, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  type Connection,
  type Node,
  type Edge,
  type OnNodesChange,
  type OnEdgesChange,
  type NodeMouseHandler,
  type EdgeMouseHandler,
  BackgroundVariant,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { nodeTypes } from "./nodes/BaseNode";
import { NodePalette } from "./NodePalette";
import { NodeConfigPanel } from "./NodeConfigPanel";
import { ContextMenu, type ContextMenuEntry } from "./ContextMenu";
import { FlowSettingsPanel } from "./config/FlowSettingsPanel";
import {
  getDefaultConfig,
  NODE_REGISTRY,
  CATEGORY_COLORS,
  type NodeKind,
  type FlowNodeData,
  type FlowDefinition,
  type EdgeSignal,
} from "../../lib/flow-types";
import type { FlowExecutionState } from "../../hooks/useFlowExecution";
import "./FlowCanvas.css";

interface FlowCanvasProps {
  flow: FlowDefinition | null;
  onFlowChange: (flow: FlowDefinition) => void | Promise<void>;
  execState?: FlowExecutionState;
  onRunFlow?: (input: string) => void;
  onCancelFlow?: () => void;
  onResetFlow?: () => void;
  onPublishFlow?: (flow: FlowDefinition) => void;
}

let nodeIdCounter = 0;
function nextNodeId(): string {
  return `node_${Date.now()}_${nodeIdCounter++}`;
}

// ── Undo/Redo History ──────────────────────────────────────────

interface HistoryEntry {
  nodes: Node[];
  edges: Edge[];
}

const MAX_HISTORY = 50;

export function FlowCanvas({ flow, onFlowChange, execState, onRunFlow, onCancelFlow, onResetFlow, onPublishFlow }: FlowCanvasProps) {
  const [runInput, setRunInput] = useState("");
  const [flowName, setFlowName] = useState(flow?.name ?? "Untitled Flow");
  const [isEditingName, setIsEditingName] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [copied, setCopied] = useState(false);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(
    flow?.nodes.map((n) => ({
      id: n.id,
      type: n.kind,
      position: { x: n.x, y: n.y },
      data: { kind: n.kind, label: n.label, config: n.config } satisfies FlowNodeData,
    })) ?? []
  );

  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(
    flow?.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
      animated: true,
      style: { stroke: e.signal === "fail" ? "#ef4444" : e.signal === "success" ? "#22c55e" : "#64748b" },
    })) ?? []
  );

  // Sync flow name when flow prop changes
  useEffect(() => {
    setFlowName(flow?.name ?? "Untitled Flow");
  }, [flow?.id]);

  // ── Undo / Redo ────────────────────────────────────────────
  const historyRef = useRef<HistoryEntry[]>([]);
  const futureRef = useRef<HistoryEntry[]>([]);
  const skipHistoryRef = useRef(false);

  // Snapshot current state to history
  const pushHistory = useCallback(() => {
    historyRef.current = [
      ...historyRef.current.slice(-(MAX_HISTORY - 1)),
      { nodes: [...nodes], edges: [...edges] },
    ];
    futureRef.current = [];
  }, [nodes, edges]);

  // Track changes for undo — push on meaningful changes via wrapper
  const wrappedOnNodesChange: OnNodesChange<Node> = useCallback(
    (changes) => {
      const isDeletion = changes.some((c) => c.type === "remove");
      if (isDeletion && !skipHistoryRef.current) {
        pushHistory();
      }
      (onNodesChange as OnNodesChange<Node>)(changes);
    },
    [onNodesChange, pushHistory]
  );

  const wrappedOnEdgesChange: OnEdgesChange<Edge> = useCallback(
    (changes) => {
      const isDeletion = changes.some((c) => c.type === "remove");
      if (isDeletion && !skipHistoryRef.current) {
        pushHistory();
      }
      (onEdgesChange as OnEdgesChange<Edge>)(changes);
    },
    [onEdgesChange, pushHistory]
  );

  const undo = useCallback(() => {
    if (historyRef.current.length === 0) return;
    const prev = historyRef.current.pop()!;
    futureRef.current.push({ nodes: [...nodes], edges: [...edges] });
    skipHistoryRef.current = true;
    setNodes(prev.nodes);
    setEdges(prev.edges);
    skipHistoryRef.current = false;
  }, [nodes, edges, setNodes, setEdges]);

  const redo = useCallback(() => {
    if (futureRef.current.length === 0) return;
    const next = futureRef.current.pop()!;
    historyRef.current.push({ nodes: [...nodes], edges: [...edges] });
    skipHistoryRef.current = true;
    setNodes(next.nodes);
    setEdges(next.edges);
    skipHistoryRef.current = false;
  }, [nodes, edges, setNodes, setEdges]);

  // Keyboard shortcut: Ctrl+Z / Ctrl+Shift+Z
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && e.shiftKey) {
        e.preventDefault();
        redo();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "y") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [undo, redo]);

  // ── Context Menu ───────────────────────────────────────────
  type ContextMenuState =
    | { type: "node"; x: number; y: number; nodeId: string }
    | { type: "edge"; x: number; y: number; edgeId: string }
    | { type: "pane"; x: number; y: number; screenPos: { x: number; y: number } }
    | null;

  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);

  const onNodeContextMenu: NodeMouseHandler<Node> = useCallback(
    (event, node) => {
      event.preventDefault();
      setContextMenu({ type: "node", x: event.clientX, y: event.clientY, nodeId: node.id });
    },
    []
  );

  const onEdgeContextMenu: EdgeMouseHandler<Edge> = useCallback(
    (event, edge) => {
      event.preventDefault();
      setContextMenu({ type: "edge", x: event.clientX, y: event.clientY, edgeId: edge.id });
    },
    []
  );

  const onPaneContextMenu = useCallback(
    (event: MouseEvent | React.MouseEvent) => {
      event.preventDefault();
      setContextMenu({
        type: "pane",
        x: event.clientX,
        y: event.clientY,
        screenPos: { x: event.clientX, y: event.clientY },
      });
    },
    []
  );

  const handlePaneClick = useCallback(() => {
    setContextMenu(null);
  }, []);

  // ── Execution state injection ──────────────────────────────
  useEffect(() => {
    if (!execState || execState.status === "idle") return;
    setNodes((nds) =>
      nds.map((n) => {
        const nodeExec = execState.nodeStates[n.id];
        if (!nodeExec) return n;
        const d = n.data as unknown as FlowNodeData;
        return {
          ...n,
          data: {
            ...d,
            execState: nodeExec.state,
            streamingText: nodeExec.streamingText,
            durationMs: nodeExec.output?.durationMs,
          },
        };
      }),
    );
  }, [execState, setNodes]);

  const selectedNodeId = nodes.find((n) => n.selected)?.id ?? null;
  const selectedNode = selectedNodeId ? nodes.find((n) => n.id === selectedNodeId) : null;
  const reactFlowWrapper = useRef<HTMLDivElement>(null);

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) =>
        addEdge(
          {
            ...connection,
            animated: true,
            style: { stroke: "#64748b" },
          },
          eds
        )
      );
    },
    [setEdges]
  );

  const handleAddNode = useCallback(
    (kind: NodeKind) => {
      pushHistory();
      const meta = NODE_REGISTRY[kind];
      const id = nextNodeId();
      const newNode: Node = {
        id,
        type: kind,
        position: { x: 250 + Math.random() * 200, y: 150 + Math.random() * 200 },
        data: {
          kind,
          label: meta.label,
          config: getDefaultConfig(kind),
        } satisfies FlowNodeData,
      };
      setNodes((nds) => [...nds, newNode]);
    },
    [setNodes, pushHistory]
  );

  const handleNodeConfigChange = useCallback(
    (nodeId: string, data: FlowNodeData) => {
      setNodes((nds) =>
        nds.map((n) => (n.id === nodeId ? { ...n, data } : n))
      );
    },
    [setNodes]
  );

  const handleDeleteNode = useCallback(
    (nodeId: string) => {
      pushHistory();
      setNodes((nds) => nds.filter((n) => n.id !== nodeId));
      setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
    },
    [setNodes, setEdges, pushHistory]
  );

  const handleDuplicateNode = useCallback(
    (nodeId: string) => {
      pushHistory();
      const original = nodes.find((n) => n.id === nodeId);
      if (!original) return;
      const d = original.data as unknown as FlowNodeData;
      const id = nextNodeId();
      const newNode: Node = {
        id,
        type: original.type,
        position: { x: original.position.x + 40, y: original.position.y + 40 },
        data: { ...d, label: `${d.label} (copy)` } satisfies FlowNodeData,
      };
      setNodes((nds) => [...nds, newNode]);
    },
    [nodes, setNodes, pushHistory]
  );

  const handleDeleteEdge = useCallback(
    (edgeId: string) => {
      pushHistory();
      setEdges((eds) => eds.filter((e) => e.id !== edgeId));
    },
    [setEdges, pushHistory]
  );

  const handleSelectAll = useCallback(() => {
    setNodes((nds) => nds.map((n) => ({ ...n, selected: true })));
    setEdges((eds) => eds.map((e) => ({ ...e, selected: true })));
  }, [setNodes, setEdges]);

  // Serialize current state back to flow definition
  const handleSave = useCallback(async () => {
    if (!flow) return;
    setSaveStatus("saving");
    try {
      const updated: FlowDefinition = {
        ...flow,
        name: flowName.trim() || "Untitled Flow",
        updatedAt: Date.now(),
        nodes: nodes.map((n) => {
          const d = n.data as unknown as FlowNodeData;
          return {
            id: n.id,
            kind: d.kind,
            label: d.label,
            x: n.position.x,
            y: n.position.y,
            config: d.config,
          };
        }),
        edges: edges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: e.sourceHandle ?? null,
          targetHandle: e.targetHandle ?? null,
          signal: (e.sourceHandle ?? "default") as EdgeSignal,
        })),
      };
      await onFlowChange(updated);
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 1500);
    } catch {
      setSaveStatus("error");
      setTimeout(() => setSaveStatus("idle"), 2500);
    }
  }, [flow, flowName, nodes, edges, onFlowChange]);

  return (
    <div className="flow-canvas-layout">
      <NodePalette onAddNode={handleAddNode} />
      <div className="flow-canvas-wrapper" ref={reactFlowWrapper}>
        <div className="flow-canvas-toolbar">
          {isEditingName ? (
            <input
              className="flow-canvas-name-input"
              value={flowName}
              onChange={(e) => setFlowName(e.target.value)}
              onBlur={() => setIsEditingName(false)}
              onKeyDown={(e) => {
                if (e.key === "Enter") setIsEditingName(false);
                if (e.key === "Escape") {
                  setFlowName(flow?.name ?? "Untitled Flow");
                  setIsEditingName(false);
                }
              }}
              autoFocus
            />
          ) : (
            <span
              className="flow-canvas-name"
              onClick={() => setIsEditingName(true)}
              title="Click to rename"
            >
              {flowName}
            </span>
          )}
          <div className="flow-canvas-toolbar-actions">
            {/* Undo / Redo */}
            <button
              className="flow-canvas-icon-btn"
              onClick={undo}
              title="Undo (Ctrl+Z)"
              disabled={historyRef.current.length === 0}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 7v6h6" /><path d="M21 17a9 9 0 00-9-9 9 9 0 00-6.69 3L3 13" />
              </svg>
            </button>
            <button
              className="flow-canvas-icon-btn"
              onClick={redo}
              title="Redo (Ctrl+Shift+Z)"
              disabled={futureRef.current.length === 0}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 7v6h-6" /><path d="M3 17a9 9 0 019-9 9 9 0 016.69 3L21 13" />
              </svg>
            </button>

            <div className="flow-toolbar-divider" />

            {/* Execution controls */}
            {execState?.status === "idle" || !execState ? (
              <div className="flow-run-group">
                <input
                  className="flow-run-input"
                  type="text"
                  placeholder="Enter task..."
                  value={runInput}
                  onChange={(e) => setRunInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && runInput.trim() && onRunFlow) {
                      onRunFlow(runInput.trim());
                    }
                  }}
                />
                <button
                  className="flow-canvas-run-btn"
                  onClick={() => onRunFlow?.(runInput.trim())}
                  disabled={!runInput.trim() || !onRunFlow}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                    <path d="M5 3l14 9-14 9V3z" />
                  </svg>
                  Run
                </button>
              </div>
            ) : execState?.status === "running" ? (
              <button className="flow-canvas-stop-btn" onClick={onCancelFlow}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                  <rect x="6" y="6" width="12" height="12" rx="1" />
                </svg>
                Stop
              </button>
            ) : (
              <div className="flow-run-status-group">
                <span className={`flow-run-status ${execState?.status === "completed" ? "status-success" : "status-error"}`}>
                  {execState?.status === "completed" ? "Completed" : "Error"}
                </span>
                <button className="flow-canvas-reset-btn" onClick={onResetFlow}>
                  Reset
                </button>
              </div>
            )}

            <div className="flow-toolbar-divider" />

            <button
              className={`flow-canvas-icon-btn ${copied ? "save-success" : ""}`}
              onClick={() => {
                if (!flow) return;
                const exported: FlowDefinition = {
                  ...flow,
                  name: flowName,
                  nodes: nodes.map((n) => {
                    const d = n.data as unknown as FlowNodeData;
                    return { id: n.id, kind: d.kind, label: d.label, x: n.position.x, y: n.position.y, config: d.config };
                  }),
                  edges: edges.map((e) => ({
                    id: e.id, source: e.source, target: e.target,
                    sourceHandle: e.sourceHandle ?? null, targetHandle: e.targetHandle ?? null,
                    signal: (e.sourceHandle ?? "default") as EdgeSignal,
                  })),
                };
                const json = JSON.stringify(exported, null, 2);
                navigator.clipboard.writeText(json);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              title="Copy flow JSON to clipboard"
            >
              {copied ? (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              )}
            </button>
            <button
              className="flow-canvas-icon-btn"
              onClick={async () => {
                if (!flow) return;
                try {
                  const text = await navigator.clipboard.readText();
                  const imported = JSON.parse(text) as FlowDefinition;
                  if (!imported.nodes || !Array.isArray(imported.nodes)) {
                    alert("Invalid flow JSON: missing nodes array");
                    return;
                  }
                  // Apply pasted content onto current flow (keep same id)
                  const updated: FlowDefinition = {
                    ...flow,
                    name: imported.name ?? flow.name,
                    description: imported.description ?? flow.description,
                    nodes: imported.nodes,
                    edges: imported.edges ?? [],
                    updatedAt: Date.now(),
                  };
                  setFlowName(updated.name);
                  setNodes(updated.nodes.map((n) => ({
                    id: n.id,
                    type: n.kind,
                    position: { x: n.x, y: n.y },
                    data: { kind: n.kind, label: n.label, config: n.config } satisfies FlowNodeData,
                  })));
                  setEdges(updated.edges.map((e) => ({
                    id: e.id,
                    source: e.source,
                    target: e.target,
                    sourceHandle: e.sourceHandle,
                    targetHandle: e.targetHandle,
                    animated: true,
                    style: { stroke: e.signal === "fail" ? "#ef4444" : e.signal === "success" ? "#22c55e" : "#64748b" },
                  })));
                  await onFlowChange(updated);
                } catch {
                  alert("Could not paste: invalid JSON in clipboard");
                }
              }}
              title="Paste flow JSON from clipboard"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 2H9a1 1 0 0 0-1 1v2c0 .6.4 1 1 1h6c.6 0 1-.4 1-1V3c0-.6-.4-1-1-1Z" />
                <path d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2" />
              </svg>
            </button>

            {onPublishFlow && (
              <button
                className="flow-canvas-icon-btn"
                onClick={() => {
                  if (!flow) return;
                  const exported: FlowDefinition = {
                    ...flow,
                    name: flowName,
                    nodes: nodes.map((n) => {
                      const d = n.data as unknown as FlowNodeData;
                      return { id: n.id, kind: d.kind, label: d.label, x: n.position.x, y: n.position.y, config: d.config };
                    }),
                    edges: edges.map((e) => ({
                      id: e.id, source: e.source, target: e.target,
                      sourceHandle: e.sourceHandle ?? null, targetHandle: e.targetHandle ?? null,
                      signal: (e.sourceHandle ?? "default") as EdgeSignal,
                    })),
                  };
                  onPublishFlow(exported);
                }}
                title="Share to Community"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
                  <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                </svg>
              </button>
            )}

            <button
              className={`flow-canvas-save-btn ${saveStatus === "saved" ? "save-success" : ""} ${saveStatus === "error" ? "save-error" : ""}`}
              onClick={handleSave}
              disabled={saveStatus === "saving"}
            >
              {saveStatus === "saving" ? (
                <>
                  <div className="flow-save-spinner" />
                  Saving...
                </>
              ) : saveStatus === "saved" ? (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                  Saved
                </>
              ) : saveStatus === "error" ? (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 6 6 18" /><path d="m6 6 12 12" />
                  </svg>
                  Error
                </>
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
                    <path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7" />
                    <path d="M7 3v4a1 1 0 0 0 1 1h7" />
                  </svg>
                  Save
                </>
              )}
            </button>
          </div>
        </div>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={wrappedOnNodesChange}
          onEdgesChange={wrappedOnEdgesChange}
          onConnect={onConnect}
          onNodeContextMenu={onNodeContextMenu}
          onEdgeContextMenu={onEdgeContextMenu}
          onPaneContextMenu={onPaneContextMenu}
          onPaneClick={handlePaneClick}
          nodeTypes={nodeTypes}
          fitView
          snapToGrid
          snapGrid={[16, 16]}
          deleteKeyCode={["Delete", "Backspace"]}
          className="flow-canvas"
          proOptions={{ hideAttribution: true }}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={16}
            size={1}
            color="var(--border-secondary)"
          />
          <Controls
            className="flow-controls"
            showInteractive={false}
          />
          <MiniMap
            className="flow-minimap"
            nodeColor={(node) => {
              const d = node.data as unknown as FlowNodeData;
              const meta = NODE_REGISTRY[d.kind];
              return meta ? CATEGORY_COLORS[meta.category] : "#64748b";
            }}
            maskColor="rgba(0, 0, 0, 0.6)"
          />
        </ReactFlow>

        {/* Context menu */}
        {contextMenu && (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            onClose={() => setContextMenu(null)}
            items={
              contextMenu.type === "node"
                ? ([
                    {
                      label: "Duplicate",
                      icon: (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                          <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                        </svg>
                      ),
                      onClick: () => handleDuplicateNode(contextMenu.nodeId),
                    },
                    "divider" as const,
                    {
                      label: "Delete",
                      icon: (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                          <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                        </svg>
                      ),
                      onClick: () => handleDeleteNode(contextMenu.nodeId),
                      danger: true,
                    },
                  ] satisfies ContextMenuEntry[])
                : contextMenu.type === "edge"
                ? ([
                    {
                      label: "Delete connection",
                      icon: (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                          <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                        </svg>
                      ),
                      onClick: () => handleDeleteEdge(contextMenu.edgeId),
                      danger: true,
                    },
                  ] satisfies ContextMenuEntry[])
                : ([
                    {
                      label: "Select all",
                      icon: (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="3" width="18" height="18" rx="2" />
                          <path d="M9 12l2 2 4-4" />
                        </svg>
                      ),
                      onClick: handleSelectAll,
                    },
                    "divider" as const,
                    {
                      label: "Paste flow from clipboard",
                      icon: (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M15 2H9a1 1 0 0 0-1 1v2c0 .6.4 1 1 1h6c.6 0 1-.4 1-1V3c0-.6-.4-1-1-1Z" />
                          <path d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2" />
                        </svg>
                      ),
                      onClick: async () => {
                        if (!flow) return;
                        try {
                          const text = await navigator.clipboard.readText();
                          const imported = JSON.parse(text) as FlowDefinition;
                          if (!imported.nodes || !Array.isArray(imported.nodes)) return;
                          const updated: FlowDefinition = {
                            ...flow,
                            name: imported.name ?? flow.name,
                            description: imported.description ?? flow.description,
                            nodes: imported.nodes,
                            edges: imported.edges ?? [],
                            updatedAt: Date.now(),
                          };
                          setFlowName(updated.name);
                          setNodes(updated.nodes.map((n) => ({
                            id: n.id,
                            type: n.kind,
                            position: { x: n.x, y: n.y },
                            data: { kind: n.kind, label: n.label, config: n.config } satisfies FlowNodeData,
                          })));
                          setEdges(updated.edges.map((e) => ({
                            id: e.id,
                            source: e.source,
                            target: e.target,
                            sourceHandle: e.sourceHandle,
                            targetHandle: e.targetHandle,
                            animated: true,
                            style: { stroke: e.signal === "fail" ? "#ef4444" : e.signal === "success" ? "#22c55e" : "#64748b" },
                          })));
                          await onFlowChange(updated);
                        } catch { /* invalid clipboard content */ }
                      },
                    },
                  ] satisfies ContextMenuEntry[])
            }
          />
        )}
      </div>
      {selectedNode ? (
        <NodeConfigPanel
          node={selectedNode}
          onConfigChange={handleNodeConfigChange}
          onDelete={handleDeleteNode}
        />
      ) : flow ? (
        <FlowSettingsPanel
          flow={flow}
          onChange={(updated) => {
            onFlowChange(updated);
          }}
        />
      ) : null}
    </div>
  );
}
