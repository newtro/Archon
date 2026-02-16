/**
 * GatewayManager — top-level orchestrator for the tunnel + webhook + channel subsystem.
 *
 * Manages the HTTP gateway, tunnel, webhook endpoints, and channel adapters.
 * Integrates with the sidecar's WebSocket to communicate with the frontend.
 */

import { WebSocket } from "ws";
import { HttpGateway, type WebhookFlowExecutor } from "./http-gateway.js";
import { MessageBus, type FlowInfo } from "./channels/message-bus.js";
import { TelegramAdapter } from "./channels/telegram-adapter.js";
import { DiscordAdapter } from "./channels/discord-adapter.js";
import type {
  CachedFlowDefinition,
  ChannelConfig,
  ChannelStatus,
  ChannelType,
  GatewayMessageFromFrontend,
  GatewayMessageToFrontend,
  TunnelConfig,
  TunnelStatus,
  WebhookEndpoint,
  WebhookFlowResult,
  WebhookTestResult,
  GatewayLogEntry,
  WebhookEvent,
} from "./types.js";

const GATEWAY_PORT = 9400;

/**
 * Callback type for executing a flow and returning its completed state.
 * Used to wire the gateway to the sidecar's flow engine.
 */
export type FlowExecutionCallback = (
  broadcastWs: WebSocket,
  flow: CachedFlowDefinition,
  input: string,
  apiKey: string | null,
) => Promise<{ nodeOutputs: Record<string, { kind: string; result: string; data?: Record<string, unknown> }> }>;

export class GatewayManager {
  private gateway: HttpGateway;
  private clients: Set<WebSocket> = new Set();

  // Flow definition cache — populated by frontend via gateway_sync_flow messages
  private flowCache: Map<string, CachedFlowDefinition> = new Map();

  // Flow execution callback — set by agent.ts via setFlowExecutionCallback()
  private flowExecutionCb: FlowExecutionCallback | null = null;

  // API key reference — set by agent.ts
  private apiKeyProvider: (() => string | null) | null = null;

  // Channel adapters
  private messageBus: MessageBus;
  private telegramAdapter: TelegramAdapter;
  private discordAdapter: DiscordAdapter;
  private channelConfigs: Map<ChannelType, ChannelConfig> = new Map();

  constructor() {
    this.gateway = new HttpGateway(GATEWAY_PORT);

    // ── Message bus (shared by all channel adapters) ──────────────────
    this.messageBus = new MessageBus({
      getFlows: () => this.getFlowInfoList(),
      executeFlow: (flowId, input, replyTo) => {
        this.executeFlowForChannel(flowId, input, replyTo);
      },
      getStatusSummary: () => {
        const status = this.gateway.getStatus();
        const lines = [
          `ArchonIDE Gateway`,
          `  Running: ${status.running ? "Yes" : "No"}`,
          `  Port: ${status.port}`,
          `  Tunnel: ${status.tunnel.state}${status.tunnel.publicUrl ? ` (${status.tunnel.publicUrl})` : ""}`,
          `  Webhooks: ${status.webhookCount}`,
          `  Channels:`,
        ];
        for (const ch of [this.telegramAdapter, this.discordAdapter]) {
          const s = ch.getStatus();
          lines.push(`    ${s.type}: ${s.state}${s.botUsername ? ` (@${s.botUsername})` : ""}`);
        }
        return lines.join("\n");
      },
    });

    // Forward message bus logs
    this.messageBus.on("log", (entry: GatewayLogEntry) => {
      this.broadcast({ type: "gateway_log", entry });
    });

    // ── Channel adapters ─────────────────────────────────────────────
    this.telegramAdapter = new TelegramAdapter(this.messageBus);
    this.discordAdapter = new DiscordAdapter(this.messageBus);

    // Forward adapter events
    for (const adapter of [this.telegramAdapter, this.discordAdapter]) {
      adapter.on("status", (status: ChannelStatus) => {
        this.broadcast({ type: "channel_status", status });
        // Also refresh gateway status (includes channel list)
        this.broadcastStatus();
      });
      adapter.on("log", (entry: GatewayLogEntry) => {
        this.broadcast({ type: "gateway_log", entry });
      });
    }

    // ── Gateway events → WS clients ─────────────────────────────────
    this.gateway.on("log", (entry: GatewayLogEntry) => {
      this.broadcast({ type: "gateway_log", entry });
    });

    this.gateway.on("tunnel_status", (status: TunnelStatus) => {
      this.broadcast({ type: "tunnel_status", status });
    });

    this.gateway.on("webhook_list", (webhooks: WebhookEndpoint[]) => {
      this.broadcast({ type: "webhook_list", webhooks });
    });

    this.gateway.on("webhook_triggered", (data: {
      flowId: string;
      payload: unknown;
      headers: Record<string, string>;
      event: WebhookEvent;
    }) => {
      this.broadcast({ type: "webhook_triggered", event: data.event });
    });

    // ── Wire webhook flow execution into the HTTP gateway ────────────
    this.gateway.setFlowExecutor(this.createWebhookFlowExecutor());
  }

