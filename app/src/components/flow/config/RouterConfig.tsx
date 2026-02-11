import { useState, useEffect } from "react";
import { ListBuilder } from "./ListBuilder";

interface RouterConfigProps {
  config: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
}

interface RuleFormProps {
  onSubmit: (item: { condition: string; output: string }) => void;
  onCancel: () => void;
  editingItem?: { condition: string; output: string };
}

function RuleForm({ onSubmit, onCancel, editingItem }: RuleFormProps) {
  const [condition, setCondition] = useState(editingItem?.condition ?? "");
  const [output, setOutput] = useState(editingItem?.output ?? "");
  const isEditing = !!editingItem;

  useEffect(() => {
    setCondition(editingItem?.condition ?? "");
    setOutput(editingItem?.output ?? "");
  }, [editingItem]);

  const handleSubmit = () => {
    const c = condition.trim();
    const o = output.trim();
    if (!c || !o) return;
    onSubmit({ condition: c, output: o });
  };

  return (
    <>
      <span className="lb-label">Condition</span>
      <input
        className="lb-input"
        value={condition}
        onChange={(e) => setCondition(e.target.value)}
        placeholder="e.g. input.type === 'error'"
        autoFocus
      />
      <span className="lb-label">Output Label</span>
      <input
        className="lb-input"
        value={output}
        onChange={(e) => setOutput(e.target.value)}
        placeholder="e.g. error-handler"
        onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
      />
      <div className="list-builder-form-actions">
        <button className="lb-btn-add" onClick={handleSubmit}>
          {isEditing ? "Save" : "Add Rule"}
        </button>
        <button className="lb-btn-cancel" onClick={onCancel}>Cancel</button>
      </div>
    </>
  );
}

function OutputTagInput({ outputs, onChange }: { outputs: string[]; onChange: (outputs: string[]) => void }) {
  const [value, setValue] = useState("");

  const handleAdd = () => {
    const trimmed = value.trim();
    if (!trimmed || outputs.includes(trimmed)) return;
    onChange([...outputs, trimmed]);
    setValue("");
  };

  const handleRemove = (output: string) => {
    onChange(outputs.filter((o) => o !== output));
  };

  return (
    <div>
      {outputs.length > 0 && (
        <div className="config-tag-list" style={{ marginBottom: 6 }}>
          {outputs.map((o) => (
            <span key={o} className="config-tag">
              {o}
              <button className="config-tag-remove" onClick={() => handleRemove(o)}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6 6 18" /><path d="m6 6 12 12" />
                </svg>
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        className="config-input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAdd(); } }}
        placeholder="Type output name + Enter"
        style={{ width: "100%" }}
      />
    </div>
  );
}

export function RouterConfig({ config, onChange }: RouterConfigProps) {
  const mode = (config.mode as string) ?? "rules";
  const rules = (config.rules as Array<{ condition: string; output: string }>) ?? [];
  const llmOutputs = (config.llmOutputs as string[]) ?? [];

  return (
    <>
      <div className="config-field">
        <label className="config-label">Routing Mode</label>
        <div className="config-model-group">
          {(["rules", "llm"] as const).map((m) => (
            <button
              key={m}
              className={`config-model-btn ${mode === m ? "active" : ""}`}
              onClick={() => onChange({ mode: m })}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {mode === "rules" && (
        <div className="config-field">
          <label className="config-label">Rules</label>
          <ListBuilder<{ condition: string; output: string }>
            items={rules}
            onChange={(items) => onChange({ rules: items })}
            renderItem={(rule) => (
              <>
                <span className="list-builder-item-primary">IF: {rule.condition}</span>
                <span className="list-builder-item-secondary">THEN: {rule.output}</span>
              </>
            )}
            renderForm={(onSubmit, onCancel, editingItem) => (
              <RuleForm onSubmit={onSubmit} onCancel={onCancel} editingItem={editingItem} />
            )}
            addLabel="Add Rule"
            emptyLabel="No rules configured"
            getItemKey={(_, i) => `rule-${i}`}
          />
        </div>
      )}

      {mode === "llm" && (
        <>
          <div className="config-field">
            <label className="config-label">Routing Instructions</label>
            <textarea
              className="config-textarea"
              rows={4}
              value={(config.llmPrompt as string) ?? ""}
              onChange={(e) => onChange({ llmPrompt: e.target.value })}
              placeholder="Describe how to classify and route inputs to different outputs..."
            />
            <span className="config-hint">The LLM will decide which output path to take</span>
          </div>
          <div className="config-field">
            <label className="config-label">Outputs</label>
            <OutputTagInput
              outputs={llmOutputs}
              onChange={(items) => onChange({ llmOutputs: items })}
            />
            <span className="config-hint">Define the output routes the LLM can choose from</span>
          </div>
        </>
      )}
    </>
  );
}
