/**
 * TunnelManager — manages the active tunnel provider lifecycle.
 *
 * Inspired by ZeroClaw's agnostic Tunnel trait, this wraps pluggable tunnel
 * providers (ngrok, Cloudflare, custom) behind a uniform interface.
 */

import { EventEmitter } from "events";
import type {
  TunnelProvider,
  TunnelConfig,
  TunnelStatus,
  GatewayLogEntry,
} from "../types.js";
import { NgrokProvider } from "./ngrok-provider.js";
import { CloudflareProvider } from "./cloudflare-provider.js";
import { CustomProvider } from "./custom-provider.js";

export class TunnelManager extends EventEmitter {
  private provider: TunnelProvider | null = null;
  private config: TunnelConfig | null = null;
  private startedAt: number = 0;
  private healthInterval: ReturnType<typeof setInterval> | null = null;
  private reconnecting = false;
  private state: TunnelStatus["state"] = "stopped";
  private lastError: string | null = null;
  private currentUrl: string | null = null;
  private lastLatencyMs: number | null = null;

  getStatus(): TunnelStatus {
    return {
      provider: this.config?.provider ?? "none",
      state: this.state,
      publicUrl: this.currentUrl,
      error: this.lastError,
      uptimeMs: this.state === "connected" ? Date.now() - this.startedAt : 0,
      latencyMs: this.lastLatencyMs ?? undefined,
    };
  }

  async start(config: TunnelConfig, localHost: string, localPort: number): Promise<string> {
    // Stop existing tunnel if running
    if (this.provider) {
      await this.stop();
    }

    this.config = config;
    this.provider = this.createProvider(config);

    if (!this.provider) {
      throw new Error(`Unknown tunnel provider: ${config.provider}`);
    }

    this.setState("starting");
    this.log("info", `Starting ${config.provider} tunnel...`);

    try {
      const url = await this.provider.start(localHost, localPort);
      this.currentUrl = url;
      this.startedAt = Date.now();
      this.setState("connected");
      this.log("info", `Tunnel connected: ${url}`);

      // Start health checks
      this.startHealthCheck();

      return url;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.lastError = message;
      this.setState("error");
      this.log("error", `Tunnel failed to start: ${message}`);
      throw err;
    }
  }

  async stop(): Promise<void> {
    this.stopHealthCheck();

    if (this.provider) {
      try {
        await this.provider.stop();
        this.log("info", "Tunnel stopped");
      } catch (err) {
        this.log("warn", `Error stopping tunnel: ${err instanceof Error ? err.message : String(err)}`);
      }
      this.provider = null;
    }

    this.currentUrl = null;
    this.lastError = null;
    this.lastLatencyMs = null;
    this.reconnecting = false;
    this.setState("stopped");
  }

  private createProvider(config: TunnelConfig): TunnelProvider | null {
    switch (config.provider) {
      case "ngrok":
        if (!config.ngrok) throw new Error("ngrok config required");
        return new NgrokProvider(config.ngrok.authToken, config.ngrok.domain);
      case "cloudflare":
        if (!config.cloudflare) throw new Error("Cloudflare config required");
        return new CloudflareProvider(config.cloudflare.token);
      case "custom":
        if (!config.custom) throw new Error("Custom tunnel config required");
        return new CustomProvider(
          config.custom.startCommand,
          config.custom.urlPattern,
          config.custom.healthUrl,
        );
      case "none":
        return null;
      default:
        return null;
    }
  }

  private startHealthCheck(): void {
    this.stopHealthCheck();
    this.healthInterval = setInterval(async () => {
      if (!this.provider || this.reconnecting) return;

      const start = Date.now();
      const healthy = await this.provider.healthCheck();
      this.lastLatencyMs = Date.now() - start;

      if (healthy && this.state === "connected") {
        // Emit updated status with latency
        this.emit("status", this.getStatus());
      } else if (!healthy && this.state === "connected") {
        this.lastLatencyMs = null;
        this.log("warn", "Tunnel health check failed — attempting reconnect...");
        this.attemptReconnect();
      }
    }, 10_000);
  }

  private stopHealthCheck(): void {
    if (this.healthInterval) {
      clearInterval(this.healthInterval);
      this.healthInterval = null;
    }
  }

  private async attemptReconnect(): Promise<void> {
    if (this.reconnecting || !this.config || !this.provider) return;
    this.reconnecting = true;
    this.setState("reconnecting");

    const maxAttempts = 5;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 30_000);
      this.log("info", `Reconnect attempt ${attempt}/${maxAttempts} in ${delay}ms...`);
      await new Promise((r) => setTimeout(r, delay));

      if (!this.reconnecting) return; // stopped during wait

      try {
        // Try health check first — tunnel may have recovered
        const healthy = await this.provider.healthCheck();
        if (healthy) {
          this.currentUrl = this.provider.publicUrl();
          this.setState("connected");
          this.reconnecting = false;
          this.log("info", "Tunnel reconnected");
          return;
        }
      } catch {
        // Continue to next attempt
      }
    }

    this.lastError = "Failed to reconnect after maximum attempts";
    this.setState("error");
    this.reconnecting = false;
    this.log("error", this.lastError);
  }

  private setState(state: TunnelStatus["state"]): void {
    this.state = state;
    this.emit("status", this.getStatus());
  }

  private log(level: GatewayLogEntry["level"], message: string): void {
    const entry: GatewayLogEntry = {
      timestamp: new Date().toISOString(),
      level,
      source: "tunnel",
      message,
    };
    this.emit("log", entry);
  }
}