  /**
   * Set the flow execution callback — called by agent.ts to wire the flow engine.
   */
  setFlowExecutionCallback(cb: FlowExecutionCallback): void {
    this.flowExecutionCb = cb;
  }

  /**
   * Set the API key provider — called by agent.ts so the gateway can access the current key.
   */
  setApiKeyProvider(provider: () => string | null): void {
    this.apiKeyProvider = provider;
  }

  /** Register a WebSocket client to receive gateway events */
  registerClient(ws: WebSocket): void {
    this.clients.add(ws);
    ws.on("close", () => this.clients.delete(ws));
  }

  /** Handle a gateway-related message from the frontend */
  async handleMessage(ws: WebSocket, message: GatewayMessageFromFrontend): Promise<void> {
    switch (message.type) {
      case "gateway_start":
        await this.startGateway();
        break;

      case "gateway_stop":
        await this.stopGateway();
        break;

      case "tunnel_start":
        await this.startTunnel(message.config);
        break;

      case "tunnel_stop":
        await this.gateway.tunnelManager.stop();
        break;

      case "webhook_create":
        // Cache the flow definition if provided
        if (message.flow) {
          this.flowCache.set(message.flowId, message.flow);
        }
        this.gateway.createWebhook(message.flowId, message.flowName);
        this.send(ws, { type: "webhook_list", webhooks: this.gateway.getWebhooks() });
        break;

      case "webhook_delete":
        this.gateway.deleteWebhook(message.id);
        break;

      case "webhook_toggle":
        this.gateway.toggleWebhook(message.id, message.enabled);
        break;

      case "webhook_regenerate_token":
        this.gateway.regenerateToken(message.id);
        break;

      case "webhook_test":
        this.handleWebhookTest(ws, message.id, message.payload);
        break;

      case "gateway_get_status":
        this.send(ws, { type: "gateway_status", status: this.gateway.getStatus() });
        break;

      case "channel_configure":
        await this.handleChannelConfigure(ws, message.config);
        break;

      case "channel_start":
        await this.handleChannelStart(ws, message.channelType);
        break;

      case "channel_stop":
        await this.handleChannelStop(ws, message.channelType);
        break;

      case "gateway_sync_flow":
        this.flowCache.set(message.flow.id, message.flow);
        this.log("info", `Flow definition cached: "${message.flow.name}" (${message.flow.id})`);
        break;
    }
  }

  /** Load persisted webhooks from frontend storage */
  loadWebhooks(webhooks: WebhookEndpoint[]): void {
    this.gateway.loadWebhooks(webhooks);
  }

  /** Get current webhook list for persistence */
  getWebhooks(): WebhookEndpoint[] {
    return this.gateway.getWebhooks();
  }

  // ── Flow Execution Wiring ──────────────────────────────────────────────────

  /**
   * Create a broadcast-capable WebSocket-like object that sends to all connected clients.
   * This is used to broadcast flow execution events to the frontend.
   */
  private createBroadcastWs(): WebSocket {
    const clients = this.clients;
    return {
      readyState: WebSocket.OPEN,
      send(data: string) {
        for (const client of clients) {
          if (client.readyState === WebSocket.OPEN) {
            client.send(data);
          }
        }
      },
    } as unknown as WebSocket;
  }

  /**
   * Create the webhook flow executor callback for HttpGateway.
   * This runs a flow synchronously and extracts webhook-response node output.
   */
  private createWebhookFlowExecutor(): WebhookFlowExecutor {
    return async (flowId, payload, _headers): Promise<WebhookFlowResult | null> => {
      if (!this.flowExecutionCb) {
        this.log("warn", `No flow execution callback registered — webhook will return 202`);
        return null;
      }

      const flow = this.flowCache.get(flowId);
      if (!flow) {
        this.log("warn", `Flow definition not cached for ${flowId} — webhook will return 202`);
        return null;
      }

      // Check if the flow has a webhook-response node (skip full execution if not)
      const hasResponseNode = flow.nodes.some((n) => n.kind === "webhook-response");

      const apiKey = this.apiKeyProvider?.() ?? null;
      const input = typeof payload === "string" ? payload : JSON.stringify(payload);
      const broadcastWs = this.createBroadcastWs();

      try {
        const state = await this.flowExecutionCb(broadcastWs, flow, input, apiKey);

        if (!hasResponseNode) return null;

        // Find the webhook-response node output
        for (const output of Object.values(state.nodeOutputs)) {
          if (output.kind === "webhook-response" && output.data) {
            return {
              statusCode: (output.data.statusCode as number) ?? 200,
              contentType: (output.data.contentType as string) ?? "application/json",
              body: output.result,
              headers: output.data.headers as Record<string, string> | undefined,
            };
          }
        }

        return null;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        this.log("error", `Flow execution failed for webhook: ${errMsg}`);
        throw err;
      }
    };
  }

