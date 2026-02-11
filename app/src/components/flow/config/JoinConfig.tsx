interface JoinConfigProps {
  config: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
}

export function JoinConfig({ config, onChange }: JoinConfigProps) {
  const mode = (config.mode as string) ?? "all";

  return (
    <>
      <div className="config-field">
        <label className="config-label">Mode</label>
        <div className="config-model-group">
          {(["all", "first", "count"] as const).map((m) => (
            <button
              key={m}
              className={`config-model-btn ${mode === m ? "active" : ""}`}
              onClick={() => onChange({ mode: m })}
            >
              {m}
            </button>
          ))}
        </div>
        <span className="config-hint">
          {mode === "all" && "Wait for all connected branches to complete"}
          {mode === "first" && "Continue as soon as the first branch finishes"}
          {mode === "count" && "Continue when a specific number of branches finish"}
        </span>
      </div>

      {mode === "count" && (
        <div className="config-field">
          <label className="config-label">Required Count</label>
          <input
            type="number"
            className="config-input"
            min="1"
            max="20"
            value={Number(config.requiredCount ?? 1)}
            onChange={(e) => onChange({ requiredCount: parseInt(e.target.value) })}
          />
          <span className="config-hint">Number of branches that must complete before continuing</span>
        </div>
      )}

      <div className="config-field">
        <label className="config-label">Timeout (seconds)</label>
        <input
          type="number"
          className="config-input"
          min="0"
          value={Number(config.timeout ?? 0)}
          onChange={(e) => onChange({ timeout: parseInt(e.target.value) })}
        />
        <span className="config-hint">0 = no timeout</span>
      </div>

      <div className="config-field">
        <label className="config-label">Combine Template</label>
        <textarea
          className="config-textarea"
          rows={3}
          placeholder="Optional template for combining branch results..."
          value={(config.combineTemplate as string) ?? ""}
          onChange={(e) => onChange({ combineTemplate: e.target.value })}
        />
        <span className="config-hint">Leave empty to concatenate all branch outputs</span>
      </div>
    </>
  );
}
