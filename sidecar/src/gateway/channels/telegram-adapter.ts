/**
 * Telegram channel adapter — uses Telegraf in webhook mode.
 *
 * Integrates with the Fastify HTTP gateway via `bot.createWebhook()`.
 * Supports slash commands (/run, /list, /status) for flow invocation.
 */

import { EventEmitter } from "events";
import type { ChannelConfig, ChannelStatus, InboundMessage, GatewayLogEntry } from "../types.js";
import type { MessageBus } from "./message-bus.js";

// Dynamic import to avoid top-level dependency
let TelegrafModule: typeof import("telegraf") | null = null;

type TelegrafBot = InstanceType<typeof import("telegraf").Telegraf>;

export class TelegramAdapter extends EventEmitter {
  private bot: TelegrafBot | null = null;
  private _status: ChannelStatus = {
    type: "telegram",
    state: "stopped",
    botUsername: null,
    error: null,
  };
  private messageBus: MessageBus;
  private webhookPath: string = "/channels/telegram";

  constructor(messageBus: MessageBus) {
    super();
    this.messageBus = messageBus;
  }

  getStatus(): ChannelStatus {
    return { ...this._status };
  }

  /**
   * Start the Telegram bot in webhook mode.
   * The webhook callback is returned for integration with the Fastify gateway.
   */
  async start(
    config: ChannelConfig,
    publicUrl: string | null,
  ): Promise<{
    webhookCallback: (request: unknown, reply: unknown) => Promise<void>;
    webhookPath: string;
  }> {
    if (this.bot) {
      await this.stop();
    }

    if (!TelegrafModule) {
      TelegrafModule = await import("telegraf");
    }

    this.setState("connecting");
    this.log("info", "Starting Telegram bot...");

    try {
      const { Telegraf } = TelegrafModule;
      this.bot = new Telegraf(config.botToken);

      // Register message handler
      this.bot.on("text", async (ctx) => {
        const message: InboundMessage = {
          channelType: "telegram",
          channelId: String(ctx.chat.id),
          senderId: String(ctx.from.id),
          senderName: ctx.from.first_name + (ctx.from.last_name ? ` ${ctx.from.last_name}` : ""),
          text: ctx.message.text,
          metadata: {
            chatType: ctx.chat.type,
            messageId: ctx.message.message_id,
            username: ctx.from.username,
          },
          replyTo: async (text: string) => {
            // Split long messages (Telegram limit: 4096 chars)
            const chunks = splitMessage(text, 4096);
            for (const chunk of chunks) {
              await ctx.reply(chunk);
            }
          },
        };

        await this.messageBus.processMessage(message);
      });

      // Get bot info for status display
      const botInfo = await this.bot.telegram.getMe();
      this._status.botUsername = botInfo.username ?? null;

      // Create webhook callback for Fastify integration
      let webhookCallback: (request: unknown, reply: unknown) => Promise<void>;

      if (publicUrl) {
        const domain = publicUrl.replace(/^https?:\/\//, "");
        const secretToken = generateSecretToken();

        // Use createWebhook which sets the webhook URL with Telegram AND returns middleware
        const handler = await this.bot.createWebhook({
          domain,
          path: this.webhookPath,
          secret_token: secretToken,
        });

        webhookCallback = handler as unknown as (request: unknown, reply: unknown) => Promise<void>;

        this.log("info", `Telegram webhook set to ${publicUrl}${this.webhookPath}`);
      } else {
        // No public URL — set up webhook handler without registering with Telegram
        // This allows local testing via the webhook testing playground
        webhookCallback = async (request: unknown, reply: unknown) => {
          // Manual webhook handling for local testing
          const req = request as { body?: unknown };
          if (req.body) {
            await this.bot?.handleUpdate(req.body as Parameters<TelegrafBot["handleUpdate"]>[0]);
          }
          const rep = reply as { status: (code: number) => { send: (body: string) => void } };
          rep.status(200).send("ok");
        };

        this.log("warn", "No tunnel URL — Telegram webhooks will only work via local testing");
      }

      this.setState("connected");
      this.log("info", `Telegram bot @${this._status.botUsername} connected`);

      return { webhookCallback, webhookPath: this.webhookPath };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this._status.error = message;
      this.setState("error");
      this.log("error", `Telegram bot failed to start: ${message}`);
      throw err;
    }
  }

  async stop(): Promise<void> {
    if (this.bot) {
      try {
        // Remove webhook from Telegram
        await this.bot.telegram.deleteWebhook();
      } catch {
        // Best effort
      }
      this.bot = null;
    }

    this._status.botUsername = null;
    this._status.error = null;
    this.setState("stopped");
    this.log("info", "Telegram bot stopped");
  }

  private setState(state: ChannelStatus["state"]): void {
    this._status.state = state;
    this.emit("status", this.getStatus());
  }

  private log(level: GatewayLogEntry["level"], message: string): void {
    this.emit("log", {
      timestamp: new Date().toISOString(),
      level,
      source: "channel",
      message: `[telegram] ${message}`,
    } satisfies GatewayLogEntry);
  }
}

/** Split a long message into chunks respecting a max length */
function splitMessage(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }
    // Try to split at a newline
    let splitAt = remaining.lastIndexOf("\n", maxLength);
    if (splitAt <= 0) splitAt = maxLength;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).replace(/^\n/, "");
  }
  return chunks;
}

/** Generate a random secret token for Telegram webhook verification */
function generateSecretToken(): string {
  const { randomBytes } = require("crypto") as typeof import("crypto");
  return randomBytes(32).toString("hex");
}
