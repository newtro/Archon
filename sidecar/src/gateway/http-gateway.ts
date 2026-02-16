/**
 * HTTP Gateway — Fastify server that handles webhooks and channel callbacks.
 *
 * Binds to 127.0.0.1 only (tunnel handles external exposure).
 * Routes:
 *   POST /webhooks/:flowId/:token  — Trigger a flow via webhook
 *   POST /channels/telegram        — Telegram webhook callback
 *   POST /channels/discord         — Discord interactions endpoint
 *   GET  /health                   — Health check
 *   GET  /status                   — Gateway status
 */

import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from "fastify";
import { EventEmitter } from "events";
import type {
  WebhookEndpoint,
  WebhookEvent,
  WebhookFlowResult,
  GatewayLogEntry,
  GatewayStatus,
} from "./types.js";
import { TunnelManager } from "./tunnel/tunnel-manager.js";
import { randomBytes } from "crypto";

/**
 * Callback type for executing a flow triggered by a webhook.
 * Returns a WebhookFlowResult if a webhook-response node was in the flow,
 * or null if the flow should return the default 202 response.
 */
export type WebhookFlowExecutor = (
  flowId: string,
  payload: unknown,
  headers: Record<string, string>,
) => Promise<WebhookFlowResult | null>;

export class HttpGateway extends EventEmitter {
  private server: FastifyInstance | null = null;
  private webhooks: Map<string, WebhookEndpoint> = new Map();
  private port: number;
  readonly tunnelManager: TunnelManager;

  // Rate limiting: simple per-IP sliding window
  private rateLimits: Map<string, number[]> = new Map();
  private readonly maxRequestsPerMinute = 60;

  // Dynamic channel route handlers
  private channelHandlers: Map<string, (request: unknown, reply: unknown) => Promise<void>> | null = null;
  private registeredChannelPaths: Set<string> = new Set();

  // Flow execution callback — set by GatewayManager to wire webhook triggers to the flow engine
  private flowExecutor: WebhookFlowExecutor | null = null;

  constructor(port: number = 9400) {
    super();
    this.port = port;
    this.tunnelManager = new TunnelManager();

    // Forward tunnel events
    this.tunnelManager.on("status", (status) => this.emit("tunnel_status", status));
    this.tunnelManager.on("log", (entry) => this.emit("log", entry));
  }

