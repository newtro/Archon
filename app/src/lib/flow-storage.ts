import type { FlowDefinition } from "./flow-types";
import { GENERAL_CODING_ASSISTANT } from "./default-flows";
import { getDb, registerSchema } from "./db";
import type Database from "@tauri-apps/plugin-sql";

async function initFlowSchema(db: Database): Promise<void> {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS flows (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      data TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  // Seed the default flow if no flows exist
  const count = await db.select<Array<{ cnt: number }>>("SELECT COUNT(*) as cnt FROM flows");
  if (count[0].cnt === 0) {
    const data = JSON.stringify(GENERAL_CODING_ASSISTANT);
    await db.execute(
      "INSERT INTO flows (id, name, description, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      [
        GENERAL_CODING_ASSISTANT.id,
        GENERAL_CODING_ASSISTANT.name,
        GENERAL_CODING_ASSISTANT.description,
        data,
        GENERAL_CODING_ASSISTANT.createdAt,
        GENERAL_CODING_ASSISTANT.updatedAt,
      ]
    );
  }
}

registerSchema(initFlowSchema);

export async function listFlows(): Promise<Array<{ id: string; name: string; description: string; updatedAt: number }>> {
  const database = await getDb();
  const rows = await database.select<Array<{ id: string; name: string; description: string; updated_at: number }>>(
    "SELECT id, name, description, updated_at FROM flows ORDER BY updated_at DESC"
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    updatedAt: r.updated_at,
  }));
}

/** Migrate old flow data formats to current schema. */
function migrateFlow(flow: FlowDefinition): FlowDefinition {
  for (const node of flow.nodes) {
    // Migrate intent classifications from string[] to Array<{ name, instructions }>
    if (node.config.kind === "intent") {
      const cfg = node.config.config as unknown as Record<string, unknown>;
      if (Array.isArray(cfg.classifications) && cfg.classifications.length > 0 && typeof cfg.classifications[0] === "string") {
        cfg.classifications = (cfg.classifications as string[]).map((name) => ({
          name,
          instructions: "",
        }));
      }
    }
  }
  return flow;
}

export async function loadFlow(id: string): Promise<FlowDefinition | null> {
  const database = await getDb();
  const rows = await database.select<Array<{ data: string }>>(
    "SELECT data FROM flows WHERE id = ?",
    [id]
  );
  if (rows.length === 0) return null;
  return migrateFlow(JSON.parse(rows[0].data) as FlowDefinition);
}

export async function saveFlow(flow: FlowDefinition): Promise<void> {
  const database = await getDb();
  const data = JSON.stringify(flow);
  await database.execute(
    `INSERT INTO flows (id, name, description, data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       description = excluded.description,
       data = excluded.data,
       updated_at = excluded.updated_at`,
    [flow.id, flow.name, flow.description, data, flow.createdAt, flow.updatedAt]
  );
}

export async function deleteFlow(id: string): Promise<void> {
  const database = await getDb();
  await database.execute("DELETE FROM flows WHERE id = ?", [id]);
}

export async function createFlow(name: string, description: string): Promise<FlowDefinition> {
  const now = Date.now();
  const flow: FlowDefinition = {
    id: crypto.randomUUID(),
    name,
    description,
    nodes: [
      {
        id: "start_1",
        kind: "start",
        label: "Start",
        x: 300,
        y: 50,
        config: { kind: "start", config: {} },
      },
      {
        id: "end_1",
        kind: "end",
        label: "End",
        x: 300,
        y: 400,
        config: { kind: "end", config: {} },
      },
    ],
    edges: [],
    createdAt: now,
    updatedAt: now,
  };
  await saveFlow(flow);
  return flow;
}
