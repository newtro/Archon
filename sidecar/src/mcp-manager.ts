/**
 * Lightweight MCP (Model Context Protocol) client manager.
 *
 * Spawns MCP server processes, communicates via JSON-RPC over stdio,
 * and tracks available tools per server. No external MCP SDK dependency.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";

// ── Types ────────────────────────────────────────────────────

export interface McpServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface ActiveServer {
  config: McpServerConfig;
  process: ChildProcess;
  tools: McpTool[];
  initialized: boolean;
  nextId: number;
  pendingRequests: Map<number | string, {
    resolve: (value: unknown) => void;
    reject: (reason: Error) => void;
  }>;
  buffer: string;
}

// ── McpManager ───────────────────────────────────────────────

export class McpManager extends EventEmitter {
  private servers = new Map<string, ActiveServer>();

  /**
   * Start an MCP server process and perform the initialize handshake.
   */
  async startServer(config: McpServerConfig): Promise<void> {
    if (this.servers.has(config.name)) {
      throw new Error(`MCP server "${config.name}" is already running`);
    }

    const childEnv = { ...process.env, ...(config.env ?? {}) };

    const child = spawn(config.command, config.args ?? [], {
      stdio: ["pipe", "pipe", "pipe"],
      env: childEnv,
      shell: process.platform === "win32",
    });

    const server: ActiveServer = {
      config,
      process: child,
      tools: [],
      initialized: false,
      nextId: 1,
      pendingRequests: new Map(),
      buffer: "",
    };

    this.servers.set(config.name, server);

    // Handle stdout — JSON-RPC responses delimited by newlines
    child.stdout?.on("data", (chunk: Buffer) => {
      server.buffer += chunk.toString();
      this.processBuffer(server);
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      console.error(`[mcp:${config.name}:stderr]`, chunk.toString());
    });

    child.on("error", (err) => {
      console.error(`[mcp:${config.name}] Process error:`, err);
      this.servers.delete(config.name);
      this.emit("server_error", { name: config.name, error: err.message });
    });

    child.on("exit", (code) => {
      console.log(`[mcp:${config.name}] Exited with code ${code}`);
      this.servers.delete(config.name);
      this.emit("server_stopped", { name: config.name, code });
    });

    // Perform initialize handshake
    try {
      await this.sendRequest(config.name, "initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "archon-ide", version: "0.1.0" },
      });
      server.initialized = true;

      // Send initialized notification (no response expected)
      this.sendNotification(config.name, "notifications/initialized", {});

      // Fetch available tools
      await this.refreshTools(config.name);

      console.log(
        `[mcp:${config.name}] Initialized with ${server.tools.length} tools`
      );
    } catch (err) {
      console.error(`[mcp:${config.name}] Initialize failed:`, err);
      this.stopServer(config.name);
      throw err;
    }
  }

  /**
   * Stop a running MCP server.
   */
  stopServer(name: string): void {
    const server = this.servers.get(name);
    if (!server) return;

    // Reject all pending requests
    for (const [, pending] of server.pendingRequests) {
      pending.reject(new Error(`Server "${name}" is being stopped`));
    }
    server.pendingRequests.clear();

    server.process.kill();
    this.servers.delete(name);
    console.log(`[mcp:${name}] Stopped`);
  }

  /**
   * List all active servers and their tool counts.
   */
  listServers(): Array<{ name: string; initialized: boolean; toolCount: number }> {
    const result: Array<{ name: string; initialized: boolean; toolCount: number }> = [];
    for (const [name, server] of this.servers) {
      result.push({
        name,
        initialized: server.initialized,
        toolCount: server.tools.length,
      });
    }
    return result;
  }

  /**
   * Get tools available on a specific server.
   */
  getTools(serverName: string): McpTool[] {
    return this.servers.get(serverName)?.tools ?? [];
  }

  /**
   * Get all tools across all servers, prefixed with server name.
   */
  getAllTools(): Array<McpTool & { server: string }> {
    const result: Array<McpTool & { server: string }> = [];
    for (const [name, server] of this.servers) {
      for (const tool of server.tools) {
        result.push({ ...tool, server: name });
      }
    }
    return result;
  }

  /**
   * Call a tool on a specific MCP server.
   */
  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown> = {},
  ): Promise<unknown> {
    const result = await this.sendRequest(serverName, "tools/call", {
      name: toolName,
      arguments: args,
    });
    return result;
  }

  /**
   * Refresh the tool list for a server.
   */
  async refreshTools(serverName: string): Promise<McpTool[]> {
    const server = this.servers.get(serverName);
    if (!server) throw new Error(`Server "${serverName}" not found`);

    const result = (await this.sendRequest(serverName, "tools/list", {})) as {
      tools?: McpTool[];
    };
    server.tools = result?.tools ?? [];
    return server.tools;
  }

  /**
   * Stop all servers and clean up.
   */
  shutdown(): void {
    for (const name of [...this.servers.keys()]) {
      this.stopServer(name);
    }
  }

  // ── Internal helpers ─────────────────────────────────────────

  private sendRequest(
    serverName: string,
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    const server = this.servers.get(serverName);
    if (!server) {
      return Promise.reject(new Error(`Server "${serverName}" not found`));
    }

    const id = server.nextId++;
    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };

    return new Promise((resolve, reject) => {
      server.pendingRequests.set(id, { resolve, reject });

      const data = JSON.stringify(request) + "\n";
      const ok = server.process.stdin?.write(data);
      if (!ok) {
        server.pendingRequests.delete(id);
        reject(new Error(`Failed to write to server "${serverName}" stdin`));
      }
    });
  }

  private sendNotification(
    serverName: string,
    method: string,
    params: Record<string, unknown>,
  ): void {
    const server = this.servers.get(serverName);
    if (!server) return;

    // Notifications have no id
    const notification = {
      jsonrpc: "2.0" as const,
      method,
      params,
    };

    server.process.stdin?.write(JSON.stringify(notification) + "\n");
  }

  private processBuffer(server: ActiveServer): void {
    // MCP uses newline-delimited JSON-RPC
    const lines = server.buffer.split("\n");
    // Keep the last incomplete line in the buffer
    server.buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const message = JSON.parse(trimmed) as JsonRpcResponse;
        this.handleResponse(server, message);
      } catch {
        // Not valid JSON; might be a log line from the server
        console.warn(`[mcp:${server.config.name}] Non-JSON output: ${trimmed}`);
      }
    }
  }

  private handleResponse(server: ActiveServer, message: JsonRpcResponse): void {
    // Notifications from the server (no id)
    if (message.id === null || message.id === undefined) {
      this.emit("server_notification", {
        name: server.config.name,
        message,
      });
      return;
    }

    const pending = server.pendingRequests.get(message.id);
    if (!pending) {
      console.warn(
        `[mcp:${server.config.name}] Unexpected response id=${String(message.id)}`
      );
      return;
    }

    server.pendingRequests.delete(message.id);

    if (message.error) {
      pending.reject(
        new Error(`MCP error ${message.error.code}: ${message.error.message}`)
      );
    } else {
      pending.resolve(message.result);
    }
  }
}

// ── Singleton export ─────────────────────────────────────────

// Use randomUUID just to suppress the unused import warning if needed;
// it is available for future request id generation.
void randomUUID;

export const mcpManager = new McpManager();
