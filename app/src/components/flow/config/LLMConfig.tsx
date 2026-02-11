import { useState, type KeyboardEvent } from "react";
import { type ToolPreset, type ModelId, TOOL_PRESET_LABELS, TOOL_PRESET_DESCRIPTIONS, MODEL_INFO } from "../../../lib/flow-types";

interface LLMConfigProps {
  config: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
}

const TOKEN_SNAP_POINTS = [512, 1024, 2048, 4096, 8192, 16384, 32000, 64000, 128000];

function formatTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}K` : String(n);
}

export function LLMConfig({ config, onChange }: LLMConfigProps) {
  const tools = (config.tools as string[]) ?? [];
  const toolPreset = (config.toolPreset as ToolPreset) ?? "read-only";
  const cwd = (config.cwd as string) ?? "";
  const [toolInput, setToolInput] = useState("");
  const model = (config.model as ModelId) ?? "sonnet";
  const modelMax = MODEL_INFO[model]?.maxOutput ?? 64_000;
  const snapPoints = TOKEN_SNAP_POINTS.filter((p) => p <= modelMax);
  const currentTokens = Number(config.maxTokens ?? 4096);
  const snapIndex = snapPoints.reduce(
    (closest, point, i) =>
      Math.abs(point - currentTokens) < Math.abs(snapPoints[closest] - currentTokens) ? i : closest,
    0,
  );

  const addTool = (tool: string) => {
    const trimmed = tool.trim();
    if (!trimmed || tools.includes(trimmed)) return;
    onChange({ tools: [...tools, trimmed] });
  };

  const removeTool = (tool: string) => {
    onChange({ tools: tools.filter((t) => t !== tool) });
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && toolInput.trim()) {
      e.preventDefault();
      addTool(toolInput);
      setToolInput("");
    }
  };

  return (
    <>
      <div className="config-field">
        <label className="config-label">Model</label>
        <div className="config-model-group">
          {(["haiku", "sonnet", "opus"] as const).map((m) => (
            <button
              key={m}
              className={`config-model-btn ${config.model === m ? "active" : ""}`}
              onClick={() => {
                const newMax = MODEL_INFO[m].maxOutput;
                const patch: Record<string, unknown> = { model: m };
                if (currentTokens > newMax) patch.maxTokens = newMax;
                if (!MODEL_INFO[m].supports1M) patch.extendedContext = false;
                onChange(patch);
              }}
            >
              {MODEL_INFO[m].label}
            </button>
          ))}
        </div>
      </div>
      <div className="config-field">
        <label className="config-label">System Prompt</label>
        <textarea
          className="config-textarea"
          rows={4}
          value={(config.systemPrompt as string) ?? ""}
          onChange={(e) => onChange({ systemPrompt: e.target.value })}
          placeholder="You are a helpful assistant..."
        />
      </div>
      <div className="config-field">
        <label className="config-label">Tool Access</label>
        <div className="config-model-group">
          {(["none", "read-only", "full-access"] as ToolPreset[]).map((preset) => (
            <button
              key={preset}
              className={`config-model-btn ${toolPreset === preset ? "active" : ""}`}
              onClick={() => onChange({ toolPreset: preset })}
              title={TOOL_PRESET_DESCRIPTIONS[preset]}
            >
              {TOOL_PRESET_LABELS[preset]}
            </button>
          ))}
        </div>
        <span className="config-hint">{TOOL_PRESET_DESCRIPTIONS[toolPreset]}</span>
      </div>
      <div className="config-field">
        <label className="config-label">Working Directory</label>
        <input
          className="config-input"
          value={cwd}
          onChange={(e) => onChange({ cwd: e.target.value })}
          placeholder="Uses project root (leave blank for default)"
        />
        {cwd && (
          <button
            className="config-btn-small"
            onClick={() => onChange({ cwd: "" })}
            style={{ marginTop: 4, fontSize: 11, opacity: 0.7, cursor: "pointer", background: "none", border: "none", color: "var(--text-secondary)", textDecoration: "underline" }}
          >
            Reset to project default
          </button>
        )}
      </div>
      <div className="config-field">
        <label className="config-label">Temperature ({String(config.temperature ?? 0.7)})</label>
        <input
          type="range"
          className="config-range"
          min="0"
          max="1"
          step="0.1"
          value={Number(config.temperature ?? 0.7)}
          onChange={(e) => onChange({ temperature: parseFloat(e.target.value) })}
        />
      </div>
      <div className="config-field">
        <label className="config-label">
          Max Tokens: {formatTokens(snapPoints[snapIndex])}
          <span className="config-hint" style={{ marginLeft: "auto" }}>
            max {formatTokens(modelMax)}
          </span>
        </label>
        <input
          type="range"
          className="config-range"
          min="0"
          max={snapPoints.length - 1}
          step="1"
          value={snapIndex}
          onChange={(e) => onChange({ maxTokens: snapPoints[parseInt(e.target.value)] })}
        />
        <div className="config-snap-labels">
          {snapPoints.map((p, i) => (
            <span
              key={p}
              className={`config-snap-label ${i === snapIndex ? "active" : ""}`}
              onClick={() => onChange({ maxTokens: p })}
            >
              {formatTokens(p)}
            </span>
          ))}
        </div>
      </div>
      <div className="config-field">
        <label className="config-label">Additional Tools</label>
        {tools.length > 0 && (
          <div className="config-tag-list">
            {tools.map((tool) => (
              <span key={tool} className="config-tag">
                {tool}
                <button className="config-tag-remove" onClick={() => removeTool(tool)}>
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
          value={toolInput}
          onChange={(e) => setToolInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Add extra tool name and press Enter"
        />
        <span className="config-hint">MCP tools or custom tools beyond the preset</span>
      </div>
      <div className="config-field">
        <label className="config-label">
          <input
            type="checkbox"
            checked={Boolean(config.enableThinking)}
            onChange={(e) => onChange({ enableThinking: e.target.checked })}
          />
          Enable extended thinking
        </label>
      </div>
      {MODEL_INFO[model]?.supports1M && (
        <div className="config-field">
          <label className="config-label">
            <input
              type="checkbox"
              checked={Boolean(config.extendedContext)}
              onChange={(e) => {
                const patch: Record<string, unknown> = { extendedContext: e.target.checked };
                if (!e.target.checked) patch.extendedContext = false;
                onChange(patch);
              }}
            />
            1M context window (beta)
          </label>
          {config.extendedContext ? (
            <span className="config-hint config-hint--warn">
              Requests exceeding 200K input tokens are charged at 2x input / 1.5x output rates
            </span>
          ) : (
            <span className="config-hint">
              Expand context from 200K to 1M tokens ({MODEL_INFO[model].label})
            </span>
          )}
        </div>
      )}
    </>
  );
}
