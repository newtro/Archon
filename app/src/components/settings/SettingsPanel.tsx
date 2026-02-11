import { useState, useEffect } from "react";
import { KeyRound, Eye, EyeOff, Cpu, Info, FolderOpen } from "lucide-react";
import { getSetting, setSetting } from "../../lib/store";
import { McpConfigSection } from "./McpConfigSection";
import "./SettingsPanel.css";

interface SettingsPanelProps {
  onApiKeyChange: (key: string) => void;
  onModelChange?: (model: string) => void;
}

export function SettingsPanel({ onApiKeyChange, onModelChange }: SettingsPanelProps) {
  const [apiKey, setApiKey] = useState("");
  const [isMasked, setIsMasked] = useState(true);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [model, setModel] = useState("sonnet");
  const [autoProjectContext, setAutoProjectContext] = useState(true);

  useEffect(() => {
    async function loadSettings() {
      const storedKey = await getSetting<string>("apiKey", "");
      const storedModel = await getSetting<string>("model", "sonnet");
      const storedAutoContext = await getSetting<boolean>("autoProjectContext", true);
      if (storedKey) {
        setApiKey(storedKey);
        onApiKeyChange(storedKey);
      }
      setModel(storedModel);
      setAutoProjectContext(storedAutoContext);
    }
    loadSettings();
  }, [onApiKeyChange]);

  const handleSaveApiKey = async () => {
    setSaveStatus("saving");
    await setSetting("apiKey", apiKey);
    onApiKeyChange(apiKey);
    setSaveStatus("saved");
    setTimeout(() => setSaveStatus("idle"), 2000);
  };

  const handleModelChange = async (newModel: string) => {
    setModel(newModel);
    await setSetting("model", newModel);
    onModelChange?.(newModel);
  };

  const maskedKey = apiKey
    ? apiKey.slice(0, 7) + "..." + apiKey.slice(-4)
    : "";

  return (
    <div className="settings-panel">
      <div className="settings-header">
        <h2 className="settings-title">Settings</h2>
      </div>

      <div className="settings-content">
        <section className="settings-section">
          <h3 className="settings-section-title">
            <KeyRound size={16} />
            API Key
          </h3>
          <p className="settings-description">
            Enter your Anthropic API key. This is stored locally on your machine.
          </p>
          <div className="settings-field">
            <div className="api-key-input-group">
              <input
                type={isMasked ? "password" : "text"}
                className="settings-input"
                placeholder="sk-ant-..."
                value={isMasked ? maskedKey : apiKey}
                onChange={(e) => {
                  if (!isMasked) {
                    setApiKey(e.target.value);
                    setSaveStatus("idle");
                  }
                }}
                onFocus={() => {
                  if (isMasked) {
                    setIsMasked(false);
                  }
                }}
              />
              <button
                className="settings-btn-icon"
                onClick={() => setIsMasked(!isMasked)}
                title={isMasked ? "Show key" : "Hide key"}
              >
                {isMasked ? <Eye size={16} /> : <EyeOff size={16} />}
              </button>
            </div>
            <button
              className="settings-btn-primary"
              onClick={handleSaveApiKey}
              disabled={!apiKey || saveStatus === "saving"}
            >
              {saveStatus === "saving"
                ? "Saving..."
                : saveStatus === "saved"
                  ? "Saved"
                  : "Save Key"}
            </button>
          </div>
        </section>

        <section className="settings-section">
          <h3 className="settings-section-title">
            <Cpu size={16} />
            Model
          </h3>
          <p className="settings-description">
            Select the default model for new conversations.
          </p>
          <div className="settings-field">
            <div className="model-select-group">
              {[
                { id: "haiku", label: "Haiku 4.5", desc: "Fast, lightweight" },
                { id: "sonnet", label: "Sonnet 4.5", desc: "Balanced" },
                { id: "opus", label: "Opus 4.6", desc: "Most capable" },
              ].map((m) => (
                <button
                  key={m.id}
                  className={`model-option ${model === m.id ? "active" : ""}`}
                  onClick={() => handleModelChange(m.id)}
                >
                  <span className="model-option-label">{m.label}</span>
                  <span className="model-option-desc">{m.desc}</span>
                </button>
              ))}
            </div>
          </div>
        </section>

        <McpConfigSection />

        <section className="settings-section">
          <h3 className="settings-section-title">
            <FolderOpen size={16} />
            Project Context
          </h3>
          <p className="settings-description">
            Configure how the AI agent gets awareness of your project files.
          </p>
          <div className="settings-field">
            <label className="settings-checkbox-label">
              <input
                type="checkbox"
                checked={autoProjectContext}
                onChange={async (e) => {
                  const value = e.target.checked;
                  setAutoProjectContext(value);
                  await setSetting("autoProjectContext", value);
                }}
              />
              Auto-include project overview when no context node is present
            </label>
            <p className="settings-hint">
              When enabled, a brief project summary (file tree, detected project type) is
              automatically injected into the agent's context, even if the flow has no
              Project Context node.
            </p>
          </div>
        </section>

        <section className="settings-section">
          <h3 className="settings-section-title">
            <Info size={16} />
            About
          </h3>
          <div className="settings-about">
            <div className="settings-about-row">
              <span className="settings-about-label">Version</span>
              <span className="settings-about-value">0.1.0-alpha</span>
            </div>
            <div className="settings-about-row">
              <span className="settings-about-label">Runtime</span>
              <span className="settings-about-value">Tauri v2 + Node.js Sidecar</span>
            </div>
            <div className="settings-about-row">
              <span className="settings-about-label">SDK</span>
              <span className="settings-about-value">Claude Agent SDK</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
