import { useState, type KeyboardEvent } from "react";

interface HandoffConfigProps {
  config: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
}

export function HandoffConfig({ config, onChange }: HandoffConfigProps) {
  const includeFields = (config.includeFields as string[]) ?? [];
  const [fieldInput, setFieldInput] = useState("");

  const addField = (field: string) => {
    const trimmed = field.trim();
    if (!trimmed || includeFields.includes(trimmed)) return;
    onChange({ includeFields: [...includeFields, trimmed] });
  };

  const removeField = (field: string) => {
    onChange({ includeFields: includeFields.filter((f) => f !== field) });
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && fieldInput.trim()) {
      e.preventDefault();
      addField(fieldInput);
      setFieldInput("");
    }
  };

  return (
    <>
      <div className="config-field">
        <label className="config-label">Briefing Prompt</label>
        <textarea
          className="config-textarea"
          rows={3}
          value={(config.briefingPrompt as string) ?? ""}
          onChange={(e) => onChange({ briefingPrompt: e.target.value })}
          placeholder="Summarize the current state..."
        />
      </div>
      <div className="config-field">
        <label className="config-label">Include Fields</label>
        {includeFields.length > 0 && (
          <div className="config-tag-list">
            {includeFields.map((field) => (
              <span key={field} className="config-tag">
                {field}
                <button className="config-tag-remove" onClick={() => removeField(field)}>
                  <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 6 6 18" /><path d="m6 6 12 12" />
                  </svg>
                </button>
              </span>
            ))}
          </div>
        )}
        <input
          className="config-input"
          value={fieldInput}
          onChange={(e) => setFieldInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Add field and press Enter"
        />
        <span className="config-hint">Fields from context to pass to the next agent</span>
      </div>
    </>
  );
}
