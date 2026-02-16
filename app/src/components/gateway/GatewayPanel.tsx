import { useState, useCallback, useEffect } from "react";
import {
  Radio, Power, PowerOff, Copy, RefreshCw,
  Trash2, ToggleLeft, ToggleRight, Play, ChevronDown, ChevronRight,
  MessageCircle, Bot, Eye, EyeOff, HelpCircle, Filter, Loader,
} from "lucide-react";
import { TunnelSetupWizard } from "./wizards/TunnelSetupWizard";
import { TelegramSetupWizard } from "./wizards/TelegramSetupWizard";
import { DiscordSetupWizard } from "./wizards/DiscordSetupWizard";
import "./GatewayPanel.css";

// ── Types (mirrored from sidecar gateway/types.ts) ───────────────────────────

type ChannelType = "telegram" | "discord";

interface ChannelStatus {
  type: ChannelType;
  state: "stopped" | "connecting" | "connected" | "error";
  botUsername: string | null;
  error: string | null;
}

interface TunnelStatus {
  provider: string;
  state: "stopped" | "starting" | "connected" | "reconnecting" | "error";
  publicUrl: string | null;
  error: string | null;
  uptimeMs: number;
  latencyMs?: number;
}

interface WebhookEndpoint {
  id: string;
  flowId: string;
  flowName: string;
  token: string;
  enabled: boolean;
  createdAt: string;
  lastTriggeredAt: string | null;
}

interface GatewayStatus {
  running: boolean;
  port: number;
  tunnel: TunnelStatus;
  channels: ChannelStatus[];
  webhookCount: number;
}

interface GatewayLogEntry {
  timestamp: string;
  level: "info" | "warn" | "error";
  source: string;
  message: string;
  details?: Record<string, unknown>;
}

interface WebhookTestResult {
  webhookId: string;
  statusCode: number;
  contentType: string;
  body: string;
  headers?: Record<string, string>;
  durationMs: number;
  error?: string;
}

interface WebhookEvent {
  id: string;
  endpointId: string;
  flowId: string;
  timestamp: string;
  method: string;
  statusCode: number;
  durationMs: number;
}

// ── Props ────────────────────────────────────────────────────────────────────

export interface GatewayPanelProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  send: (msg: any) => void;
  isConnected: boolean;
  gatewayStatus: GatewayStatus | null;
  webhooks: WebhookEndpoint[];
  logs: GatewayLogEntry[];
  recentEvents: WebhookEvent[];
  flows: Array<{ id: string; name: string }>;
  channelStatuses?: ChannelStatus[];
  /** Load a full flow definition by ID — used to sync flow data to the sidecar when creating webhooks */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  loadFlowDefinition?: (flowId: string) => Promise<any | null>;
  /** Webhook test result from sidecar */
  testResult?: WebhookTestResult | null;
}

// ── Component ────────────────────────────────────────────────────────────────

