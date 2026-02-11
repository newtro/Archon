interface EndConfigProps {
  config: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
}

export function EndConfig({ config, onChange }: EndConfigProps) {
  return (
    <div className="config-field">
      <label className="config-label">Output Template (optional)</label>
      <textarea
        className="config-textarea"
        rows={3}
        value={(config.outputTemplate as string) ?? ""}
        onChange={(e) => onChange({ outputTemplate: e.target.value })}
        placeholder="{{result}}"
      />
      <span className="config-hint">Template for the final flow output</span>
    </div>
  );
}
