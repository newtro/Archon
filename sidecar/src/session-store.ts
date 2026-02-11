/**
 * Cross-session memory store.
 *
 * Persists session data (messages, flow state, timestamps) to JSON files
 * in ~/.archon/sessions/ so sessions survive sidecar restarts.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ── Types ────────────────────────────────────────────────────

export interface SessionMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
}

export interface SessionData {
  sessionId: string;
  taskDescription: string;
  messages: SessionMessage[];
  flowState?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

interface SessionIndex {
  sessions: Array<{
    sessionId: string;
    taskDescription: string;
    createdAt: number;
    updatedAt: number;
  }>;
}

// ── Store directory ──────────────────────────────────────────

const SESSIONS_DIR = path.join(os.homedir(), ".archon", "sessions");

function ensureDir(): void {
  if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  }
}

function sessionFilePath(sessionId: string): string {
  // Sanitize sessionId to prevent path traversal
  const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(SESSIONS_DIR, `${safe}.json`);
}

function indexFilePath(): string {
  return path.join(SESSIONS_DIR, "_index.json");
}

// ── Index management ─────────────────────────────────────────

function readIndex(): SessionIndex {
  const filePath = indexFilePath();
  if (!fs.existsSync(filePath)) {
    return { sessions: [] };
  }
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as SessionIndex;
  } catch {
    return { sessions: [] };
  }
}

function writeIndex(index: SessionIndex): void {
  ensureDir();
  fs.writeFileSync(indexFilePath(), JSON.stringify(index, null, 2), "utf-8");
}

function updateIndex(data: SessionData): void {
  const index = readIndex();
  const existing = index.sessions.findIndex((s) => s.sessionId === data.sessionId);

  const entry = {
    sessionId: data.sessionId,
    taskDescription: data.taskDescription,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };

  if (existing >= 0) {
    index.sessions[existing] = entry;
  } else {
    index.sessions.push(entry);
  }

  // Keep sorted by updatedAt descending
  index.sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  writeIndex(index);
}

function removeFromIndex(sessionId: string): void {
  const index = readIndex();
  index.sessions = index.sessions.filter((s) => s.sessionId !== sessionId);
  writeIndex(index);
}

// ── Public API ───────────────────────────────────────────────

/**
 * Save or update a session.
 */
export function saveSession(sessionId: string, data: SessionData): void {
  ensureDir();
  data.updatedAt = Date.now();
  fs.writeFileSync(sessionFilePath(sessionId), JSON.stringify(data, null, 2), "utf-8");
  updateIndex(data);
}

/**
 * Load a session by ID. Returns null if not found.
 */
export function loadSession(sessionId: string): SessionData | null {
  const filePath = sessionFilePath(sessionId);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as SessionData;
  } catch {
    return null;
  }
}

/**
 * Delete a session by ID.
 */
export function deleteSession(sessionId: string): void {
  const filePath = sessionFilePath(sessionId);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
  removeFromIndex(sessionId);
}

/**
 * List all sessions (metadata only, sorted by most recent first).
 */
export function listSessions(): Array<{
  sessionId: string;
  taskDescription: string;
  createdAt: number;
  updatedAt: number;
}> {
  return readIndex().sessions;
}

/**
 * Load the N most recent sessions (full data).
 */
export function loadRecentSessions(limit: number): SessionData[] {
  const index = readIndex();
  const recent = index.sessions.slice(0, limit);
  const results: SessionData[] = [];

  for (const entry of recent) {
    const session = loadSession(entry.sessionId);
    if (session) {
      results.push(session);
    }
  }

  return results;
}
