/**
 * MessageBus — normalizes messages from all channels (Telegram, Discord, webhooks)
 * into a common InboundMessage format and routes them to the appropriate flow.
 *
 * Supports slash commands for flow selection:
 *   /run <flow-name>   — execute a specific flow
 *   /list              — list available flows
 *   /status            — show gateway status
 */

import { EventEmitter } from "events";
import type { InboundMessage, GatewayLogEntry } from "../types.js";

export interface FlowInfo {
  id: string;
  name: string;
}

export interface MessageBusOptions {
  /** Callback to get available flows */
  getFlows: () => FlowInfo[];
  /** Callback to execute a flow with input */
  executeFlow: (flowId: string, input: string, replyTo?: (text: string) => Promise<void>) => void;
  /** Callback to get gateway status summary */
  getStatusSummary: () => string;
}

export class MessageBus extends EventEmitter {
  private options: MessageBusOptions;

  constructor(options: MessageBusOptions) {
    super();
    this.options = options;
  }

  /**
   * Process an inbound message from any channel.
   * Handles slash commands or routes to the default/specified flow.
   */
  async processMessage(message: InboundMessage): Promise<void> {
    const text = message.text.trim();

    this.log("info", `[${message.channelType}] ${message.senderName}: ${text.slice(0, 100)}`);

    // Handle slash commands
    if (text.startsWith("/")) {
      await this.handleCommand(message);
      return;
    }

    // No slash command — send a hint
    if (message.replyTo) {
      const flows = this.options.getFlows();
      if (flows.length === 0) {
        await message.replyTo("No flows available. Create a flow in ArchonIDE first.");
      } else {
        await message.replyTo(
          `Use /run <flow-name> to execute a flow, or /list to see available flows.`,
        );
      }
    }
  }

  private async handleCommand(message: InboundMessage): Promise<void> {
    const text = message.text.trim();
    const parts = text.split(/\s+/);
    const command = parts[0].toLowerCase();
    const args = parts.slice(1).join(" ");

    switch (command) {
      case "/run":
        await this.handleRunCommand(message, args);
        break;

      case "/list":
        await this.handleListCommand(message);
        break;

      case "/status":
        await this.handleStatusCommand(message);
        break;

      case "/help":
        await this.handleHelpCommand(message);
        break;

      default:
        if (message.replyTo) {
          await message.replyTo(
            `Unknown command: ${command}\nAvailable: /run, /list, /status, /help`,
          );
        }
        break;
    }
  }

  private async handleRunCommand(message: InboundMessage, flowName: string): Promise<void> {
    if (!flowName) {
      if (message.replyTo) {
        const flows = this.options.getFlows();
        const names = flows.map((f) => `  - ${f.name}`).join("\n");
        await message.replyTo(
          `Usage: /run <flow-name> [input]\n\nAvailable flows:\n${names || "  (none)"}`,
        );
      }
      return;
    }

    // Parse: /run FlowName some input text
    // The flow name might be multi-word, so match against known flows
    const flows = this.options.getFlows();
    let matchedFlow: FlowInfo | undefined;
    let input = "";

    // Try exact match first
    matchedFlow = flows.find(
      (f) => f.name.toLowerCase() === flowName.toLowerCase(),
    );

    if (!matchedFlow) {
      // Try prefix match: find the longest flow name that matches the start
      const sorted = [...flows].sort((a, b) => b.name.length - a.name.length);
      for (const flow of sorted) {
        if (flowName.toLowerCase().startsWith(flow.name.toLowerCase())) {
          matchedFlow = flow;
          input = flowName.slice(flow.name.length).trim();
          break;
        }
      }
    }

    if (!matchedFlow) {
      // Fuzzy: try case-insensitive contains
      matchedFlow = flows.find(
        (f) => f.name.toLowerCase().includes(flowName.toLowerCase()),
      );
    }

    if (!matchedFlow) {
      if (message.replyTo) {
        await message.replyTo(
          `Flow not found: "${flowName}"\nUse /list to see available flows.`,
        );
      }
      return;
    }

    if (!input) {
      input = flowName.slice(matchedFlow.name.length).trim() || message.text;
    }

    if (message.replyTo) {
      await message.replyTo(`Running flow: ${matchedFlow.name}...`);
    }

    this.log("info", `Executing flow "${matchedFlow.name}" from ${message.channelType}`);

    this.options.executeFlow(matchedFlow.id, input, message.replyTo);
  }

  private async handleListCommand(message: InboundMessage): Promise<void> {
    if (!message.replyTo) return;

    const flows = this.options.getFlows();
    if (flows.length === 0) {
      await message.replyTo("No flows available. Create a flow in ArchonIDE first.");
      return;
    }

    const list = flows.map((f) => `  - ${f.name}`).join("\n");
    await message.replyTo(`Available flows:\n${list}\n\nUse /run <flow-name> to execute.`);
  }

  private async handleStatusCommand(message: InboundMessage): Promise<void> {
    if (!message.replyTo) return;
    const summary = this.options.getStatusSummary();
    await message.replyTo(summary);
  }

  private async handleHelpCommand(message: InboundMessage): Promise<void> {
    if (!message.replyTo) return;
    await message.replyTo(
      [
        "ArchonIDE Gateway - Commands:",
        "",
        "/run <flow-name> [input] - Execute a flow",
        "/list - List available flows",
        "/status - Show gateway status",
        "/help - Show this message",
      ].join("\n"),
    );
  }

  private log(level: GatewayLogEntry["level"], message: string): void {
    this.emit("log", {
      timestamp: new Date().toISOString(),
      level,
      source: "channel" as const,
      message,
    } satisfies GatewayLogEntry);
  }
}
