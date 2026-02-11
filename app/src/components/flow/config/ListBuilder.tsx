import { useState, type ReactNode } from "react";
import "./ListBuilder.css";

interface ListBuilderProps<T> {
  items: T[];
  onChange: (items: T[]) => void;
  renderItem: (item: T, index: number) => ReactNode;
  /** renderForm receives onSubmit, onCancel, and optionally the item being edited */
  renderForm: (onSubmit: (item: T) => void, onCancel: () => void, editingItem?: T) => ReactNode;
  addLabel: string;
  emptyLabel?: string;
  getItemKey: (item: T, index: number) => string;
}

export function ListBuilder<T>({
  items,
  onChange,
  renderItem,
  renderForm,
  addLabel,
  emptyLabel = "None configured",
  getItemKey,
}: ListBuilderProps<T>) {
  const [isAdding, setIsAdding] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  const handleAdd = (item: T) => {
    onChange([...items, item]);
    setIsAdding(false);
  };

  const handleEdit = (item: T) => {
    if (editingIndex === null) return;
    onChange(items.map((existing, i) => (i === editingIndex ? item : existing)));
    setEditingIndex(null);
  };

  const handleDelete = (index: number) => {
    onChange(items.filter((_, i) => i !== index));
    if (editingIndex === index) setEditingIndex(null);
  };

  const startEditing = (index: number) => {
    setIsAdding(false);
    setEditingIndex(index);
  };

  const cancelEditing = () => {
    setEditingIndex(null);
  };

  return (
    <div className="list-builder">
      {items.length === 0 && !isAdding && (
        <div className="list-builder-empty">{emptyLabel}</div>
      )}
      {items.map((item, index) =>
        editingIndex === index ? (
          <div key={getItemKey(item, index)} className="list-builder-form">
            {renderForm(handleEdit, cancelEditing, item)}
          </div>
        ) : (
          <div key={getItemKey(item, index)} className="list-builder-item">
            <div
              className="list-builder-item-content list-builder-item-clickable"
              onClick={() => startEditing(index)}
              title="Click to edit"
            >
              {renderItem(item, index)}
            </div>
            <div className="list-builder-item-actions">
              <button
                className="list-builder-edit"
                onClick={() => startEditing(index)}
                title="Edit"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /><path d="m15 5 4 4" />
                </svg>
              </button>
              <button
                className="list-builder-delete"
                onClick={() => handleDelete(index)}
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
        <div className="list-builder-form">
          {renderForm(handleAdd, () => setIsAdding(false))}
        </div>
      ) : editingIndex === null ? (
        <button className="list-builder-add" onClick={() => setIsAdding(true)}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14" /><path d="M5 12h14" />
          </svg>
          {addLabel}
        </button>
      ) : null}
    </div>
  );
}