  /**
   * Execute a flow triggered by a channel adapter (Telegram/Discord slash commands).
   * Runs the flow and sends the result back via the replyTo callback.
   */
  private async executeFlowForChannel(
    flowId: string,
    input: string,
    replyTo?: (text: string) => Promise<void>,
  ): Promise<void> {
    if (!this.flowExecutionCb) {
      await replyTo?.("Flow execution is not available — no execution callback registered.");
      return;
    }

    const flow = this.flowCache.get(flowId);
    if (!flow) {
      await replyTo?.(`Flow definition not found for ID ${flowId}. Please sync flows from the IDE.`);
      return;
    }

    const apiKey = this.apiKeyProvider?.() ?? null;
    const broadcastWs = this.createBroadcastWs();

    try {
      const state = await this.flowExecutionCb(broadcastWs, flow, input, apiKey);

      // Find the last node output to use as the reply
      const outputs = Object.values(state.nodeOutputs);
      const lastOutput = outputs[outputs.length - 1];
      const result = lastOutput?.result ?? "(No output)";

      await replyTo?.(result);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      await replyTo?.(`Flow execution failed: ${errMsg}`);
    }
  }

  /**
   * Get flow info list for the message bus (channel adapters use this to list available flows).
   */
  private getFlowInfoList(): FlowInfo[] {
    return Array.from(this.flowCache.values()).map((flow) => ({
      id: flow.id,
      name: flow.name,
      description: flow.description,
    }));
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private async startGateway(): Promise<void> {
    if (this.gateway.isRunning()) return;
    try {
      await this.gateway.start();
      this.broadcastStatus();
    } catch (err) {
      // Error already logged by HttpGateway
    }
  }

  private async stopGateway(): Promise<void> {
    await this.gateway.stop();
    this.broadcastStatus();
  }

  private async startTunnel(config: TunnelConfig): Promise<void> {
    try {
      // Ensure gateway is running first
      if (!this.gateway.isRunning()) {
        await this.gateway.start();
      }
      await this.gateway.tunnelManager.start(config, "127.0.0.1", this.gateway.getPort());
      this.broadcastStatus();
    } catch {
      // Error already logged by TunnelManager
      this.broadcastStatus();
    }
  }

  private async handleWebhookTest(ws: WebSocket, webhookId: string, payload: unknown): Promise<void> {
    const webhooks = this.gateway.getWebhooks();
    const endpoint = webhooks.find((wh) => wh.id === webhookId);
    if (!endpoint) return;

    const startTime = Date.now();

    // Emit the trigger event for the events list
    const event: WebhookEvent = {
      id: `test-${Date.now()}`,
      endpointId: endpoint.id,
      flowId: endpoint.flowId,
      timestamp: new Date().toISOString(),
      method: "POST",
      headers: { "x-test": "true" },
      body: payload,
      statusCode: 202,
      durationMs: 0,
    };
    this.broadcast({ type: "webhook_triggered", event });

    // Actually execute the flow and return the result
    if (!this.flowExecutionCb) {
      const result: WebhookTestResult = {
        webhookId,
        statusCode: 202,
        contentType: "application/json",
        body: JSON.stringify({ status: "accepted", note: "No flow execution callback registered" }),
        durationMs: Date.now() - startTime,
      };
      this.send(ws, { type: "webhook_test_result", result });
      return;
    }

    const flow = this.flowCache.get(endpoint.flowId);
    if (!flow) {
      const result: WebhookTestResult = {
        webhookId,
        statusCode: 202,
        contentType: "application/json",
        body: JSON.stringify({ status: "accepted", note: "Flow definition not cached" }),
        durationMs: Date.now() - startTime,
      };
      this.send(ws, { type: "webhook_test_result", result });
      return;
    }

    try {
      const apiKey = this.apiKeyProvider?.() ?? null;
      const input = typeof payload === "string" ? payload : JSON.stringify(payload);
      const broadcastWs = this.createBroadcastWs();
      const state = await this.flowExecutionCb(broadcastWs, flow, input, apiKey);

      // Check for webhook-response node output
      let testResult: WebhookTestResult;
      const hasResponseNode = flow.nodes.some((n) => n.kind === "webhook-response");

      if (hasResponseNode) {
        let found = false;
        for (const output of Object.values(state.nodeOutputs)) {
          if (output.kind === "webhook-response" && output.data) {
            testResult = {
              webhookId,
              statusCode: (output.data.statusCode as number) ?? 200,
              contentType: (output.data.contentType as string) ?? "application/json",
              body: output.result,
              headers: output.data.headers as Record<string, string> | undefined,
              durationMs: Date.now() - startTime,
            };
            found = true;
            this.send(ws, { type: "webhook_test_result", result: testResult });
            break;
          }
        }
        if (!found) {
          testResult = {
            webhookId,
            statusCode: 200,
            contentType: "application/json",
            body: JSON.stringify({ status: "completed", note: "No webhook-response node output" }),
            durationMs: Date.now() - startTime,
          };
          this.send(ws, { type: "webhook_test_result", result: testResult });
        }
      } else {
        // No webhook-response node — return last node output
        const outputs = Object.values(state.nodeOutputs);
        const lastOutput = outputs[outputs.length - 1];
        testResult = {
          webhookId,
          statusCode: 200,
          contentType: "application/json",
          body: lastOutput?.result ?? "(No output)",
          durationMs: Date.now() - startTime,
        };
        this.send(ws, { type: "webhook_test_result", result: testResult });
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const result: WebhookTestResult = {
        webhookId,
        statusCode: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: errMsg }),
        durationMs: Date.now() - startTime,
        error: errMsg,
      };
      this.send(ws, { type: "webhook_test_result", result });
    }
  }

