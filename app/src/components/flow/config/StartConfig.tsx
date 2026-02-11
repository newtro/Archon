interface StartConfigProps {
  config: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
}

export function StartConfig({ config, onChange }: StartConfigProps) {
  return (
    <div className="config-field">
      <label className="config-label">Input Schema (optional)</label>
      <textarea
        className="config-textarea"
        rows={4}
        value={(config.inputSchema as string) ?? ""}
        onChange={(e) => onChange({ inputSchema: e.target.value })}
        placeholder={'{ "type": "object", "properties": { "task": { "type": "string" } } }'}
      />
      <span className="config-hint">JSON Schema describing expected flow input</span>
    </div>
  );
}
