# ArchonIDE Agnostic Tunnel & Multi-Channel Gateway

## Vision

Extend ArchonIDE into a GUI-first alternative to CLI-based personal AI agent frameworks (PicoClaw, ZeroClaw, OpenClaw) by adding an **agnostic tunnel** and **multi-channel gateway**. This turns ArchonIDE from a local-only IDE into a reachable endpoint — DevOps pipelines can trigger flows via webhooks, and users can interact with their agent through Telegram or Discord instead of (or in addition to) the built-in chat panel.

The key differentiator: everything is managed through the desktop GUI. No config files, no CLI flags, no YAML. Point-and-click tunnel setup, visual webhook management, and a real-time gateway dashboard.

## Problem Statement

Existing "claw" frameworks (PicoClaw, ZeroClaw) are powerful but require terminal fluency:
- **PicoClaw** (Go) has no built-in tunnel — users must manually configure ngrok for webhooks.
- **ZeroClaw** (Rust) has an excellent agnostic tunnel trait, but configuration is TOML files and CLI commands.
- Neither provides a visual interface for managing tunnels, webhooks, or channel integrations.

For developers who live in an IDE, these tools create unnecessary friction. ArchonIDE can absorb the best architectural ideas (ZeroClaw's pluggable tunnel trait, PicoClaw's channel abstraction) while delivering them through a desktop-native experience.

## Goals

1. **Agnostic tunnel system** — pluggable tunnel providers (Cloudflare, ngrok, custom) managed through the GUI, exposing a local HTTP gateway to the public internet.
2. **Generic webhook endpoints** — URL-based routing where each flow with a Webhook Trigger node gets a unique endpoint. Any system that can POST JSON (Azure DevOps, GitHub, GitLab, Jenkins, etc.) can trigger a flow.
3. **Webhook response builder** — Flows can construct and return structured JSON responses to webhook callers (deployment approvals, PR comments, status data).
4. **Multi-channel chat** — Telegram and Discord bots as alternative frontends, with user-selectable flow invocation via slash commands.
5. **Gateway dashboard** — Dedicated sidebar tab with tunnel health monitoring, webhook management, channel setup, connection logs, and a built-in webhook testing playground.
6. **System tray mode** — Minimize ArchonIDE to the system tray so the gateway stays alive in the background.

## Non-Goals

- **No cloud hosting** — This is desktop-only. No hosted SaaS, no cloud relay, no always-on server.
- **No mobile companion app** — No remote management from a phone.
- **No multi-user/team features** — Single user, single machine. No shared webhook management or org-level configuration.
- **No platform-specific webhook integrations** — MVP uses generic webhooks. Platform-specific parsing (GitHub signature verification, Azure DevOps service hook schemas) can layer on later.

## Architecture Overview

```
                        INTERNET
                           |
                    [Tunnel Provider]
                  (Cloudflare / ngrok / custom)
                           |
                      HTTPS URL
                           |
              +---------------------------+
              |   Fastify HTTP Gateway    |
              |   (127.0.0.1:PORT)        |
              +---------------------------+
              |                           |
     /webhooks/<flow-id>/<token>    /channels/telegram
     /webhooks/...                  /channels/discord
              |                           |
        Webhook Router              Channel Adapters
              |                    (Telegraf, discord.js)
              |                           |
              +------ Message Bus --------+
                           |
                    Flow Executor
                   (existing sidecar)
                           |
                   Flow Response
                           |
              +------ Message Bus --------+
              |                           |
        Webhook Response            Channel Reply
        (JSON to caller)         (Telegram/Discord msg)
```

**All gateway logic lives in the Node.js sidecar** (extends the existing agent runtime on port 9399). Rationale:
- The gateway triggers flows, and flows execute in the sidecar — same-process, zero IPC overhead.
- Node.js is purpose-built for HTTP servers, WebSocket connections, and event-driven I/O.
- Mature ecosystem: Fastify, discord.js, Telegraf are battle-tested.
- Preserves the clean two-process model: sidecar = all backend logic, Tauri = UI shell.
- Hot-reloads via `tsx watch` — development iteration stays fast.

