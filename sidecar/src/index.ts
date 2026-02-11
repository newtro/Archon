import { WebSocketServer, WebSocket } from "ws";
import { execSync } from "child_process";
import { createConnection } from "net";
import { handleMessage } from "./agent.js";

const PORT = 9399;

/** Check if a port is in use, and kill the occupying process if so. */
async function freePort(port: number): Promise<void> {
  const inUse = await new Promise<boolean>((resolve) => {
    const sock = createConnection({ port }, () => {
      sock.end();
      resolve(true);
    });
    sock.on("error", () => resolve(false));
  });

  if (!inUse) return;

  console.log(`[sidecar] Port ${port} in use — killing old process...`);
  try {
    if (process.platform === "win32") {
      // Find PID listening on the port and kill it
      const out = execSync(`netstat -ano | findstr :${port} | findstr LISTENING`, { encoding: "utf8" });
      const pids = new Set(
        out.split("\n").map((l) => l.trim().split(/\s+/).pop()).filter(Boolean)
      );
      for (const pid of pids) {
        try { execSync(`taskkill /F /PID ${pid}`, { stdio: "ignore" }); } catch {}
      }
    } else {
      execSync(`lsof -ti:${port} | xargs kill -9`, { stdio: "ignore" });
    }
    // Brief pause for OS to release the port
    await new Promise((r) => setTimeout(r, 500));
    console.log(`[sidecar] Port ${port} freed`);
  } catch {
    console.warn(`[sidecar] Could not free port ${port} — will attempt to bind anyway`);
  }
}

async function start() {
  await freePort(PORT);

  const wss = new WebSocketServer({ port: PORT });

  console.log(`[sidecar] WebSocket server starting on port ${PORT}`);

  wss.on("listening", () => {
    console.log(`[sidecar] Ready on ws://localhost:${PORT}`);
  });

  wss.on("connection", (ws: WebSocket) => {
    console.log("[sidecar] Client connected");

    ws.on("message", async (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        await handleMessage(ws, message);
      } catch (err) {
        console.error("[sidecar] Error handling message:", err);
        ws.send(
          JSON.stringify({
            type: "error",
            message: err instanceof Error ? err.message : "Unknown error",
          })
        );
      }
    });

    ws.on("close", () => {
      console.log("[sidecar] Client disconnected");
    });

    ws.on("error", (err: Error) => {
      console.error("[sidecar] WebSocket error:", err);
    });

    ws.send(JSON.stringify({ type: "status", status: "ready" }));
  });

  wss.on("error", (err: Error) => {
    console.error("[sidecar] Server error:", err);
    process.exit(1);
  });

  process.on("SIGINT", () => {
    console.log("[sidecar] Shutting down...");
    wss.close();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    console.log("[sidecar] Shutting down...");
    wss.close();
    process.exit(0);
  });
}

start();
