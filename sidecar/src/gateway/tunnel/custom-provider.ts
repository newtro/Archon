/**
 * Custom tunnel provider — runs an arbitrary user-specified command.
 * Supports {host} and {port} placeholders in the start command.
 * Optionally extracts the public URL from stdout/stderr via a regex pattern.
 */

import { spawn, type ChildProcess } from "child_process";
import type { TunnelProvider, TunnelProviderName } from "../types.js";

export class CustomProvider implements TunnelProvider {
  readonly name: TunnelProviderName = "custom";
  private child: ChildProcess | null = null;
  private url: string | null = null;

  constructor(
    private startCommand: string,
    private urlPattern?: string,   // regex to extract URL from output
    private healthUrl?: string,
  ) {}

  async start(localHost: string, localPort: number): Promise<string> {
    const cmd = this.startCommand
      .replace(/\{host\}/g, localHost)
      .replace(/\{port\}/g, String(localPort));

    // Split command into program and args (respects quoted strings)
    const parts = cmd.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [cmd];
    const program = parts[0].replace(/"/g, "");
    const args = parts.slice(1).map((a) => a.replace(/"/g, ""));

    return new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (!this.url) {
          reject(new Error("Custom tunnel timed out waiting for URL after 30s"));
        }
      }, 30_000);

      this.child = spawn(program, args, {
        stdio: ["ignore", "pipe", "pipe"],
        shell: process.platform === "win32",
      });

      const urlRegex = this.urlPattern
        ? new RegExp(this.urlPattern)
        : /https?:\/\/[^\s]+/;

      const onData = (data: Buffer) => {
        const text = data.toString();
        const match = text.match(urlRegex);
        if (match && !this.url) {
          this.url = match[0];
          clearTimeout(timeout);
          resolve(this.url);
        }
      };

      this.child.stdout?.on("data", onData);
      this.child.stderr?.on("data", onData);

      this.child.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      this.child.on("exit", (code) => {
        if (!this.url) {
          clearTimeout(timeout);
          reject(new Error(`Custom tunnel process exited with code ${code} before producing a URL`));
        }
      });
    });
  }

  async stop(): Promise<void> {
    if (this.child) {
      this.child.kill();
      this.child = null;
    }
    this.url = null;
  }

  async healthCheck(): Promise<boolean> {
    // If no child process, tunnel is dead
    if (!this.child || this.child.exitCode !== null) return false;

    // If a health URL was provided, probe it
    if (this.healthUrl) {
      try {
        const resp = await fetch(this.healthUrl, { method: "HEAD", signal: AbortSignal.timeout(5000) });
        return resp.status !== 0;
      } catch {
        return false;
      }
    }

    // Otherwise, just check the process is alive
    return true;
  }

  publicUrl(): string | null {
    return this.url;
  }
}
