import { useState, useEffect, useMemo, type KeyboardEvent } from "react";
import { type ToolPreset, type ModelId, type LLMProvider, TOOL_PRESET_LABELS, TOOL_PRESET_DESCRIPTIONS, MODEL_INFO } from "../../../lib/flow-types";
import { getSetting } from "../../../lib/store";

interface LLMConfigProps {
  config: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
}

interface OpenRouterModelEntry {
  id: string;
  name: string;
  contextLength: number;
}

const TOKEN_SNAP_POINTS = [512, 1024, 2048, 4096, 8192, 16384, 32000, 64000, 128000];

function formatTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}K` : String(n);
}

// Cache model list in memory across re-renders
let orModelCache: { models: OpenRouterModelEntry[]; fetchedAt: number } | null = null;
const OR_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export function LLMConfig({ config, onChange }: LLMConfigProps) {
  const tools = (config.tools as string[]) ?? [];
  const toolPreset = (config.toolPreset as ToolPreset) ?? "read-only";
  const cwd = (config.cwd as string) ?? "";
  const [toolInput, setToolInput] = useState("");
  const model = (config.model as ModelId) ?? "sonnet";
  const provider = (config.provider as LLMProvider) ?? "claude";
  const isClaude = provider === "claude";

  // Token snap points (only for Claude — OpenRouter models have varying limits)
  const modelMax = isClaude ? (MODEL_INFO[model]?.maxOutput ?? 64_000) : 128_000;
  const snapPoints = TOKEN_SNAP_POINTS.filter((p) => p <= modelMax);
  const currentTokens = Number(config.maxTokens ?? 4096);
  const snapIndex = snapPoints.reduce(
    (closest, point, i) =>
      Math.abs(point - currentTokens) < Math.abs(snapPoints[closest] - currentTokens) ? i : closest,
    0,
  );

  // OpenRouter model list state
  const [orModels, setOrModels] = useState<OpenRouterModelEntry[]>(orModelCache?.models ?? []);
  const [orModelSearch, setOrModelSearch] = useState("");
  const [orModelsLoading, setOrModelsLoading] = useState(false);
  const [orFetchError, setOrFetchError] = useState("");

  const fetchModels = async () => {
    // Use cache if fresh
    if (orModelCache && Date.now() - orModelCache.fetchedAt < OR_CACHE_TTL) {
      setOrModels(orModelCache.models);
      return;
    }

    setOrModelsLoading(true);
    setOrFetchError("");
    try {
      const orKey = await getSetting<string>("openrouterApiKey", "");
      if (!orKey) {
        setOrFetchError("No OpenRouter API key configured. Add one in Settings.");
        setOrModelsLoading(false);
        return;
      }
      const resp = await fetch("https://openrouter.ai/api/v1/models", {
        headers: { Authorization: `Bearer ${orKey}` },
      });
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      }
      const data = await resp.json();
      const models = (
        data.data as Array<{
          id: string;
          name: string;
          context_length: number;
          supported_parameters?: string[];
        }>
      )
        .filter((m) => {
          const params = m.supported_parameters ?? [];
          return params.includes("tools") || params.includes("functions");
        })
        .map((m) => ({ id: m.id, name: m.name, contextLength: m.context_length }))
        .sort((a, b) => a.name.localeCompare(b.name));
      setOrModels(models);
      orModelCache = { models, fetchedAt: Date.now() };
    } catch (err) {
      setOrFetchError(err instanceof Error ? err.message : String(err));
    }
    setOrModelsLoading(false);
  };

  // Fetch models when switching to OpenRouter
  useEffect(() => {
    if (!isClaude && orModels.length === 0 && !orModelsLoading) {
      fetchModels();
    }
  }, [isClaude]); // eslint-disable-line react-hooks/exhaustive-deps

  const filteredModels = useMemo(
    () =>
      orModels.filter(
        (m) =>
          m.name.toLowerCase().includes(orModelSearch.toLowerCase()) ||
          m.id.toLowerCase().includes(orModelSearch.toLowerCase()),
      ),
    [orModels, orModelSearch],
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
      {/* Provider Toggle */}
      <div className="config-field">
        <label className="config-label">Provider</label>
        <div className="config-model-group">
          <button
            className={`config-model-btn ${isClaude ? "active" : ""}`}
            onClick={() => onChange({ provider: "claude", openrouterModel: undefined })}
          >
            Claude
          </button>
          <button
            className={`config-model-btn ${!isClaude ? "active" : ""}`}
            onClick={() => {
              onChange({ provider: "openrouter" });
              if (orModels.length === 0) fetchModels();
            }}
          >
            OpenRouter
          </button>
        </div>
      </div>

      {/* Model Selection */}
      {isClaude ? (
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
      ) : (
        <div className="config-field">
          <label className="config-label">OpenRouter Model</label>
          <input
            className="config-input"
            placeholder="Search models..."
            value={orModelSearch}
            onChange={(e) => setOrModelSearch(e.target.value)}
          />
          {orFetchError && (
            <span className="config-hint config-hint--warn">{orFetchError}</span>
          )}
          <div className="config-or-model-list">
            {orModelsLoading ? (
              <div className="config-or-model-item" style={{ justifyContent: "center", opacity: 0.6 }}>
                Loading models...
              </div>
            ) : filteredModels.length === 0 ? (
              <div className="config-or-model-item" style={{ justifyContent: "center", opacity: 0.6 }}>
                {orModels.length === 0 ? "No models loaded" : "No matches"}
              </div>
            ) : (
              filteredModels.map((m) => (
                <button
                  key={m.id}
                  className={`config-or-model-item ${config.openrouterModel === m.id ? "active" : ""}`}
                  onClick={() => onChange({ openrouterModel: m.id })}
                >
                  <span className="config-or-model-name">{m.name}</span>
                  <span className="config-or-model-ctx">
                    {m.contextLength >= 1_000_000
                      ? `${(m.contextLength / 1_000_000).toFixed(1)}M`
                      : `${Math.round(m.contextLength / 1000)}K`}
                  </span>
                </button>
              ))
            )}
          </div>
          {typeof config.openrouterModel === "string" && config.openrouterModel && (
            <span className="config-hint">Selected: {config.openrouterModel}</span>
          )}
          <button
            className="config-btn-small"
            onClick={fetchModels}
            style={{ marginTop: 4, fontSize: 11, opacity: 0.7, cursor: "pointer", background: "none", border: "none", color: "var(--text-secondary)", textDecoration: "underline" }}
          >
            Refresh model list
          </button>
        </div>
      )}

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
        <span className="config-hint">
          {isClaude
            ? TOOL_PRESET_DESCRIPTIONS[toolPreset]
            : toolPreset === "none"
              ? "Pure text generation, no tool access"
              : toolPreset === "read-only"
                ? "Can read files (Read, Glob, Grep)"
                : "All tools: Read, Write, Edit, Bash, Glob, Grep"}
        </span>
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
      {/* Claude-only options */}
      {isClaude && (
        <>
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
      )}
    </>
  );
}
