import { KeyValueBuilder } from "./KeyValueBuilder";

interface ToolConfigProps {
  config: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
}

export function ToolConfig({ config, onChange }: ToolConfigProps) {
  const args = (config.args as Record<string, string>) ?? {};

  return (
    <>
      <div className="config-field">
        <label className="config-label">Tool Name</label>
        <input
          className="config-input"
          value={(config.toolName as string) ?? ""}
          onChange={(e) => onChange({ toolName: e.target.value })}
          placeholder="e.g. run-tests, lint, deploy"
        />
      </div>
      <div className="config-field">
        <label className="config-label">Arguments</label>
        <KeyValueBuilder
          entries={args}
          onChange={(entries) => onChange({ args: entries })}
          keyLabel="Argument"
          valueLabel="Value"
          addLabel="Add Argument"
          keyPlaceholder="e.g. path"
          valuePlaceholder="e.g. ./src"
        />
      </div>
    </>
  );
}
