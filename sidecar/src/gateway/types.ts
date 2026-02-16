/**
 * Gateway type definitions — shared across tunnel, webhook, and channel subsystems.
 */

// ── Tunnel ───────────────────────────────────────────────────────────────────

export type TunnelProviderName = "ngrok" | "cloudflare" | "custom" | "none";

export interface TunnelConfig {
  provider: TunnelProviderName;
  autoStart: boolean;
  ngrok?: {
    authToken: string;
    domain?: string;
  };
  cloudflare?: {
    token: string;
  };
  custom?: {
    startCommand: string;       // e.g. "bore local {port} --to bore.pub"
    urlPattern?: string;        // regex to extract public URL from stdout/stderr
    healthUrl?: string;
  };
}

export interface TunnelStatus {
  provider: TunnelProviderName;
  state: "stopped" | "starting" | "connected" | "reconnecting" | "error";
  publicUrl: string | null;
  error: string | null;
  uptimeMs: number;
  latencyMs?: number;
}

export interface TunnelProvider {
  name: TunnelProviderName;
  start(localHost: string, localPort: number): Promise<string>;
  stop(): Promise<void>;
  healthCheck(): Promise<boolean>;
  publicUrl(): string | null;
}

// ── Webhooks ─────────────────────────────────────────────────────────────────

export interface WebhookEndpoint {
  id: string;
  flowId: string;
  flowName: string;
  token: string;
  enabled: boolean;
  createdAt: string;
  lastTriggeredAt: string | null;
}

export interface WebhookEvent {
  id: string;
  endpointId: string;
  flowId: string;
  timestamp: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
  statusCode: number;
  durationMs: number;
}

// ── Channels ─────────────────────────────────────────────────────────────────

export type ChannelType = "telegram" | "discord";

export interface ChannelConfig {
  type: ChannelType;
  enabled: boolean;
  botToken: string;
  defaultFlowId?: string;
}

export interface ChannelStatus {
  type: ChannelType;
  state: "stopped" | "connecting" | "connected" | "error";
  botUsername: string | null;
  error: string | null;
}

export interface InboundMessage {
  channelType: ChannelType | "webhook";
  channelId: string;
  senderId: string;
  senderName: string;
  text: string;
  metadata: Record<string, unknown>;
  replyTo?: (text: string) => Promise<void>;
}

// ── Gateway ──────────────────────────────────────────────────────────────────

export interface GatewayConfig {
  port: number;
  tunnel: TunnelConfig;
  channels: ChannelConfig[];
  webhooks: WebhookEndpoint[];
}

export interface GatewayStatus {
  running: boolean;
  port: number;
  tunnel: TunnelStatus;
  channels: ChannelStatus[];
  webhookCount: number;
}

// ── Webhook flow execution result ─────────────────────────────────────────────

/** Result from a webhook-response node in a flow, used to construct the HTTP reply */
export interface WebhookFlowResult {
  statusCode: number;
  contentType: string;
  body: string;
  headers?: Record<string, string>;
}

// ── Serialized flow definition for caching ────────────────────────────────────

/** Minimal flow definition stored in the gateway's flow cache */
export interface CachedFlowDefinition {
  id: string;
  name: string;
  description: string;
  nodes: Array<{
    id: string;
    kind: string;
    label: string;
    x: number;
    y: number;
    config: { kind: string; config: Record<string, unknown> };
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    sourceHandle: string | null;
    targetHandle: string | null;
    signal: string;
  }>;
  createdAt: number;
  updatedAt: number;
  contextAgentConfig?: {
    enabled: boolean;
    model?: string;
    systemPrompt?: string;
    extendedContext?: boolean;
  };
}

// ── WebSocket messages (sidecar ↔ frontend) ──────────────────────────────────

/** Result from a webhook test execution, sent back to the frontend */
export interface WebhookTestResult {
  webhookId: string;
  statusCode: number;
  contentType: string;
  body: string;
  headers?: Record<string, string>;
  durationMs: number;
  error?: string;
}

export type GatewayMessageToFrontend =
  | { type: "gateway_status"; status: GatewayStatus }
  | { type: "tunnel_status"; status: TunnelStatus }
  | { type: "webhook_triggered"; event: WebhookEvent }
  | { type: "channel_status"; status: ChannelStatus }
  | { type: "gateway_log"; entry: GatewayLogEntry }
  | { type: "webhook_list"; webhooks: WebhookEndpoint[] }
  | { type: "webhook_test_result"; result: WebhookTestResult };

export type GatewayMessageFromFrontend =
  | { type: "gateway_start" }
  | { type: "gateway_stop" }
  | { type: "tunnel_start"; config: TunnelConfig }
  | { type: "tunnel_stop" }
  | { type: "webhook_create"; flowId: string; flowName: string; flow?: CachedFlowDefinition }
  | { type: "webhook_delete"; id: string }
  | { type: "webhook_toggle"; id: string; enabled: boolean }
  | { type: "webhook_regenerate_token"; id: string }
  | { type: "webhook_test"; id: string; payload: unknown }
  | { type: "channel_configure"; config: ChannelConfig }
  | { type: "channel_start"; channelType: ChannelType }
  | { type: "channel_stop"; channelType: ChannelType }
  | { type: "gateway_get_status" }
  | { type: "gateway_sync_flow"; flow: CachedFlowDefinition };

export interface GatewayLogEntry {
  timestamp: string;
  level: "info" | "warn" | "error";
  source: "tunnel" | "webhook" | "channel" | "gateway";
  message: string;
  details?: Record<string, unknown>;
}
