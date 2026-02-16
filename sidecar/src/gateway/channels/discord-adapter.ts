/**
 * Discord channel adapter — uses discord.js with WebSocket gateway mode.
 *
 * Connects outbound via WebSocket (no inbound HTTP needed for Discord).
 * Registers slash commands (/run, /list, /status) via Discord's API.
 */

import { EventEmitter } from "events";
import type { ChannelConfig, ChannelStatus, InboundMessage, GatewayLogEntry } from "../types.js";
import type { MessageBus } from "./message-bus.js";

// Dynamic imports
let DiscordModule: typeof import("discord.js") | null = null;

type DiscordClient = InstanceType<typeof import("discord.js").Client>;

export class DiscordAdapter extends EventEmitter {
  private client: DiscordClient | null = null;
  private _status: ChannelStatus = {
    type: "discord",
    state: "stopped",
    botUsername: null,
    error: null,
  };
  private messageBus: MessageBus;

  constructor(messageBus: MessageBus) {
    super();
    this.messageBus = messageBus;
  }

  getStatus(): ChannelStatus {
    return { ...this._status };
  }

  async start(config: ChannelConfig): Promise<void> {
    if (this.client) {
      await this.stop();
    }

    if (!DiscordModule) {
      DiscordModule = await import("discord.js");
    }

    this.setState("connecting");
    this.log("info", "Starting Discord bot...");

    try {
      const {
        Client,
        GatewayIntentBits,
        Events,
        REST,
        Routes,
        SlashCommandBuilder,
      } = DiscordModule;

      this.client = new Client({
        intents: [GatewayIntentBits.Guilds],
      });

      // ── Slash command registration ──────────────────────────────
      const commands = [
        new SlashCommandBuilder()
          .setName("run")
          .setDescription("Execute an ArchonIDE flow")
          .addStringOption((opt) =>
            opt.setName("flow").setDescription("Name of the flow to run").setRequired(true),
          )
          .addStringOption((opt) =>
            opt.setName("input").setDescription("Input text for the flow").setRequired(false),
          ),
        new SlashCommandBuilder()
          .setName("list")
          .setDescription("List available ArchonIDE flows"),
        new SlashCommandBuilder()
          .setName("status")
          .setDescription("Show ArchonIDE gateway status"),
      ];

      const rest = new REST({ version: "10" }).setToken(config.botToken);

      // Register commands globally (takes up to 1 hour to propagate)
      // For faster testing, register per-guild instead
      this.client.once(Events.ClientReady, async (readyClient) => {
        this._status.botUsername = readyClient.user.tag;
        this.setState("connected");
        this.log("info", `Discord bot ${readyClient.user.tag} connected`);

        // Register slash commands
        try {
          await rest.put(
            Routes.applicationCommands(readyClient.user.id),
            { body: commands.map((c) => c.toJSON()) },
          );
          this.log("info", "Slash commands registered with Discord");
        } catch (err) {
          this.log("warn", `Failed to register slash commands: ${err instanceof Error ? err.message : String(err)}`);
        }
      });

      // ── Interaction handler (slash commands) ────────────────────
      this.client.on(Events.InteractionCreate, async (interaction) => {
        if (!interaction.isChatInputCommand()) return;

        const commandName = interaction.commandName;
        let text: string;

        switch (commandName) {
          case "run": {
            const flowName = interaction.options.getString("flow", true);
            const input = interaction.options.getString("input") ?? "";
            text = `/run ${flowName} ${input}`.trim();
            break;
          }
          case "list":
            text = "/list";
            break;
          case "status":
            text = "/status";
            break;
          default:
            return;
        }

        // Defer the reply so we have time to process
        await interaction.deferReply();

        const message: InboundMessage = {
          channelType: "discord",
          channelId: interaction.channelId,
          senderId: interaction.user.id,
          senderName: interaction.user.displayName ?? interaction.user.username,
          text,
          metadata: {
            guildId: interaction.guildId,
            interactionId: interaction.id,
          },
          replyTo: async (replyText: string) => {
            // Split long messages (Discord limit: 2000 chars)
            const chunks = splitMessage(replyText, 2000);
            try {
              // Edit the deferred reply with the first chunk
              await interaction.editReply(chunks[0]);
              // Send additional chunks as follow-ups
              for (let i = 1; i < chunks.length; i++) {
                await interaction.followUp(chunks[i]);
              }
            } catch (err) {
              this.log("warn", `Failed to reply to Discord interaction: ${err instanceof Error ? err.message : String(err)}`);
            }
          },
        };

        await this.messageBus.processMessage(message);
      });

      // ── Error handling ──────────────────────────────────────────
      this.client.on(Events.Error, (err) => {
        this.log("error", `Discord client error: ${err.message}`);
      });

      // Login
      await this.client.login(config.botToken);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this._status.error = errorMessage;
      this.setState("error");
      this.log("error", `Discord bot failed to start: ${errorMessage}`);
      throw err;
    }
  }

  async stop(): Promise<void> {
    if (this.client) {
      try {
        this.client.destroy();
      } catch {
        // Best effort
      }
      this.client = null;
    }

    this._status.botUsername = null;
    this._status.error = null;
    this.setState("stopped");
    this.log("info", "Discord bot stopped");
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
      message: `[discord] ${message}`,
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
    let splitAt = remaining.lastIndexOf("\n", maxLength);
    if (splitAt <= 0) splitAt = maxLength;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).replace(/^\n/, "");
  }
  return chunks;
}