  // ── Channel management ──────────────────────────────────────────────────────

  private async handleChannelConfigure(_ws: WebSocket, config: ChannelConfig): Promise<void> {
    this.channelConfigs.set(config.type, config);
    this.log("info", `Channel ${config.type} configured`);
  }

  private async handleChannelStart(ws: WebSocket, channelType: ChannelType): Promise<void> {
    const config = this.channelConfigs.get(channelType);
    if (!config) {
      this.send(ws, {
        type: "gateway_log",
        entry: {
          timestamp: new Date().toISOString(),
          level: "error",
          source: "channel",
          message: `No configuration found for ${channelType}. Configure the channel first.`,
        },
      });
      return;
    }

    // Ensure gateway is running
    if (!this.gateway.isRunning()) {
      await this.gateway.start();
      this.broadcastStatus();
    }

    try {
      if (channelType === "telegram") {
        const tunnelUrl = this.gateway.tunnelManager.getStatus().publicUrl;
        const { webhookCallback, webhookPath } = await this.telegramAdapter.start(config, tunnelUrl);
        // Register the Telegram webhook route on the Fastify gateway
        this.gateway.registerChannelRoute(webhookPath, webhookCallback);
      } else if (channelType === "discord") {
        await this.discordAdapter.start(config);
      }
    } catch (err) {
      // Errors already logged by adapters
      this.send(ws, {
        type: "channel_status",
        status: this.getAdapter(channelType).getStatus(),
      });
    }
  }

  private async handleChannelStop(_ws: WebSocket, channelType: ChannelType): Promise<void> {
    const adapter = this.getAdapter(channelType);
    await adapter.stop();
  }

  private getAdapter(channelType: ChannelType): TelegramAdapter | DiscordAdapter {
    return channelType === "telegram" ? this.telegramAdapter : this.discordAdapter;
  }

  /** Get channel statuses for inclusion in overall gateway status */
  getChannelStatuses(): ChannelStatus[] {
    return [
      this.telegramAdapter.getStatus(),
      this.discordAdapter.getStatus(),
    ].filter(s => s.state !== "stopped");
  }

  private broadcastStatus(): void {
    const status = this.gateway.getStatus();
    // Augment with channel statuses
    status.channels = this.getChannelStatuses();
    this.broadcast({ type: "gateway_status", status });
  }

  private log(level: GatewayLogEntry["level"], message: string): void {
    this.broadcast({
      type: "gateway_log",
      entry: {
        timestamp: new Date().toISOString(),
        level,
        source: "gateway",
        message,
      },
    });
  }

  private broadcast(message: GatewayMessageToFrontend): void {
    const data = JSON.stringify(message);
    for (const ws of this.clients) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    }
  }

  private send(ws: WebSocket, message: GatewayMessageToFrontend): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }
}
