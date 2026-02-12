import type Database from "@tauri-apps/plugin-sql";
import { getDb, registerSchema } from "./db";
import type { ChatMessage, ChatSession } from "./types";

async function initChatSchema(db: Database): Promise<void> {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      model TEXT,
      tokens_in INTEGER,
      tokens_out INTEGER,
      cost_usd REAL,
      tool_calls TEXT,
      thinking TEXT,
      FOREIGN KEY(session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
    )
  `);
  // Migration: add images column for existing databases
  await db.execute("ALTER TABLE chat_messages ADD COLUMN images TEXT").catch(() => {});
}

registerSchema(initChatSchema);

// ── Sessions ────────────────────────────────────────────────────

export async function listSessions(limit = 30): Promise<ChatSession[]> {
  const db = await getDb();
  const rows = await db.select<Array<{
    id: string;
    title: string;
    created_at: number;
    updated_at: number;
    message_count: number;
    preview: string | null;
  }>>(
    `SELECT
       s.id, s.title, s.created_at, s.updated_at,
       COUNT(m.id) AS message_count,
       (SELECT content FROM chat_messages WHERE session_id = s.id AND role = 'user' ORDER BY timestamp ASC LIMIT 1) AS preview
     FROM chat_sessions s
     LEFT JOIN chat_messages m ON m.session_id = s.id
     GROUP BY s.id
     ORDER BY s.updated_at DESC
     LIMIT ?`,
    [limit],
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    messageCount: r.message_count,
    preview: r.preview ? r.preview.slice(0, 80) : undefined,
  }));
}

export async function createSession(firstMessage: string): Promise<string> {
  const db = await getDb();
  const id = crypto.randomUUID();
  const now = Date.now();
  const title = firstMessage.slice(0, 50).trim() || "New Chat";
  await db.execute(
    "INSERT INTO chat_sessions (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
    [id, title, now, now],
  );
  return id;
}

export async function updateSessionTimestamp(id: string): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE chat_sessions SET updated_at = ? WHERE id = ?", [Date.now(), id]);
}

export async function deleteSession(id: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM chat_messages WHERE session_id = ?", [id]);
  await db.execute("DELETE FROM chat_sessions WHERE id = ?", [id]);
}

// ── Messages ────────────────────────────────────────────────────

export async function saveMessage(sessionId: string, msg: ChatMessage): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO chat_messages (id, session_id, role, content, timestamp, model, tokens_in, tokens_out, cost_usd, tool_calls, thinking, images)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       content = excluded.content,
       tokens_in = excluded.tokens_in,
       tokens_out = excluded.tokens_out,
       cost_usd = excluded.cost_usd,
       tool_calls = excluded.tool_calls,
       thinking = excluded.thinking,
       images = excluded.images`,
    [
      msg.id,
      sessionId,
      msg.role,
      msg.content,
      msg.timestamp,
      msg.model ?? null,
      msg.tokensIn ?? null,
      msg.tokensOut ?? null,
      msg.costUsd ?? null,
      msg.toolCalls ? JSON.stringify(msg.toolCalls) : null,
      msg.thinking ? JSON.stringify(msg.thinking) : null,
      msg.images ? JSON.stringify(msg.images) : null,
    ],
  );
  await updateSessionTimestamp(sessionId);
}

export async function loadSessionMessages(sessionId: string): Promise<ChatMessage[]> {
  const db = await getDb();
  const rows = await db.select<Array<{
    id: string;
    role: string;
    content: string;
    timestamp: number;
    model: string | null;
    tokens_in: number | null;
    tokens_out: number | null;
    cost_usd: number | null;
    tool_calls: string | null;
    thinking: string | null;
    images: string | null;
  }>>(
    "SELECT * FROM chat_messages WHERE session_id = ? ORDER BY timestamp ASC",
    [sessionId],
  );
  return rows.map((r) => ({
    id: r.id,
    role: r.role as ChatMessage["role"],
    content: r.content,
    timestamp: r.timestamp,
    model: r.model ?? undefined,
    tokensIn: r.tokens_in ?? undefined,
    tokensOut: r.tokens_out ?? undefined,
    costUsd: r.cost_usd ?? undefined,
    toolCalls: r.tool_calls ? JSON.parse(r.tool_calls) : undefined,
    thinking: r.thinking ? JSON.parse(r.thinking) : undefined,
    images: r.images ? JSON.parse(r.images) : undefined,
  }));
}
