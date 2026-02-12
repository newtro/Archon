import { X } from "lucide-react";
import "./TagFilter.css";

interface TagFilterProps {
  allTags: string[];
  selectedTags: string[];
  onToggleTag: (tag: string) => void;
  onClearAll: () => void;
}

export function TagFilter({ allTags, selectedTags, onToggleTag, onClearAll }: TagFilterProps) {
  if (allTags.length === 0) return null;

  return (
    <div className="tag-filter">
      {selectedTags.length > 0 && (
        <button className="tag-filter-clear" onClick={onClearAll}>
          <X size={10} />
          Clear
        </button>
      )}
      {allTags.map((tag) => (
        <button
          key={tag}
          className={`tag-filter-chip ${selectedTags.includes(tag) ? "active" : ""}`}
          onClick={() => onToggleTag(tag)}
        >
          {tag}
        </button>
      ))}
    </div>
  );
}