  async start(): Promise<void> {
    if (this.server) return;

    this.server = Fastify({ logger: false });

    // ── Rate limiting hook ────────────────────────────────────────────────
    this.server.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
      const ip = request.ip;
      const now = Date.now();
      const window = this.rateLimits.get(ip) ?? [];
      const recent = window.filter((t) => now - t < 60_000);
      recent.push(now);
      this.rateLimits.set(ip, recent);

      if (recent.length > this.maxRequestsPerMinute) {
        this.log("warn", `Rate limited ${ip} (${recent.length} req/min)`);
        return reply.status(429).send({ error: "Too many requests" });
      }
    });

    // ── Routes ────────────────────────────────────────────────────────────

    this.server.get("/health", async () => ({ ok: true, timestamp: new Date().toISOString() }));

    this.server.get("/status", async () => this.getStatus());

    this.server.post("/webhooks/:flowId/:token", async (request, reply) => {
      return this.handleWebhook(request, reply);
    });

    // Channel callback routes are registered dynamically via registerChannelRoute()

    try {
      await this.server.listen({ port: this.port, host: "127.0.0.1" });
      this.log("info", `HTTP gateway listening on http://127.0.0.1:${this.port}`);
    } catch (err) {
      this.log("error", `Failed to start HTTP gateway: ${err instanceof Error ? err.message : String(err)}`);
      this.server = null;
      throw err;
    }
  }

  async stop(): Promise<void> {
    await this.tunnelManager.stop();

    if (this.server) {
      await this.server.close();
      this.server = null;
      this.channelHandlers?.clear();
      this.registeredChannelPaths.clear();
      this.log("info", "HTTP gateway stopped");
    }
  }

  getPort(): number {
    return this.port;
  }

  isRunning(): boolean {
    return this.server !== null;
  }

  // ── Dynamic channel routes ──────────────────────────────────────────────────

  /**
   * Register a channel webhook callback route on the running Fastify server.
   * Used by TelegramAdapter to wire its webhook handler into the HTTP gateway.
   */
  registerChannelRoute(
    path: string,
    handler: (request: unknown, reply: unknown) => Promise<void>,
  ): void {
    if (!this.server) {
      this.log("warn", `Cannot register channel route ${path}: gateway not running`);
      return;
    }

    // Fastify doesn't allow re-registering a route at the same path.
    // We use a handler reference that can be swapped.
    if (!this.channelHandlers) {
      this.channelHandlers = new Map();
    }

    this.channelHandlers.set(path, handler);

    // Only register the Fastify route once per path
    if (!this.registeredChannelPaths.has(path)) {
      this.registeredChannelPaths.add(path);
      const self = this;
      this.server.post(path, async (request, reply) => {
        const h = self.channelHandlers?.get(path);
        if (h) {
          await h(request, reply);
        } else {
          reply.status(501).send({ error: "Channel handler not registered" });
        }
      });
      this.log("info", `Channel route registered: POST ${path}`);
    } else {
      this.log("info", `Channel handler updated for: POST ${path}`);
    }
  }

  // ── Webhook Management ────────────────────────────────────────────────────

  createWebhook(flowId: string, flowName: string): WebhookEndpoint {
    const id = randomBytes(8).toString("hex");
    const token = randomBytes(32).toString("hex");

    const endpoint: WebhookEndpoint = {
      id,
      flowId,
      flowName,
      token,
      enabled: true,
      createdAt: new Date().toISOString(),
      lastTriggeredAt: null,
    };

    this.webhooks.set(id, endpoint);
    this.log("info", `Webhook created for flow "${flowName}" (${id})`);
    this.emit("webhook_list", this.getWebhooks());
    return endpoint;
  }

  deleteWebhook(id: string): boolean {
    const deleted = this.webhooks.delete(id);
    if (deleted) {
      this.log("info", `Webhook deleted (${id})`);
      this.emit("webhook_list", this.getWebhooks());
    }
    return deleted;
  }

  toggleWebhook(id: string, enabled: boolean): WebhookEndpoint | null {
    const endpoint = this.webhooks.get(id);
    if (!endpoint) return null;
    endpoint.enabled = enabled;
    this.emit("webhook_list", this.getWebhooks());
    return endpoint;
  }

  regenerateToken(id: string): WebhookEndpoint | null {
    const endpoint = this.webhooks.get(id);
    if (!endpoint) return null;
    endpoint.token = randomBytes(32).toString("hex");
    this.log("info", `Webhook token regenerated (${id})`);
    this.emit("webhook_list", this.getWebhooks());
    return endpoint;
  }

  getWebhooks(): WebhookEndpoint[] {
    return Array.from(this.webhooks.values());
  }

  loadWebhooks(webhooks: WebhookEndpoint[]): void {
    this.webhooks.clear();
    for (const wh of webhooks) {
      this.webhooks.set(wh.id, wh);
    }
  }

  // ── Flow Execution Callback ──────────────────────────────────────────────

  /**
   * Set the callback that executes a flow when a webhook is triggered.
   * If the callback returns a WebhookFlowResult, the HTTP response uses it.
   * If null, the default 202 Accepted is returned.
   */
  setFlowExecutor(executor: WebhookFlowExecutor): void {
    this.flowExecutor = executor;
  }

  // ── Webhook Handler ───────────────────────────────────────────────────────

  private async handleWebhook(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const start = Date.now();
    const { flowId, token } = request.params as { flowId: string; token: string };

    // Find matching endpoint by flowId and token
    const endpoint = Array.from(this.webhooks.values()).find(
      (wh) => wh.flowId === flowId && wh.token === token,
    );

    if (!endpoint) {
      reply.status(401).send({ error: "Invalid webhook URL or token" });
      return;
    }

    if (!endpoint.enabled) {
      reply.status(403).send({ error: "Webhook endpoint is disabled" });
      return;
    }

    // Update last triggered
    endpoint.lastTriggeredAt = new Date().toISOString();

    const event: WebhookEvent = {
      id: randomBytes(8).toString("hex"),
      endpointId: endpoint.id,
      flowId: endpoint.flowId,
      timestamp: new Date().toISOString(),
      method: request.method,
      headers: request.headers as Record<string, string>,
      body: request.body,
      statusCode: 202,
      durationMs: 0,
    };

    this.log("info", `Webhook triggered: flow "${endpoint.flowName}" (${endpoint.flowId})`);

    // Notify frontend about the trigger
    this.emit("webhook_triggered", {
      flowId: endpoint.flowId,
      payload: request.body,
      headers: request.headers,
      event,
    });

    // If a flow executor is registered, run the flow and check for a webhook-response node
    if (this.flowExecutor) {
      try {
        const result = await this.flowExecutor(
          endpoint.flowId,
          request.body,
          request.headers as Record<string, string>,
        );

        event.durationMs = Date.now() - start;

        if (result) {
          // Webhook-response node produced a custom response
          event.statusCode = result.statusCode;
          if (result.headers) {
            for (const [key, value] of Object.entries(result.headers)) {
              reply.header(key, value);
            }
          }
          reply.status(result.statusCode).send(result.body);
          this.log("info", `Webhook response: ${result.statusCode} for flow "${endpoint.flowName}"`);
          return;
        }
      } catch (err) {
        event.durationMs = Date.now() - start;
        event.statusCode = 500;
        const errMsg = err instanceof Error ? err.message : String(err);
        this.log("error", `Flow execution failed for webhook "${endpoint.flowName}": ${errMsg}`);
        reply.status(500).send({ error: "Flow execution failed", message: errMsg });
        return;
      }
    }

    event.durationMs = Date.now() - start;

    // Default response — no flow executor or no webhook-response node in the flow
    reply.status(202).send({
      accepted: true,
      flowId: endpoint.flowId,
      eventId: event.id,
      message: "Flow execution triggered",
    });
  }

  // ── Status ────────────────────────────────────────────────────────────────

  getStatus(): GatewayStatus {
    return {
      running: this.isRunning(),
      port: this.port,
      tunnel: this.tunnelManager.getStatus(),
      channels: [], // Populated in Phase 3B
      webhookCount: this.webhooks.size,
    };
  }

  // ── Logging ───────────────────────────────────────────────────────────────

  private log(level: GatewayLogEntry["level"], message: string): void {
    const entry: GatewayLogEntry = {
      timestamp: new Date().toISOString(),
      level,
      source: "gateway",
      message,
    };
    this.emit("log", entry);
  }
}
