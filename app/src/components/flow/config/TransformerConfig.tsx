import { KeyValueBuilder } from "./KeyValueBuilder";

interface TransformerConfigProps {
  config: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
}

export function TransformerConfig({ config, onChange }: TransformerConfigProps) {
  const inputMapping = (config.inputMapping as Record<string, string>) ?? {};

  return (
    <>
      <div className="config-field">
        <label className="config-label">Template</label>
        <textarea
          className="config-textarea"
          rows={4}
          value={(config.template as string) ?? ""}
          onChange={(e) => onChange({ template: e.target.value })}
          placeholder="{{input}}"
        />
        <span className="config-hint">Use {"{{variableName}}"} to reference mapped inputs</span>
      </div>
      <div className="config-field">
        <label className="config-label">Input Mapping</label>
        <KeyValueBuilder
          entries={inputMapping}
          onChange={(entries) => onChange({ inputMapping: entries })}
          keyLabel="Variable"
          valueLabel="Source path"
          addLabel="Add Mapping"
          keyPlaceholder="e.g. code"
          valuePlaceholder="e.g. input.codeBlock"
        />
      </div>
    </>
  );
}