export function GatewayPanel({
  send, isConnected, gatewayStatus, webhooks, logs, recentEvents, flows, channelStatuses, loadFlowDefinition, testResult,
}: GatewayPanelProps) {
  const [expandedSection, setExpandedSection] = useState<string>("tunnel");
  const [testPayload, setTestPayload] = useState("{}");
  const [selectedTestWebhook, setSelectedTestWebhook] = useState<string>("");
  const [activeWizard, setActiveWizard] = useState<"tunnel" | "telegram" | "discord" | null>(null);
  const [isTesting, setIsTesting] = useState(false);

  // Log filters
  const [logSourceFilter, setLogSourceFilter] = useState<string>("all");
  const [logLevelFilter, setLogLevelFilter] = useState<string>("all");
  const [expandedLogIndex, setExpandedLogIndex] = useState<number | null>(null);

  // Reset testing state when test result arrives
  useEffect(() => {
    if (testResult && isTesting) setIsTesting(false);
  }, [testResult]); // eslint-disable-line react-hooks/exhaustive-deps

  // Tunnel config state
  const [tunnelProvider, setTunnelProvider] = useState<"ngrok" | "cloudflare" | "custom">("cloudflare");
  const [ngrokToken, setNgrokToken] = useState("");
  const [ngrokDomain, setNgrokDomain] = useState("");
  const [cfToken, setCfToken] = useState("");
  const [customCommand, setCustomCommand] = useState("");
  const [customUrlPattern, setCustomUrlPattern] = useState("");
  const [showTunnelToken, setShowTunnelToken] = useState(false);

  // Channel config state
  const [telegramToken, setTelegramToken] = useState("");
  const [discordToken, setDiscordToken] = useState("");
  const [showTelegramToken, setShowTelegramToken] = useState(false);
  const [showDiscordToken, setShowDiscordToken] = useState(false);

  const gatewaySend = useCallback((action: unknown) => {
    send({ type: "gateway", action });
  }, [send]);

  const toggleSection = (section: string) => {
    setExpandedSection(expandedSection === section ? "" : section);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const tunnelStatus = gatewayStatus?.tunnel;
  const isRunning = gatewayStatus?.running ?? false;

  // Merge channel statuses from props or gateway status
  const channels: ChannelStatus[] = channelStatuses ?? (gatewayStatus?.channels as ChannelStatus[] ?? []);
  const getChannelStatus = (type: ChannelType): ChannelStatus | undefined =>
    channels.find(ch => ch.type === type);

  const handleChannelStart = useCallback((type: ChannelType, token: string) => {
    // Configure then start
    gatewaySend({
      type: "channel_configure",
      config: { type, enabled: true, botToken: token },
    });
    // Small delay to let config propagate, then start
    setTimeout(() => {
      gatewaySend({ type: "channel_start", channelType: type });
    }, 100);
  }, [gatewaySend]);

  const handleChannelStop = useCallback((type: ChannelType) => {
    gatewaySend({ type: "channel_stop", channelType: type });
  }, [gatewaySend]);

  const handleTunnelStart = useCallback(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const config: any = {
      provider: tunnelProvider,
      autoStart: false,
    };
    if (tunnelProvider === "ngrok") {
      config.ngrok = { authToken: ngrokToken, domain: ngrokDomain || undefined };
    } else if (tunnelProvider === "cloudflare") {
      config.cloudflare = { token: cfToken || undefined };
    } else if (tunnelProvider === "custom") {
      config.custom = { startCommand: customCommand, urlPattern: customUrlPattern || undefined };
    }
    gatewaySend({ type: "tunnel_start", config });
  }, [gatewaySend, tunnelProvider, ngrokToken, ngrokDomain, cfToken, customCommand, customUrlPattern]);

  const formatUptime = (ms: number): string => {
    if (ms < 60_000) return `${Math.floor(ms / 1000)}s`;
    if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
    return `${Math.floor(ms / 3_600_000)}h ${Math.floor((ms % 3_600_000) / 60_000)}m`;
  };

  const getStatusColor = (state: string): string => {
    switch (state) {
      case "connected": return "var(--accent-green)";
      case "starting":
      case "reconnecting": return "var(--accent-yellow, #eab308)";
      case "error": return "var(--accent-red)";
      default: return "var(--text-muted)";
    }
  };

  return (
    <div className="gateway-panel">
      <div className="gateway-header">
        <div className="gateway-title">
          <Radio size={16} />
          <span>Gateway</span>
        </div>
        <div className="gateway-controls">
          {isRunning ? (
            <button
              className="gateway-btn danger"
              onClick={() => gatewaySend({ type: "gateway_stop" })}
              title="Stop Gateway"
            >
              <PowerOff size={14} />
              <span>Stop</span>
            </button>
          ) : (
            <button
              className="gateway-btn primary"
              onClick={() => gatewaySend({ type: "gateway_start" })}
              disabled={!isConnected}
              title="Start Gateway"
            >
              <Power size={14} />
              <span>Start</span>
            </button>
          )}
        </div>
      </div>

      {/* ── Tunnel Section ─────────────────────────────────────── */}
      <div className="gateway-section">
        <button className="section-header" onClick={() => toggleSection("tunnel")}>
          {expandedSection === "tunnel" ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span>Tunnel</span>
          {tunnelStatus && (
            <span
              className="status-dot"
              style={{ backgroundColor: getStatusColor(tunnelStatus.state) }}
              title={tunnelStatus.state}
            />
          )}
        </button>
        {expandedSection === "tunnel" && (
          <div className="section-content">
            {tunnelStatus?.state === "connected" && tunnelStatus.publicUrl ? (
              <div className="tunnel-info">
                <div className="info-row">
                  <span className="info-label">URL</span>
                  <div className="info-value url-value">
                    <code>{tunnelStatus.publicUrl}</code>
                    <button
                      className="icon-btn"
                      onClick={() => copyToClipboard(tunnelStatus.publicUrl!)}
                      title="Copy URL"
                    >
                      <Copy size={12} />
                    </button>
                  </div>
                </div>
                <div className="info-row">
                  <span className="info-label">Provider</span>
                  <span className="info-value">{tunnelStatus.provider}</span>
                </div>
                <div className="info-row">
                  <span className="info-label">Uptime</span>
                  <span className="info-value">{formatUptime(tunnelStatus.uptimeMs)}</span>
                </div>
                {tunnelStatus.latencyMs != null && (
                  <div className="info-row">
                    <span className="info-label">Latency</span>
                    <span className="info-value" style={{
                      color: tunnelStatus.latencyMs < 200 ? "var(--accent-green)" :
                             tunnelStatus.latencyMs < 500 ? "var(--accent-yellow, #eab308)" :
                             "var(--accent-red)",
                    }}>
                      {tunnelStatus.latencyMs}ms
                    </span>
                  </div>
                )}
                <button
                  className="gateway-btn danger small"
                  onClick={() => gatewaySend({ type: "tunnel_stop" })}
                >
                  <PowerOff size={12} />
                  <span>Stop Tunnel</span>
                </button>
              </div>
            ) : tunnelStatus?.state === "starting" || tunnelStatus?.state === "reconnecting" ? (
              <div className="tunnel-info">
                <div className="info-row">
                  <RefreshCw size={14} className="spin" />
                  <span>{tunnelStatus.state === "starting" ? "Starting tunnel..." : "Reconnecting..."}</span>
                </div>
              </div>
            ) : tunnelStatus?.state === "error" ? (
              <div className="tunnel-info">
                <div className="info-row error-text">
                  <span>{tunnelStatus.error ?? "Unknown error"}</span>
                </div>
              </div>
            ) : null}

            {/* Tunnel config form — show when stopped or error */}
            {(!tunnelStatus || tunnelStatus.state === "stopped" || tunnelStatus.state === "error") && (
              <div className="tunnel-config">
                <button
                  className="gateway-btn small"
                  onClick={() => setActiveWizard("tunnel")}
                  style={{ alignSelf: "flex-start", marginBottom: 4 }}
                  title="Step-by-step setup guide"
                >
                  <HelpCircle size={12} />
                  <span>Setup Guide</span>
                </button>
                <div className="tunnel-provider-select">
                  <span className="info-label">Provider</span>
                  <div className="provider-tabs">
                    {(["cloudflare", "ngrok", "custom"] as const).map((p) => (
                      <button
                        key={p}
                        className={`provider-tab ${tunnelProvider === p ? "active" : ""}`}
                        onClick={() => setTunnelProvider(p)}
                      >
                        {p === "cloudflare" ? "Cloudflare" : p === "ngrok" ? "ngrok" : "Custom"}
                      </button>
                    ))}
                  </div>
                </div>

                {tunnelProvider === "ngrok" && (
                  <div className="tunnel-provider-config">
                    <div className="token-input-row">
                      <input
                        type={showTunnelToken ? "text" : "password"}
                        className="gateway-input"
                        placeholder="ngrok auth token (required)"
                        value={ngrokToken}
                        onChange={(e) => setNgrokToken(e.target.value)}
                      />
                      <button
                        className="icon-btn"
                        onClick={() => setShowTunnelToken(!showTunnelToken)}
                        title={showTunnelToken ? "Hide" : "Show"}
                      >
                        {showTunnelToken ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                    <input
                      type="text"
                      className="gateway-input"
                      placeholder="Custom domain (optional)"
                      value={ngrokDomain}
                      onChange={(e) => setNgrokDomain(e.target.value)}
                    />
                  </div>
                )}

                {tunnelProvider === "cloudflare" && (
                  <div className="tunnel-provider-config">
                    <div className="token-input-row">
                      <input
                        type={showTunnelToken ? "text" : "password"}
                        className="gateway-input"
                        placeholder="Cloudflare tunnel token (optional for quick tunnel)"
                        value={cfToken}
                        onChange={(e) => setCfToken(e.target.value)}
                      />
                      <button
                        className="icon-btn"
                        onClick={() => setShowTunnelToken(!showTunnelToken)}
                        title={showTunnelToken ? "Hide" : "Show"}
                      >
                        {showTunnelToken ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                    <p className="muted-text">Leave empty for a free quick tunnel (temporary URL). Add a token for a persistent named tunnel.</p>
                  </div>
                )}

                {tunnelProvider === "custom" && (
                  <div className="tunnel-provider-config">
                    <input
                      type="text"
                      className="gateway-input"
                      placeholder="Command: bore local {port} --to bore.pub"
                      value={customCommand}
                      onChange={(e) => setCustomCommand(e.target.value)}
                    />
                    <input
                      type="text"
                      className="gateway-input"
                      placeholder="URL regex pattern (optional)"
                      value={customUrlPattern}
                      onChange={(e) => setCustomUrlPattern(e.target.value)}
                    />
                    <p className="muted-text">Use {"{host}"} and {"{port}"} placeholders. URL is extracted from stdout/stderr.</p>
                  </div>
                )}

                <button
                  className="gateway-btn primary small"
                  disabled={
                    !isConnected ||
                    (tunnelProvider === "ngrok" && !ngrokToken.trim()) ||
                    (tunnelProvider === "custom" && !customCommand.trim())
                  }
                  onClick={handleTunnelStart}
                >
                  <Power size={12} />
                  <span>Start Tunnel</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Channels Section ──────────────────────────────────── */}
      <div className="gateway-section">
        <button className="section-header" onClick={() => toggleSection("channels")}>
          {expandedSection === "channels" ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span>Channels</span>
          {channels.length > 0 && (
            <span className="section-count">{channels.filter(c => c.state === "connected").length}/{channels.length}</span>
          )}
        </button>
        {expandedSection === "channels" && (
          <div className="section-content">
            {/* ── Telegram ── */}
            <div className="channel-item">
              <div className="channel-header">
                <MessageCircle size={14} />
                <span className="channel-name">Telegram</span>
                <button
                  className="icon-btn"
                  onClick={() => setActiveWizard("telegram")}
                  title="Setup Guide"
                >
                  <HelpCircle size={14} />
                </button>
                {(() => {
                  const st = getChannelStatus("telegram");
                  if (st) {
                    return (
                      <span
                        className="status-dot"
                        style={{ backgroundColor: getStatusColor(st.state) }}
                        title={st.state}
                      />
                    );
                  }
                  return null;
                })()}
              </div>
              {(() => {
                const st = getChannelStatus("telegram");
                if (st?.state === "connected") {
                  return (
                    <div className="channel-connected">
                      <span className="channel-bot-name">@{st.botUsername}</span>
                      <button
                        className="gateway-btn danger small"
                        onClick={() => handleChannelStop("telegram")}
                      >
                        <PowerOff size={12} />
                        <span>Disconnect</span>
                      </button>
                    </div>
                  );
                }
                if (st?.state === "connecting") {
                  return (
                    <div className="channel-connecting">
                      <RefreshCw size={14} className="spin" />
                      <span>Connecting...</span>
                    </div>
                  );
                }
                if (st?.state === "error") {
                  return (
                    <div className="channel-error">
                      <span className="error-text">{st.error}</span>
                    </div>
                  );
                }
                return null;
              })()}
              {(!getChannelStatus("telegram") || getChannelStatus("telegram")?.state === "stopped" || getChannelStatus("telegram")?.state === "error") && (
                <div className="channel-config">
                  <div className="token-input-row">
                    <input
                      type={showTelegramToken ? "text" : "password"}
                      className="gateway-input"
                      placeholder="Bot token from @BotFather"
                      value={telegramToken}
                      onChange={(e) => setTelegramToken(e.target.value)}
                    />
                    <button
                      className="icon-btn"
                      onClick={() => setShowTelegramToken(!showTelegramToken)}
                      title={showTelegramToken ? "Hide token" : "Show token"}
                    >
                      {showTelegramToken ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                  <button
                    className="gateway-btn primary small"
                    disabled={!telegramToken.trim() || !isConnected}
                    onClick={() => handleChannelStart("telegram", telegramToken.trim())}
                  >
                    <Power size={12} />
                    <span>Connect</span>
                  </button>
                </div>
              )}
            </div>

            {/* ── Discord ── */}
            <div className="channel-item">
              <div className="channel-header">
                <Bot size={14} />
                <span className="channel-name">Discord</span>
                <button
                  className="icon-btn"
                  onClick={() => setActiveWizard("discord")}
                  title="Setup Guide"
                >
                  <HelpCircle size={14} />
                </button>
                {(() => {
                  const st = getChannelStatus("discord");
                  if (st) {
                    return (
                      <span
                        className="status-dot"
                        style={{ backgroundColor: getStatusColor(st.state) }}
                        title={st.state}
                      />
                    );
                  }
                  return null;
                })()}
              </div>
              {(() => {
                const st = getChannelStatus("discord");
                if (st?.state === "connected") {
                  return (
                    <div className="channel-connected">
                      <span className="channel-bot-name">{st.botUsername}</span>
                      <button
                        className="gateway-btn danger small"
                        onClick={() => handleChannelStop("discord")}
                      >
                        <PowerOff size={12} />
                        <span>Disconnect</span>
                      </button>
                    </div>
                  );
                }
                if (st?.state === "connecting") {
                  return (
                    <div className="channel-connecting">
                      <RefreshCw size={14} className="spin" />
                      <span>Connecting...</span>
                    </div>
                  );
                }
                if (st?.state === "error") {
                  return (
                    <div className="channel-error">
                      <span className="error-text">{st.error}</span>
                    </div>
                  );
                }
                return null;
              })()}
              {(!getChannelStatus("discord") || getChannelStatus("discord")?.state === "stopped" || getChannelStatus("discord")?.state === "error") && (
                <div className="channel-config">
                  <div className="token-input-row">
                    <input
                      type={showDiscordToken ? "text" : "password"}
                      className="gateway-input"
                      placeholder="Discord bot token"
                      value={discordToken}
                      onChange={(e) => setDiscordToken(e.target.value)}
                    />
                    <button
                      className="icon-btn"
                      onClick={() => setShowDiscordToken(!showDiscordToken)}
                      title={showDiscordToken ? "Hide token" : "Show token"}
                    >
                      {showDiscordToken ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                  <button
                    className="gateway-btn primary small"
                    disabled={!discordToken.trim() || !isConnected}
                    onClick={() => handleChannelStart("discord", discordToken.trim())}
                  >
                    <Power size={12} />
                    <span>Connect</span>
                  </button>
                </div>
              )}
            </div>

            <p className="muted-text" style={{ marginTop: 8 }}>
              Connect chat bots so users can invoke flows via Telegram or Discord using /run, /list, /status commands.
            </p>
          </div>
        )}
      </div>

      {/* ── Webhooks Section ──────────────────────────────────── */}
      <div className="gateway-section">
        <button className="section-header" onClick={() => toggleSection("webhooks")}>
          {expandedSection === "webhooks" ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span>Webhooks</span>
          <span className="section-count">{webhooks.length}</span>
        </button>
        {expandedSection === "webhooks" && (
          <div className="section-content">
            <div className="webhook-actions">
              <select
                className="gateway-select"
                onChange={async (e) => {
                  if (e.target.value) {
                    const flow = flows.find(f => f.id === e.target.value);
                    if (flow) {
                      // Load the full flow definition and include it for sidecar caching
                      const fullFlow = loadFlowDefinition ? await loadFlowDefinition(flow.id) : null;
                      gatewaySend({ type: "webhook_create", flowId: flow.id, flowName: flow.name, flow: fullFlow ?? undefined });
                    }
                    e.target.value = "";
                  }
                }}
                defaultValue=""
              >
                <option value="" disabled>Create webhook for flow...</option>
                {flows.map(f => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
            </div>

            {webhooks.length === 0 ? (
              <p className="muted-text">No webhooks configured. Create one to expose a flow endpoint.</p>
            ) : (
              <div className="webhook-list">
                {webhooks.map(wh => {
                  const webhookUrl = tunnelStatus?.publicUrl
                    ? `${tunnelStatus.publicUrl}/webhooks/${wh.flowId}/${wh.token}`
                    : `http://127.0.0.1:${gatewayStatus?.port ?? 9400}/webhooks/${wh.flowId}/${wh.token}`;

                  return (
                    <div key={wh.id} className={`webhook-item ${wh.enabled ? "" : "disabled"}`}>
                      <div className="webhook-header">
                        <span className="webhook-name">{wh.flowName}</span>
                        <div className="webhook-controls">
                          <button
                            className="icon-btn"
                            onClick={() => gatewaySend({ type: "webhook_toggle", id: wh.id, enabled: !wh.enabled })}
                            title={wh.enabled ? "Disable" : "Enable"}
                          >
                            {wh.enabled ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
                          </button>
                          <button
                            className="icon-btn"
                            onClick={() => gatewaySend({ type: "webhook_regenerate_token", id: wh.id })}
                            title="Regenerate token"
                          >
                            <RefreshCw size={12} />
                          </button>
                          <button
                            className="icon-btn danger"
                            onClick={() => gatewaySend({ type: "webhook_delete", id: wh.id })}
                            title="Delete webhook"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                      <div className="webhook-url">
                        <code>{webhookUrl}</code>
                        <button
                          className="icon-btn"
                          onClick={() => copyToClipboard(webhookUrl)}
                          title="Copy URL"
                        >
                          <Copy size={12} />
                        </button>
                      </div>
                      {wh.lastTriggeredAt && (
                        <div className="webhook-meta">
                          Last triggered: {new Date(wh.lastTriggeredAt).toLocaleString()}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Testing Section ───────────────────────────────────── */}
      <div className="gateway-section">
        <button className="section-header" onClick={() => toggleSection("testing")}>
          {expandedSection === "testing" ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span>Test Webhook</span>
        </button>
        {expandedSection === "testing" && (
          <div className="section-content">
            <select
              className="gateway-select"
              value={selectedTestWebhook}
              onChange={(e) => setSelectedTestWebhook(e.target.value)}
            >
              <option value="">Select webhook...</option>
              {webhooks.filter(wh => wh.enabled).map(wh => (
                <option key={wh.id} value={wh.id}>{wh.flowName}</option>
              ))}
            </select>
            <textarea
              className="gateway-textarea"
              value={testPayload}
              onChange={(e) => setTestPayload(e.target.value)}
              placeholder='{"key": "value"}'
              rows={4}
            />
            <button
              className="gateway-btn primary small"
              disabled={!selectedTestWebhook || isTesting}
              onClick={() => {
                try {
                  const payload = JSON.parse(testPayload);
                  setIsTesting(true);
                  gatewaySend({ type: "webhook_test", id: selectedTestWebhook, payload });
                } catch {
                  // Invalid JSON — ignore
                }
              }}
            >
              {isTesting ? <Loader size={12} className="spin" /> : <Play size={12} />}
              <span>{isTesting ? "Running..." : "Send Test"}</span>
            </button>

            {/* ── Response Viewer ── */}
            {testResult && testResult.webhookId === selectedTestWebhook && (
              <div className="test-response">
                <div className="test-response-header">
                  <span className={`event-status ${testResult.statusCode < 400 ? "success" : "error"}`}>
                    {testResult.statusCode}
                  </span>
                  <span className="test-response-content-type">{testResult.contentType}</span>
                  <span className="test-response-duration">{testResult.durationMs}ms</span>
                </div>
                {testResult.error && (
                  <div className="test-response-error">{testResult.error}</div>
                )}
                <pre className="test-response-body">{testResult.body}</pre>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Recent Events Section ─────────────────────────────── */}
      <div className="gateway-section">
        <button className="section-header" onClick={() => toggleSection("events")}>
          {expandedSection === "events" ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span>Recent Events</span>
          <span className="section-count">{recentEvents.length}</span>
        </button>
        {expandedSection === "events" && (
          <div className="section-content">
            {recentEvents.length === 0 ? (
              <p className="muted-text">No recent webhook events.</p>
            ) : (
              <div className="event-list">
                {recentEvents.slice(0, 20).map(evt => (
                  <div key={evt.id} className="event-item">
                    <span className={`event-status ${evt.statusCode < 400 ? "success" : "error"}`}>
                      {evt.statusCode}
                    </span>
                    <span className="event-flow">{evt.flowId.slice(0, 8)}</span>
                    <span className="event-time">
                      {new Date(evt.timestamp).toLocaleTimeString()}
                    </span>
                    <span className="event-duration">{evt.durationMs}ms</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Logs Section ──────────────────────────────────────── */}
      <div className="gateway-section logs-section">
        <button className="section-header" onClick={() => toggleSection("logs")}>
          {expandedSection === "logs" ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span>Logs</span>
        </button>
        {expandedSection === "logs" && (
          <div className="section-content logs-content">
            <div className="log-filters">
              <Filter size={12} />
              <select
                className="log-filter-select"
                value={logSourceFilter}
                onChange={(e) => setLogSourceFilter(e.target.value)}
              >
                <option value="all">All sources</option>
                <option value="tunnel">Tunnel</option>
                <option value="webhook">Webhook</option>
                <option value="channel">Channel</option>
                <option value="gateway">Gateway</option>
              </select>
              <select
                className="log-filter-select"
                value={logLevelFilter}
                onChange={(e) => setLogLevelFilter(e.target.value)}
              >
                <option value="all">All levels</option>
                <option value="info">Info</option>
                <option value="warn">Warn</option>
                <option value="error">Error</option>
              </select>
            </div>
            {(() => {
              const filteredLogs = logs
                .filter(log =>
                  (logSourceFilter === "all" || log.source === logSourceFilter) &&
                  (logLevelFilter === "all" || log.level === logLevelFilter)
                )
                .slice(-50)
                .reverse();

              return filteredLogs.length === 0 ? (
                <p className="muted-text">No matching logs.</p>
              ) : (
                <div className="log-list">
                  {filteredLogs.map((log, i) => (
                    <div
                      key={i}
                      className={`log-entry ${log.level} ${log.details ? "expandable" : ""} ${expandedLogIndex === i ? "expanded" : ""}`}
                      onClick={() => log.details && setExpandedLogIndex(expandedLogIndex === i ? null : i)}
                    >
                      <span className="log-time">
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </span>
                      <span className="log-source">[{log.source}]</span>
                      <span className="log-message">{log.message}</span>
                      {log.details && (
                        <span className="log-expand-icon">
                          {expandedLogIndex === i ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                        </span>
                      )}
                      {expandedLogIndex === i && log.details && (
                        <pre className="log-details">{JSON.stringify(log.details, null, 2)}</pre>
                      )}
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        )}
      </div>

      {/* ── Setup Wizards ──────────────────────────────────────── */}
      {activeWizard === "tunnel" && (
        <TunnelSetupWizard
          onClose={() => setActiveWizard(null)}
          gatewaySend={gatewaySend}
          tunnelStatus={tunnelStatus}
          isConnected={isConnected}
        />
      )}
      {activeWizard === "telegram" && (
        <TelegramSetupWizard
          onClose={() => setActiveWizard(null)}
          gatewaySend={gatewaySend}
          tunnelStatus={tunnelStatus}
          channelStatus={getChannelStatus("telegram")}
          isConnected={isConnected}
          onOpenTunnelWizard={() => setActiveWizard("tunnel")}
        />
      )}
      {activeWizard === "discord" && (
        <DiscordSetupWizard
          onClose={() => setActiveWizard(null)}
          gatewaySend={gatewaySend}
          channelStatus={getChannelStatus("discord")}
          isConnected={isConnected}
        />
      )}
    </div>
  );
}
