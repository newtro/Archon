import { useState, useEffect } from "react";
import { KeyRound, Eye, EyeOff, Cpu, Info, FolderOpen, GitBranch, ExternalLink } from "lucide-react";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
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
  const [githubToken, setGithubToken] = useState("");
  const [githubMasked, setGithubMasked] = useState(true);
  const [githubSaveStatus, setGithubSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [repoOwner, setRepoOwner] = useState("newtro");
  const [repoName, setRepoName] = useState("Archon-Community");

  useEffect(() => {
    async function loadSettings() {
      const storedKey = await getSetting<string>("apiKey", "");
      const storedModel = await getSetting<string>("model", "sonnet");
      const storedAutoContext = await getSetting<boolean>("autoProjectContext", true);
      const storedGithubToken = await getSetting<string>("githubToken", "");
      const storedRepoOwner = await getSetting<string>("communityRepoOwner", "newtro");
      const storedRepoName = await getSetting<string>("communityRepoName", "Archon-Community");
      if (storedKey) {
        setApiKey(storedKey);
        onApiKeyChange(storedKey);
      }
      setModel(storedModel);
      setAutoProjectContext(storedAutoContext);
      if (storedGithubToken) setGithubToken(storedGithubToken);
      setRepoOwner(storedRepoOwner);
      setRepoName(storedRepoName);
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

  const handleSaveGithubToken = async () => {
    setGithubSaveStatus("saving");
    await setSetting("githubToken", githubToken);
    setGithubSaveStatus("saved");
    setTimeout(() => setGithubSaveStatus("idle"), 2000);
  };

  const handleSaveRepoConfig = async () => {
    await setSetting("communityRepoOwner", repoOwner);
    await setSetting("communityRepoName", repoName);
  };

  const maskedGithubToken = githubToken
    ? githubToken.slice(0, 7) + "..." + githubToken.slice(-4)
    : "";

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
            <GitBranch size={16} />
            GitHub Integration
          </h3>
          <p className="settings-description">
            Connect your GitHub account to publish flows to the community registry.
            Requires a Personal Access Token with <code>public_repo</code> scope.
            {" "}
            <button
              className="settings-link"
              onClick={() => shellOpen("https://github.com/settings/tokens")}
            >
              Create a token <ExternalLink size={10} />
            </button>
          </p>
          <div className="settings-field">
            <div className="api-key-input-group">
              <input
                type={githubMasked ? "password" : "text"}
                className="settings-input"
                placeholder="ghp_..."
                value={githubMasked ? maskedGithubToken : githubToken}
                onChange={(e) => {
                  if (!githubMasked) {
                    setGithubToken(e.target.value);
                    setGithubSaveStatus("idle");
                  }
                }}
                onFocus={() => {
                  if (githubMasked) setGithubMasked(false);
                }}
              />
              <button
                className="settings-btn-icon"
                onClick={() => setGithubMasked(!githubMasked)}
                title={githubMasked ? "Show token" : "Hide token"}
              >
                {githubMasked ? <Eye size={16} /> : <EyeOff size={16} />}
              </button>
            </div>
            <button
              className="settings-btn-primary"
              onClick={handleSaveGithubToken}
              disabled={!githubToken || githubSaveStatus === "saving"}
            >
              {githubSaveStatus === "saving"
                ? "Saving..."
                : githubSaveStatus === "saved"
                  ? "Saved"
                  : "Save Token"}
            </button>
          </div>
          <div className="settings-field" style={{ marginTop: 12 }}>
            <label className="settings-label">Community Repository</label>
            <div className="repo-config-group">
              <input
                className="settings-input"
                placeholder="Owner"
                value={repoOwner}
                onChange={(e) => setRepoOwner(e.target.value)}
                onBlur={handleSaveRepoConfig}
              />
              <span className="repo-separator">/</span>
              <input
                className="settings-input"
                placeholder="Repository"
                value={repoName}
                onChange={(e) => setRepoName(e.target.value)}
                onBlur={handleSaveRepoConfig}
              />
            </div>
            <p className="settings-hint">
              The GitHub repository used for browsing and publishing community flows.
            </p>
          </div>
        </section>

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
