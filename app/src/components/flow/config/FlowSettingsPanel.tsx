import type { FlowDefinition } from "../../../lib/flow-types";

interface FlowSettingsPanelProps {
  flow: FlowDefinition;
  onChange: (updated: FlowDefinition) => void;
}

export function FlowSettingsPanel({ flow, onChange }: FlowSettingsPanelProps) {
  const ctxCfg = flow.contextAgentConfig ?? {
    enabled: true,
    model: "sonnet" as const,
    extendedContext: true,
  };

  const updateCtx = (patch: Partial<typeof ctxCfg>) => {
    onChange({
      ...flow,
      contextAgentConfig: { ...ctxCfg, ...patch },
      updatedAt: Date.now(),
    });
  };

  return (
    <div className="node-config-panel">
      <div className="node-config-header">
        <div className="node-config-header-row">
          <div
            className="node-config-icon"
            style={{ background: "rgba(6,182,212,0.15)", color: "#06b6d4" }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </div>
          <span className="node-config-title">Flow Settings</span>
        </div>
      </div>

      <div className="node-config-body">
        {/* Context Agent Section */}
        <div className="config-section">
          <label className="config-label">Context Agent</label>
          <p className="config-hint" style={{ marginBottom: 8 }}>
            Multi-turn orchestrator that classifies intent, routes to the right model, and generates curated briefings.
          </p>

          <label className="config-toggle-row" style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", marginBottom: 10 }}>
            <input
              type="checkbox"
              checked={ctxCfg.enabled}
              onChange={(e) => updateCtx({ enabled: e.target.checked })}
            />
            <span className="config-sublabel">Enable Context Agent</span>
          </label>

          {ctxCfg.enabled && (
            <>
              <label className="config-sublabel">Orchestrator Model</label>
              <select
                className="config-select"
                value={ctxCfg.model ?? "sonnet"}
                onChange={(e) => updateCtx({ model: e.target.value as "haiku" | "sonnet" | "opus" })}
              >
                <option value="haiku">Haiku 4.5 (fast, low cost)</option>
                <option value="sonnet">Sonnet 4.5 (recommended)</option>
                <option value="opus">Opus 4.6 (most capable)</option>
              </select>

              <label className="config-toggle-row" style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", marginTop: 10, marginBottom: 10 }}>
                <input
                  type="checkbox"
                  checked={ctxCfg.extendedContext ?? true}
                  onChange={(e) => updateCtx({ extendedContext: e.target.checked })}
                />
                <span className="config-sublabel">Extended Context (1M tokens)</span>
              </label>

              <label className="config-sublabel">System Prompt Override</label>
              <textarea
                className="config-textarea"
                value={ctxCfg.systemPrompt ?? ""}
                onChange={(e) => updateCtx({ systemPrompt: e.target.value })}
                placeholder="Leave empty to use the default Context Agent system prompt"
                rows={4}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
