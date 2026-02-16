/**
 * ngrok tunnel provider — uses the official @ngrok/ngrok SDK.
 * No binary spawning needed; the SDK handles everything programmatically.
 */

import type { TunnelProvider, TunnelProviderName } from "../types.js";

// Dynamic import to avoid top-level dependency issues
let ngrok: typeof import("@ngrok/ngrok") | null = null;

export class NgrokProvider implements TunnelProvider {
  readonly name: TunnelProviderName = "ngrok";
  private listener: unknown = null; // ngrok.Listener
  private url: string | null = null;

  constructor(
    private authToken: string,
    private domain?: string,
  ) {}

  async start(localHost: string, localPort: number): Promise<string> {
    if (!ngrok) {
      ngrok = await import("@ngrok/ngrok");
    }

    const forwardAddr = `${localHost}:${localPort}`;
    const options: Record<string, unknown> = {
      addr: forwardAddr,
      authtoken: this.authToken,
    };

    if (this.domain) {
      options.domain = this.domain;
    }

    this.listener = await ngrok.forward(options);
    this.url = (this.listener as { url(): string }).url();

    if (!this.url) {
      throw new Error("ngrok started but returned no URL");
    }

    return this.url;
  }

  async stop(): Promise<void> {
    if (this.listener && ngrok) {
      try {
        await (this.listener as { close(): Promise<void> }).close();
      } catch {
        // Best effort — ngrok may already be closed
      }
      // Disconnect the ngrok session
      try {
        await ngrok.disconnect();
      } catch {
        // Best effort
      }
    }
    this.listener = null;
    this.url = null;
  }

  async healthCheck(): Promise<boolean> {
    if (!this.listener || !this.url) return false;
    try {
      const resp = await fetch(this.url, { method: "HEAD", signal: AbortSignal.timeout(5000) });
      // ngrok returns 502 if backend is down but tunnel is alive — that's still "healthy" for the tunnel
      return resp.status !== 0;
    } catch {
      return false;
    }
  }

  publicUrl(): string | null {
    return this.url;
  }
}
