import { useState, useEffect, useCallback } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import { Plus, ArrowLeft, X, Workflow, Download, Upload } from "lucide-react";
import { FlowCanvas } from "./FlowCanvas";
import { listFlows, loadFlow, saveFlow, createFlow, deleteFlow } from "../../lib/flow-storage";
import type { FlowDefinition } from "../../lib/flow-types";
import type { FlowExecutionState } from "../../hooks/useFlowExecution";
import "./FlowDesigner.css";

interface FlowDesignerProps {
  execState?: FlowExecutionState;
  onRunFlow?: (flow: FlowDefinition, input: string) => void;
  onCancelFlow?: () => void;
  onResetFlow?: () => void;
}

export function FlowDesigner({ execState, onRunFlow, onCancelFlow, onResetFlow }: FlowDesignerProps) {
  const [flows, setFlows] = useState<Array<{ id: string; name: string; description: string; updatedAt: number }>>([]);
  const [activeFlow, setActiveFlow] = useState<FlowDefinition | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshFlows = useCallback(async () => {
    try {
      const list = await listFlows();
      setFlows(list);
      setError(null);
    } catch (err) {
      setError(`Failed to load flows: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshFlows();
  }, [refreshFlows]);

  const handleOpenFlow = useCallback(async (id: string) => {
    const flow = await loadFlow(id);
    if (flow) setActiveFlow(flow);
  }, []);

  const handleCreateFlow = useCallback(async () => {
    const flow = await createFlow("New Flow", "");
    await refreshFlows();
    setActiveFlow(flow);
  }, [refreshFlows]);

  const handleFlowChange = useCallback(async (flow: FlowDefinition) => {
    await saveFlow(flow);
    setActiveFlow(flow);
    await refreshFlows();
  }, [refreshFlows]);

  const handleDeleteFlow = useCallback(async (id: string) => {
    await deleteFlow(id);
    if (activeFlow?.id === id) setActiveFlow(null);
    await refreshFlows();
  }, [activeFlow, refreshFlows]);

  const handleBackToList = useCallback(() => {
    setActiveFlow(null);
  }, []);

  const handleExportFlow = useCallback(async (id: string, name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const flow = await loadFlow(id);
    if (!flow) return;
    const json = JSON.stringify(flow, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name.replace(/[^a-zA-Z0-9]/g, "_")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const handleImportFlow = useCallback(async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const text = await file.text();
      try {
        const imported = JSON.parse(text) as FlowDefinition;
        imported.id = crypto.randomUUID();
        imported.createdAt = Date.now();
        imported.updatedAt = Date.now();
        await saveFlow(imported);
        await refreshFlows();
        setActiveFlow(imported);
      } catch {
        setError("Invalid flow JSON file");
      }
    };
    input.click();
  }, [refreshFlows]);

  if (activeFlow) {
    return (
      <ReactFlowProvider>
        <div className="flow-designer-active">
          <button className="flow-designer-back" onClick={handleBackToList}>
            <ArrowLeft size={14} />
            All Flows
          </button>
          <FlowCanvas
            flow={activeFlow}
            onFlowChange={handleFlowChange}
            execState={execState}
            onRunFlow={onRunFlow ? (input) => onRunFlow(activeFlow, input) : undefined}
            onCancelFlow={onCancelFlow}
            onResetFlow={onResetFlow}
          />
        </div>
      </ReactFlowProvider>
    );
  }

  return (
    <div className="flow-designer-list">
      <div className="flow-designer-header">
        <h2 className="flow-designer-title">Flows</h2>
        <div className="flow-designer-actions">
          <button className="flow-designer-import" onClick={handleImportFlow} title="Import flow from JSON">
            <Upload size={14} />
            Import
          </button>
          <button className="flow-designer-create" onClick={handleCreateFlow}>
            <Plus size={14} />
            New Flow
          </button>
        </div>
      </div>

      {error && <div className="flow-designer-error">{error}</div>}

      <div className="flow-designer-grid">
        {isLoading ? (
          <div className="flow-designer-loading">Loading flows...</div>
        ) : flows.length === 0 ? (
          <div className="flow-designer-empty">
            <Workflow size={40} strokeWidth={1.5} style={{ opacity: 0.2 }} />
            <p>No flows yet</p>
            <button className="flow-designer-create-empty" onClick={handleCreateFlow}>
              Create your first flow
            </button>
          </div>
        ) : (
          flows.map((f) => (
            <div key={f.id} className="flow-card" onClick={() => handleOpenFlow(f.id)}>
              <div className="flow-card-header">
                <span className="flow-card-name">{f.name}</span>
                <div className="flow-card-actions">
                  <button
                    className="flow-card-action-btn"
                    onClick={(e) => handleExportFlow(f.id, f.name, e)}
                    title="Export flow"
                  >
                    <Download size={12} />
                  </button>
                  <button
                    className="flow-card-delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteFlow(f.id);
                    }}
                    title="Delete flow"
                  >
                    <X size={12} />
                  </button>
                </div>
              </div>
              {f.description && (
                <p className="flow-card-desc">{f.description}</p>
              )}
              <span className="flow-card-date">
                {new Date(f.updatedAt).toLocaleDateString()}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
