import { useState } from "react";
import "./KeyValueBuilder.css";

interface KeyValueBuilderProps {
  entries: Record<string, string>;
  onChange: (entries: Record<string, string>) => void;
  keyLabel?: string;
  valueLabel?: string;
  addLabel?: string;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
}

export function KeyValueBuilder({
  entries,
  onChange,
  keyLabel = "Key",
  valueLabel = "Value",
  addLabel = "Add Entry",
  keyPlaceholder = "key",
  valuePlaceholder = "value",
}: KeyValueBuilderProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");

  const pairs = Object.entries(entries);

  const handleAdd = () => {
    const k = newKey.trim();
    if (!k) return;
    onChange({ ...entries, [k]: newValue });
    setNewKey("");
    setNewValue("");
    setIsAdding(false);
  };

  const handleEdit = () => {
    if (editingKey === null) return;
    const k = newKey.trim();
    if (!k) return;
    const next = { ...entries };
    // If key was renamed, remove old key
    if (k !== editingKey) delete next[editingKey];
    next[k] = newValue;
    onChange(next);
    setEditingKey(null);
    setNewKey("");
    setNewValue("");
  };

  const handleDelete = (key: string) => {
    const next = { ...entries };
    delete next[key];
    onChange(next);
    if (editingKey === key) {
      setEditingKey(null);
      setNewKey("");
      setNewValue("");
    }
  };

  const startEditing = (key: string, value: string) => {
    setIsAdding(false);
    setEditingKey(key);
    setNewKey(key);
    setNewValue(value);
  };

  const cancelEditing = () => {
    setEditingKey(null);
    setNewKey("");
    setNewValue("");
  };

  return (
    <div className="kv-builder">
      {pairs.length === 0 && !isAdding && (
        <div className="kv-empty">No entries</div>
      )}
      {pairs.map(([k, v]) =>
        editingKey === k ? (
          <div key={k} className="kv-form">
            <div className="kv-form-row">
              <div className="kv-form-field">
                <span className="kv-form-label">{keyLabel}</span>
                <input
                  className="kv-input"
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value)}
                  placeholder={keyPlaceholder}
                  autoFocus
                />
              </div>
              <div className="kv-form-field">
                <span className="kv-form-label">{valueLabel}</span>
                <input
                  className="kv-input"
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                  placeholder={valuePlaceholder}
                  onKeyDown={(e) => { if (e.key === "Enter") handleEdit(); }}
                />
              </div>
            </div>
            <div className="kv-form-actions">
              <button className="kv-btn-add" onClick={handleEdit}>Save</button>
              <button className="kv-btn-cancel" onClick={cancelEditing}>Cancel</button>
            </div>
          </div>
        ) : (
          <div key={k} className="kv-row">
            <div
              className="kv-row-content kv-row-clickable"
              onClick={() => startEditing(k, v)}
              title="Click to edit"
            >
              <span className="kv-key">{k}</span>
              <span className="kv-sep">=</span>
              <span className="kv-value">{v || '""'}</span>
            </div>
            <div className="kv-row-actions">
              <button
                className="kv-edit"
                onClick={() => startEditing(k, v)}
                title="Edit"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /><path d="m15 5 4 4" />
                </svg>
              </button>
              <button
                className="kv-delete"
                onClick={() => handleDelete(k)}
                title="Remove"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6 6 18" /><path d="m6 6 12 12" />
                </svg>
              </button>
            </div>
          </div>
        )
      )}

      {isAdding ? (
        <div className="kv-form">
          <div className="kv-form-row">
            <div className="kv-form-field">
              <span className="kv-form-label">{keyLabel}</span>
              <input
                className="kv-input"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                placeholder={keyPlaceholder}
                autoFocus
              />
            </div>
            <div className="kv-form-field">
              <span className="kv-form-label">{valueLabel}</span>
              <input
                className="kv-input"
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                placeholder={valuePlaceholder}
                onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
              />
            </div>
          </div>
          <div className="kv-form-actions">
            <button className="kv-btn-add" onClick={handleAdd}>Add</button>
            <button className="kv-btn-cancel" onClick={() => { setIsAdding(false); setNewKey(""); setNewValue(""); }}>Cancel</button>
          </div>
        </div>
      ) : editingKey === null ? (
        <button className="kv-add" onClick={() => setIsAdding(true)}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14" /><path d="M5 12h14" />
          </svg>
          {addLabel}
        </button>
      ) : null}
    </div>
  );
}
