import { MODEL_INFO } from "../../../lib/flow-types";

interface EvaluatorConfigProps {
  config: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
}

export function EvaluatorConfig({ config, onChange }: EvaluatorConfigProps) {
  return (
    <>
      <div className="config-field">
        <label className="config-label">Evaluation Model</label>
        <div className="config-model-group">
          {(["haiku", "sonnet", "opus"] as const).map((m) => (
            <button
              key={m}
              className={`config-model-btn ${(config.model ?? "sonnet") === m ? "active" : ""}`}
              onClick={() => onChange({ model: m })}
            >
              {MODEL_INFO[m].label}
            </button>
          ))}
        </div>
      </div>
      <div className="config-field">
        <label className="config-label">Evaluation Criteria</label>
        <textarea
          className="config-textarea"
          rows={3}
          value={(config.criteria as string) ?? ""}
          onChange={(e) => onChange({ criteria: e.target.value })}
          placeholder="Evaluate the quality and correctness of the output..."
        />
        <span className="config-hint">Instructions for the evaluation LLM</span>
      </div>
      <div className="config-field">
        <label className="config-label">Pass Threshold ({String(config.passThreshold ?? 70)}%)</label>
        <input
          type="range"
          className="config-range"
          min="0"
          max="100"
          step="5"
          value={Number(config.passThreshold ?? 70)}
          onChange={(e) => onChange({ passThreshold: parseInt(e.target.value) })}
        />
      </div>
    </>
  );
}
