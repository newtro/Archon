import { useState, useEffect } from "react";
import { ListBuilder } from "./ListBuilder";

interface IntentConfigProps {
  config: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
}

interface IntentFormProps {
  onSubmit: (item: { name: string; instructions: string }) => void;
  onCancel: () => void;
  editingItem?: { name: string; instructions: string };
}

function IntentForm({ onSubmit, onCancel, editingItem }: IntentFormProps) {
  const [name, setName] = useState(editingItem?.name ?? "");
  const [instructions, setInstructions] = useState(editingItem?.instructions ?? "");
  const isEditing = !!editingItem;

  useEffect(() => {
    setName(editingItem?.name ?? "");
    setInstructions(editingItem?.instructions ?? "");
  }, [editingItem]);

  const handleSubmit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSubmit({ name: trimmed, instructions: instructions.trim() });
  };

  return (
    <>
      <span className="lb-label">Intent Name</span>
      <input
        className="lb-input"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g. feature, bug, question"
        autoFocus
      />
      <span className="lb-label">Classification Instructions</span>
      <textarea
        className="lb-textarea"
        rows={2}
        value={instructions}
        onChange={(e) => setInstructions(e.target.value)}
        placeholder="Describe when the LLM should classify input as this intent..."
      />
      <div className="list-builder-form-actions">
        <button className="lb-btn-add" onClick={handleSubmit}>
          {isEditing ? "Save" : "Add Intent"}
        </button>
        <button className="lb-btn-cancel" onClick={onCancel}>Cancel</button>
      </div>
    </>
  );
}

export function IntentConfig({ config, onChange }: IntentConfigProps) {
  const classifications = (config.classifications as Array<{ name: string; instructions: string }>) ?? [];

  return (
    <div className="config-field">
      <label className="config-label">Classifications</label>
      <ListBuilder<{ name: string; instructions: string }>
        items={classifications}
        onChange={(items) => onChange({ classifications: items })}
        renderItem={(item) => (
          <>
            <span className="list-builder-item-primary">{item.name}</span>
            {item.instructions && (
              <span className="list-builder-item-secondary">
                {item.instructions.length > 60 ? item.instructions.slice(0, 60) + "..." : item.instructions}
              </span>
            )}
          </>
        )}
        renderForm={(onSubmit, onCancel, editingItem) => (
          <IntentForm onSubmit={onSubmit} onCancel={onCancel} editingItem={editingItem} />
        )}
        addLabel="Add Intent"
        emptyLabel="No intents configured"
        getItemKey={(item) => item.name}
      />
      <span className="config-hint">Each intent creates an output handle on the node for routing</span>
    </div>
  );
}
