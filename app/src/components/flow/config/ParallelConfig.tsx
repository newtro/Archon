interface ParallelConfigProps {
  config: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
}

export function ParallelConfig({ config, onChange }: ParallelConfigProps) {
  return (
    <>
      <div className="config-field">
        <label className="config-label">Branches</label>
        <input
          type="number"
          className="config-input"
          min="2"
          max="10"
          value={Number(config.branches ?? 2)}
          onChange={(e) => onChange({ branches: parseInt(e.target.value) })}
        />
      </div>
      <div className="config-field">
        <label className="config-label">Merge Strategy</label>
        <div className="config-model-group">
          {(["all", "first", "majority"] as const).map((m) => (
            <button
              key={m}
              className={`config-model-btn ${config.mergeStrategy === m ? "active" : ""}`}
              onClick={() => onChange({ mergeStrategy: m })}
            >
              {m}
            </button>
          ))}
        </div>
        <span className="config-hint">
          {config.mergeStrategy === "all" && "Wait for all branches to complete"}
          {config.mergeStrategy === "first" && "Continue when the first branch finishes"}
          {config.mergeStrategy === "majority" && "Continue when majority of branches finish"}
        </span>
      </div>
    </>
  );
}
