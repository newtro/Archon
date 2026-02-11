import { useState, type KeyboardEvent } from "react";
import type { ProjectContextOutputFormat } from "../../../lib/flow-types";

interface ProjectContextConfigProps {
  config: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
}

const OUTPUT_FORMAT_LABELS: Record<ProjectContextOutputFormat, string> = {
  "tree-and-contents": "Tree + Contents",
  "contents-only": "Contents Only",
  "tree-only": "Tree Only",
};

export function ProjectContextConfig({ config, onChange }: ProjectContextConfigProps) {
  const files = (config.files as string[]) ?? [];
  const includePatterns = (config.includePatterns as string[]) ?? [];
  const excludePatterns = (config.excludePatterns as string[]) ?? [];
  const respectGitignore = (config.respectGitignore as boolean) ?? true;
  const maxTokens = (config.maxTokens as number) ?? 50000;
  const outputFormat = (config.outputFormat as ProjectContextOutputFormat) ?? "tree-and-contents";

  const [fileInput, setFileInput] = useState("");
  const [includeInput, setIncludeInput] = useState("");
  const [excludeInput, setExcludeInput] = useState("");

  // File list helpers
  const addFile = (file: string) => {
    const trimmed = file.trim();
    if (!trimmed || files.includes(trimmed)) return;
    onChange({ files: [...files, trimmed] });
  };
  const removeFile = (file: string) => {
    onChange({ files: files.filter((f) => f !== file) });
  };

  // Include pattern helpers
  const addInclude = (pattern: string) => {
    const trimmed = pattern.trim();
    if (!trimmed || includePatterns.includes(trimmed)) return;
    onChange({ includePatterns: [...includePatterns, trimmed] });
  };
  const removeInclude = (pattern: string) => {
    onChange({ includePatterns: includePatterns.filter((p) => p !== pattern) });
  };

  // Exclude pattern helpers
  const addExclude = (pattern: string) => {
    const trimmed = pattern.trim();
    if (!trimmed || excludePatterns.includes(trimmed)) return;
    onChange({ excludePatterns: [...excludePatterns, trimmed] });
  };
  const removeExclude = (pattern: string) => {
    onChange({ excludePatterns: excludePatterns.filter((p) => p !== pattern) });
  };

  const makeKeyHandler = (
    value: string,
    setter: (v: string) => void,
    adder: (v: string) => void,
  ) => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && value.trim()) {
      e.preventDefault();
      adder(value);
      setter("");
    }
  };

  // Rough token budget usage indicator
  const estimatedUsage = files.length * 500 + includePatterns.length * 2000; // very rough
  const usagePercent = Math.min(100, Math.round((estimatedUsage / maxTokens) * 100));
  const usageColor = usagePercent < 50 ? "#22c55e" : usagePercent < 80 ? "#f59e0b" : "#ef4444";

  return (
    <>
      {/* Explicit Files */}
      <div className="config-field">
        <label className="config-label">Files</label>
        {files.length > 0 && (
          <div className="config-tag-list">
            {files.map((file) => (
              <span key={file} className="config-tag">
                {file.split("/").pop()}
                <button className="config-tag-remove" onClick={() => removeFile(file)}>
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
          value={fileInput}
          onChange={(e) => setFileInput(e.target.value)}
          onKeyDown={makeKeyHandler(fileInput, setFileInput, addFile)}
          placeholder="Add file path and press Enter"
        />
        <span className="config-hint">Relative paths from project root (e.g., src/index.ts)</span>
      </div>

      {/* Include Patterns */}
      <div className="config-field">
        <label className="config-label">Include Patterns</label>
        {includePatterns.length > 0 && (
          <div className="config-tag-list">
            {includePatterns.map((pattern) => (
              <span key={pattern} className="config-tag">
                {pattern}
                <button className="config-tag-remove" onClick={() => removeInclude(pattern)}>
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
          value={includeInput}
          onChange={(e) => setIncludeInput(e.target.value)}
          onKeyDown={makeKeyHandler(includeInput, setIncludeInput, addInclude)}
          placeholder="Add glob pattern and press Enter"
        />
        <span className="config-hint">e.g., **/*.ts, src/**, README.md</span>
      </div>

      {/* Exclude Patterns */}
      <div className="config-field">
        <label className="config-label">Exclude Patterns</label>
        {excludePatterns.length > 0 && (
          <div className="config-tag-list">
            {excludePatterns.map((pattern) => (
              <span key={pattern} className="config-tag">
                {pattern}
                <button className="config-tag-remove" onClick={() => removeExclude(pattern)}>
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
          value={excludeInput}
          onChange={(e) => setExcludeInput(e.target.value)}
          onKeyDown={makeKeyHandler(excludeInput, setExcludeInput, addExclude)}
          placeholder="Add exclude pattern and press Enter"
        />
      </div>

      {/* Token Budget */}
      <div className="config-field">
        <label className="config-label">Token Budget ({maxTokens.toLocaleString()})</label>
        <input
          type="range"
          className="config-range"
          min="5000"
          max="200000"
          step="5000"
          value={maxTokens}
          onChange={(e) => onChange({ maxTokens: parseInt(e.target.value) })}
        />
        <div style={{ marginTop: 4, height: 6, borderRadius: 3, background: "var(--bg-tertiary)", overflow: "hidden" }}>
          <div style={{ width: `${usagePercent}%`, height: "100%", background: usageColor, borderRadius: 3, transition: "width 0.3s" }} />
        </div>
        <span className="config-hint">Estimated context usage (precise count at runtime)</span>
      </div>

      {/* Respect .gitignore */}
      <div className="config-field">
        <label className="config-label">
          <input
            type="checkbox"
            checked={respectGitignore}
            onChange={(e) => onChange({ respectGitignore: e.target.checked })}
          />
          Respect .gitignore patterns
        </label>
      </div>

      {/* Output Format */}
      <div className="config-field">
        <label className="config-label">Output Format</label>
        <div className="config-model-group">
          {(["tree-and-contents", "contents-only", "tree-only"] as ProjectContextOutputFormat[]).map((fmt) => (
            <button
              key={fmt}
              className={`config-model-btn ${outputFormat === fmt ? "active" : ""}`}
              onClick={() => onChange({ outputFormat: fmt })}
            >
              {OUTPUT_FORMAT_LABELS[fmt]}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