## Components

### 1. Tunnel Manager

A pluggable subsystem (inspired by ZeroClaw's `Tunnel` trait) that wraps external tunnel binaries.

**Interface:**
```typescript
interface TunnelProvider {
  name: string;
  start(localHost: string, localPort: number): Promise<string>; // returns public URL
  stop(): Promise<void>;
  healthCheck(): Promise<boolean>;
  publicUrl(): string | null;
}
```

**Providers:**

| Provider | Implementation | Notes |
|----------|---------------|-------|
| **Cloudflare** | `cloudflared` npm package (auto-installs binary) | Free, production-grade. Requires Cloudflare account + tunnel token. |
| **ngrok** | `@ngrok/ngrok` v1.7.0 (official SDK, no binary needed) | Simple setup, free tier. Programmatic API — no binary spawning required. |
| **Custom** | User-specified command with `{host}` and `{port}` placeholders | Supports bore, frp, ssh tunnels, or any custom binary. Parsed via regex for public URL. |

**Behavior:**
- Each provider can be independently configured to auto-start on app launch or require manual start.
- Tunnel binds the gateway to `127.0.0.1` only — the tunnel handles external exposure.
- Health checks run on interval; auto-reconnect with exponential backoff on failure.
- Toast notifications when tunnel drops or recovers.
- All tunnel credentials stored encrypted via `tauri-plugin-store`.

### 2. HTTP Gateway (Fastify)

A Fastify server running inside the sidecar, bound to `127.0.0.1` on a configurable port.

**Routes:**
- `POST /webhooks/:flowId/:token` — Webhook endpoints (one per flow)
- `POST /channels/telegram` — Telegram webhook callback
- `POST /channels/discord` — Discord interactions endpoint (if using webhook mode)
- `GET /health` — Gateway health check
- `GET /status` — Returns tunnel status, active channels, registered webhooks

**Security:**
- Bearer token authentication on webhook endpoints (unique per flow, generated in GUI)
- Rate limiting on all endpoints (configurable per-endpoint)
- Platform-native auth for channels:
  - Telegram: secret token verification via Telegraf
  - Discord: Ed25519 signature verification on interaction endpoints
- Connection log visible in the Gateway dashboard

### 3. Webhook System

**URL-based routing (n8n model):**
- Each flow with a Webhook Trigger node gets a unique endpoint: `/webhooks/<flow-id>/<token>`
- The URL determines the flow; the POST body becomes the trigger node's input data
- Tokens are randomly generated, unique per flow, and can be regenerated from the GUI

**Webhook Response Builder:**
- A new flow node type ("Webhook Response") that constructs the HTTP response sent back to the webhook caller
- Supports setting status code, headers, and JSON body
- Enables bidirectional webhook workflows (e.g., receive a deployment request, process it, return approval/rejection)
- If no response node exists in the flow, returns `202 Accepted` with a default acknowledgment

**Webhook Testing Playground:**
- Built into the Gateway sidebar tab
- Select an endpoint, compose a test payload (JSON editor), send it, and watch the flow execute in real-time
- Shows request headers, response body, status code, and execution time
- Like a mini Postman embedded in the IDE

### 4. Channel Adapters

Normalized message adapters that convert platform-specific messages into a common format for the message bus.

**Common Message Format:**
```typescript
interface InboundMessage {
  channelType: 'telegram' | 'discord' | 'webhook';
  channelId: string;
  senderId: string;
  senderName: string;
  text: string;
  metadata: Record<string, unknown>; // platform-specific data
  replyTo?: (text: string) => Promise<void>;
}
```

**Telegram Adapter (Telegraf v4):**
- Webhook mode integrated with the Fastify gateway via `bot.createWebhook()`
- Slash commands for flow selection: `/run <flow-name>`, `/list` (show available flows), `/status`
- Bot token configured in Gateway settings panel

**Discord Adapter (discord.js v14.25):**
- WebSocket gateway mode (bot connects outbound — no inbound HTTP needed for Discord)
- Slash commands registered via Discord's application commands API
- Commands: `/run <flow>`, `/list`, `/status`
- Bot token configured in Gateway settings panel

**QR Code Setup:**
- When configuring a bot, the GUI generates a QR code linking to the bot authorization URL
- Streamlines the setup flow — scan to add bot to a server/group

### 5. Gateway Dashboard (Frontend)

A dedicated sidebar tab in the ArchonIDE React frontend.

**Sections:**

| Section | Contents |
|---------|----------|
| **Tunnel Status** | Provider name, public URL (copyable), status indicator (green/yellow/red), latency, uptime, start/stop button |
| **Webhooks** | List of registered webhook endpoints with flow name, URL (copyable), token, enable/disable toggle, last triggered timestamp |
| **Channels** | Configured channels (Telegram, Discord) with connection status, bot username, enable/disable toggle |
| **Testing** | Webhook testing playground — endpoint selector, JSON payload editor, send button, response viewer |
| **Logs** | Scrollable connection log showing all inbound requests/messages with timestamp, source, status, and expandable details |

**Tunnel Health Monitor:**
- Visual indicator (traffic light) in the sidebar tab header and optionally in the IDE status bar
- Real-time latency display
- Auto-reconnect status ("Reconnecting in 5s...")
- Toast notifications on tunnel drop/recovery

### 6. System Tray

Uses Tauri v2's `tray-icon` feature (formerly `system-tray`).

**Behavior:**
- When user closes the main window (or clicks "Minimize to Tray"), the app hides the window and shows a tray icon
- Tray icon context menu: "Open ArchonIDE", "Tunnel: Connected (https://...)", "Stop Gateway", "Quit"
- Left-click on tray icon: restore and focus the main window
- The sidecar and gateway continue running while minimized to tray
- Configurable: user can choose whether closing the window minimizes to tray or quits the app

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Architecture | Extend Node.js sidecar | Same-process flow execution, zero IPC, mature ecosystem |
| HTTP Framework | Fastify | Fast, plugin-oriented, TypeScript-first, low overhead |
| Tunnel Providers | Cloudflare + ngrok + custom | Covers production-grade, easy setup, and power users |
| Webhook Routing | URL-based (n8n model) | Industry standard, zero-config, per-flow isolation |
| Chat Platforms | Telegram + Discord | Well-documented APIs, webhook support, large user base |
| Chat Routing | User-selectable (slash commands) | Explicit, predictable, no AI routing needed for MVP |
| Security | Bearer tokens + platform-native auth | Universal for webhooks, robust for channels |
| Availability | System tray mode | Gateway persists without full IDE window |
| GUI Placement | Dedicated sidebar tab | Full dashboard without cluttering existing panels |

## Tech Stack

| Package | Version | Purpose | Notes |
|---------|---------|---------|-------|
| `fastify` | ^5.x (latest) | HTTP gateway server | Fast, low overhead, excellent plugin system |
| `@ngrok/ngrok` | ^1.7.0 | ngrok tunnel (official SDK) | Programmatic API, no binary spawning needed |
| `cloudflared` | latest | Cloudflare tunnel | Auto-installs cloudflared binary, EventEmitter API |
| `telegraf` | ^4.x | Telegram bot framework | Webhook mode, Express/Fastify middleware integration |
| `discord.js` | ^14.25.x | Discord bot library | WebSocket gateway, slash commands, interactions API |
| `tauri-plugin-tray-icon` | (Tauri v2 built-in) | System tray | Renamed from `system-tray` in v2 |
| `tauri-plugin-store` | (existing) | Encrypted credential storage | Already used for API keys |
| `@xyflow/react` | ^12.x (existing) | Flow canvas | New node types: Webhook Trigger, Webhook Response |

## Implementation Phases

### Phase 3A: Tunnel & Gateway Foundation
_Depends on: Phase 2 (Flow Designer) — COMPLETE_

1. **Fastify HTTP server** in the sidecar — bind to `127.0.0.1`, health endpoint, basic routing
2. **Tunnel Manager** — `TunnelProvider` interface, ngrok implementation (simplest first), start/stop lifecycle
3. **Webhook system** — URL-based routing, bearer token auth, flow triggering, `202 Accepted` default response
4. **Gateway sidebar tab** (frontend) — tunnel status, webhook list with copyable URLs, start/stop controls
5. **Frontend-sidecar communication** — WebSocket messages for tunnel status, webhook events

### Phase 3B: Channel Adapters & Chat
1. **Telegram adapter** — Telegraf webhook integration with Fastify, slash commands, message normalization
2. **Discord adapter** — discord.js WebSocket bot, slash command registration, message normalization
3. **Message bus** — `InboundMessage` / `OutboundMessage` types, routing to flows, response delivery
4. **Channel configuration UI** — bot token input, QR code generation, enable/disable toggles
5. **Chat routing** — `/run`, `/list`, `/status` commands in both platforms

### Phase 3C: Advanced Features
1. **Cloudflare tunnel provider** — `cloudflared` npm package integration
2. **Custom tunnel provider** — command template with `{host}/{port}` placeholders, URL regex extraction
3. **Webhook Response node** — new flow node type for constructing HTTP responses
4. **Webhook testing playground** — JSON editor, send test payloads, view responses
5. **System tray** — minimize to tray, context menu, window restore, configurable close behavior
6. **Tunnel health monitor** — latency tracking, auto-reconnect, toast notifications
7. **Connection logs** — scrollable log viewer with filters, expandable request/response details

### Phase 3D: Polish
1. **Per-tunnel auto-start settings**
2. **Rate limiting configuration UI**
3. **Token regeneration and endpoint enable/disable**
4. **Error handling and edge cases** (tunnel drops mid-request, flow execution timeout, etc.)
5. **Documentation and onboarding flow** (first-time setup wizard for tunnel + bot)

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Tunnel drops mid-request | Webhook callers get timeout errors | Auto-reconnect with exponential backoff; health checks every 10s; toast notifications |
| Desktop goes to sleep | Gateway becomes unreachable | System tray mode keeps app running; document limitation for sleep/shutdown |
| Security — exposed endpoint | Unauthorized access to local flows | Bearer tokens, rate limiting, localhost-only binding, encrypted credential storage |
| ngrok free tier limits | 1 tunnel, rate-limited, rotating URLs | Cloudflare tunnel as free alternative with stable URLs; custom provider escape hatch |
| Sidecar complexity growth | Harder to maintain | Clean module separation: `gateway/`, `tunnel/`, `channels/` directories in sidecar |
| Discord bot approval process | Discord requires verification for 100+ servers | Single-user focus — personal bot, no public distribution needed |

## Open Questions

1. **Gateway port selection** — Should the Fastify gateway run on a separate port from the existing WebSocket server (9399), or can they coexist? Likely separate port (e.g., 9400) for clarity.
2. **Flow execution model** — Phase 3 (Flow Execution Engine) is not yet started. The webhook/channel system depends on being able to programmatically trigger a flow and get its output. This is the critical dependency.
3. **Webhook payload schema** — Should we define a standard envelope format for webhook payloads, or pass through the raw JSON body as-is to the flow? Raw passthrough is simpler; envelope format enables metadata (source, timestamp, signature).
4. **Discord bot mode** — WebSocket gateway (outbound, no tunnel needed for Discord) vs. Interactions endpoint (inbound, requires tunnel). WebSocket is simpler and doesn't require the tunnel for Discord specifically.
5. **Multiple simultaneous tunnels** — Should we support running multiple tunnel providers at once (e.g., ngrok for dev, Cloudflare for production), or one at a time?
