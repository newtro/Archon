import { useState, useEffect } from "react";
import { listFlows } from "../../../lib/flow-storage";

interface SubFlowConfigProps {
  config: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
}

export function SubFlowConfig({ config, onChange }: SubFlowConfigProps) {
  const [flows, setFlows] = useState<Array<{ id: string; name: string }>>([]);

  useEffect(() => {
    listFlows().then((list) =>
      setFlows(list.map((f) => ({ id: f.id, name: f.name })))
    );
  }, []);

  return (
    <div className="config-field">
      <label className="config-label">Sub-flow</label>
      <select
        className="config-select"
        value={(config.flowId as string) ?? ""}
        onChange={(e) => onChange({ flowId: e.target.value })}
      >
        <option value="">Select a flow...</option>
        {flows.map((f) => (
          <option key={f.id} value={f.id}>{f.name}</option>
        ))}
      </select>
      <span className="config-hint">The selected flow will run as a nested step</span>
    </div>
  );
}
