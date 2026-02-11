interface MemoryConfigProps {
  config: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
}

export function MemoryConfig({ config, onChange }: MemoryConfigProps) {
  const operation = (config.operation as string) ?? "read";
  const showValueTemplate = operation === "write" || operation === "read-write";

  return (
    <>
      <div className="config-field">
        <label className="config-label">Operation</label>
        <div className="config-model-group">
          {(["read", "write", "read-write"] as const).map((m) => (
            <button
              key={m}
              className={`config-model-btn ${operation === m ? "active" : ""}`}
              onClick={() => onChange({ operation: m })}
            >
              {m}
            </button>
          ))}
        </div>
      </div>
      <div className="config-field">
        <label className="config-label">Key</label>
        <input
          className="config-input"
          value={(config.key as string) ?? ""}
          onChange={(e) => onChange({ key: e.target.value })}
          placeholder="state.files"
        />
        <span className="config-hint">Dot-path to the memory location</span>
      </div>
      {showValueTemplate && (
        <div className="config-field">
          <label className="config-label">Value Template</label>
          <textarea
            className="config-textarea"
            rows={2}
            value={(config.valueTemplate as string) ?? ""}
            onChange={(e) => onChange({ valueTemplate: e.target.value })}
            placeholder="{{input.result}}"
          />
          <span className="config-hint">Template for the value to write</span>
        </div>
      )}
    </>
  );
}
