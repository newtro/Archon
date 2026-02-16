/**
 * Cloudflare tunnel provider — uses the `cloudflared` npm package
 * which auto-installs the cloudflared binary and provides a Tunnel class.
 */

import type { TunnelProvider, TunnelProviderName } from "../types.js";

// Dynamic import for the cloudflared package
let cloudflaredModule: typeof import("cloudflared") | null = null;

export class CloudflareProvider implements TunnelProvider {
  readonly name: TunnelProviderName = "cloudflare";
  private tunnelInstance: { stop: () => boolean } | null = null;
  private _url: string | null = null;

  constructor(private token: string) {}

  async start(localHost: string, localPort: number): Promise<string> {
    if (!cloudflaredModule) {
      cloudflaredModule = await import("cloudflared");
    }

    const { Tunnel, bin, install: installBin } = cloudflaredModule;

    // Ensure the cloudflared binary is installed
    try {
      const { existsSync } = await import("fs");
      if (!existsSync(bin)) {
        await installBin(bin);
      }
    } catch {
      // install() may throw if binary already exists or on permission issues
    }

    const localUrl = `http://${localHost}:${localPort}`;

    return new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Cloudflare tunnel timed out after 30s"));
      }, 30_000);

      // Use token-based or quick tunnel depending on config
      const t = this.token
        ? Tunnel.withToken(this.token, { url: localUrl })
        : Tunnel.quick(localUrl);

      t.on("url", (url: string) => {
        clearTimeout(timeout);
        this._url = url;
        resolve(url);
      });

      t.on("error", (err: Error) => {
        clearTimeout(timeout);
        reject(err);
      });

      this.tunnelInstance = t;
    });
  }

  async stop(): Promise<void> {
    if (this.tunnelInstance) {
      try {
        this.tunnelInstance.stop();
      } catch {
        // Best effort
      }
      this.tunnelInstance = null;
    }
    this._url = null;
  }

  async healthCheck(): Promise<boolean> {
    if (!this._url) return false;
    try {
      const resp = await fetch(this._url, { method: "HEAD", signal: AbortSignal.timeout(5000) });
      return resp.status !== 0;
    } catch {
      return false;
    }
  }

  publicUrl(): string | null {
    return this._url;
  }
}
