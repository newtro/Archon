import type { FlowDefinition, SerializedNode, SerializedEdge } from "./flow-types";
import { GENERAL_CODING_ASSISTANT } from "./default-flows";
import { getDb, registerSchema } from "./db";
import type Database from "@tauri-apps/plugin-sql";

/** Patch model for AI-driven flow updates */
export interface FlowPatch {
  name?: string;
  description?: string;
  addNodes?: SerializedNode[];
  updateNodes?: Array<{
    id: string;
    label?: string;
    config?: SerializedNode["config"];
  }>;
  removeNodeIds?: string[];
  addEdges?: SerializedEdge[];
  removeEdgeIds?: string[];
  contextAgentConfig?: FlowDefinition["contextAgentConfig"];
}

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
  await db.execute(`
    CREATE TABLE IF NOT EXISTS flow_versions (
      id TEXT PRIMARY KEY,
      flow_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      data TEXT NOT NULL,
      action TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
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

// ── Version history ──────────────────────────────────────────────

/** Save a version snapshot of a flow before mutation */
export async function saveFlowVersion(
  flowId: string,
  action: "create" | "update" | "delete",
  description: string,
  flowData?: FlowDefinition,
): Promise<void> {
  const database = await getDb();

  // Get the flow data if not provided
  let data: FlowDefinition | null = flowData ?? null;
  if (!data) {
    data = await loadFlow(flowId);
    if (!data) return; // nothing to snapshot
  }

  // Get next version number
  const rows = await database.select<Array<{ max_v: number | null }>>(
    "SELECT MAX(version) as max_v FROM flow_versions WHERE flow_id = ?",
    [flowId]
  );
  const nextVersion = (rows[0]?.max_v ?? 0) + 1;

  await database.execute(
    "INSERT INTO flow_versions (id, flow_id, version, data, action, description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [crypto.randomUUID(), flowId, nextVersion, JSON.stringify(data), action, description, Date.now()]
  );

  // Prune old versions (keep last 50)
  await database.execute(
    `DELETE FROM flow_versions WHERE flow_id = ? AND id NOT IN (
      SELECT id FROM flow_versions WHERE flow_id = ? ORDER BY version DESC LIMIT 50
    )`,
    [flowId, flowId]
  );
}

/** Get version history for a flow */
export async function getFlowVersions(flowId: string): Promise<Array<{
  id: string;
  version: number;
  action: string;
  description: string;
  createdAt: number;
}>> {
  const database = await getDb();
  const rows = await database.select<Array<{
    id: string;
    version: number;
    action: string;
    description: string;
    created_at: number;
  }>>(
    "SELECT id, version, action, description, created_at FROM flow_versions WHERE flow_id = ? ORDER BY version DESC",
    [flowId]
  );
  return rows.map(r => ({
    id: r.id,
    version: r.version,
    action: r.action,
    description: r.description,
    createdAt: r.created_at,
  }));
}

/** Restore a flow from a version snapshot */
export async function restoreFlowVersion(versionId: string): Promise<FlowDefinition | null> {
  const database = await getDb();
  const rows = await database.select<Array<{ data: string; flow_id: string }>>(
    "SELECT data, flow_id FROM flow_versions WHERE id = ?",
    [versionId]
  );
  if (rows.length === 0) return null;

  const flow = JSON.parse(rows[0].data) as FlowDefinition;
  flow.updatedAt = Date.now();

  // Save version of current state before restoring
  await saveFlowVersion(flow.id, "update", "Before version restore");

  await saveFlow(flow);
  return flow;
}

// ── Fuzzy lookup ─────────────────────────────────────────────────

/** Find a flow by name (case-insensitive partial match) */
export async function getFlowByName(name: string): Promise<FlowDefinition | null> {
  const database = await getDb();
  // Try exact match first
  let rows = await database.select<Array<{ data: string }>>(
    "SELECT data FROM flows WHERE LOWER(name) = LOWER(?)",
    [name]
  );
  if (rows.length > 0) {
    return migrateFlow(JSON.parse(rows[0].data) as FlowDefinition);
  }
  // Try partial match
  rows = await database.select<Array<{ data: string }>>(
    "SELECT data FROM flows WHERE LOWER(name) LIKE LOWER(?) ORDER BY updated_at DESC LIMIT 1",
    [`%${name}%`]
  );
  if (rows.length > 0) {
    return migrateFlow(JSON.parse(rows[0].data) as FlowDefinition);
  }
  return null;
}

// ── Patch application ────────────────────────────────────────────

/** Apply a patch to an existing flow. Returns the updated flow or null if not found. */
export async function applyFlowPatch(flowId: string, patch: FlowPatch): Promise<FlowDefinition | null> {
  const flow = await loadFlow(flowId);
  if (!flow) return null;

  // Save version before mutation
  await saveFlowVersion(flowId, "update", buildPatchDescription(patch), flow);

  // Apply name/description changes
  if (patch.name !== undefined) flow.name = patch.name;
  if (patch.description !== undefined) flow.description = patch.description;
  if (patch.contextAgentConfig !== undefined) flow.contextAgentConfig = patch.contextAgentConfig;

  // 1. Remove nodes (and their connected edges)
  if (patch.removeNodeIds?.length) {
    const removeSet = new Set(patch.removeNodeIds);
    flow.nodes = flow.nodes.filter(n => !removeSet.has(n.id));
    flow.edges = flow.edges.filter(e => !removeSet.has(e.source) && !removeSet.has(e.target));
  }

  // 2. Remove specific edges
  if (patch.removeEdgeIds?.length) {
    const removeEdgeSet = new Set(patch.removeEdgeIds);
    flow.edges = flow.edges.filter(e => !removeEdgeSet.has(e.id));
  }

  // 3. Add new nodes
  if (patch.addNodes?.length) {
    flow.nodes.push(...patch.addNodes);
  }

  // 4. Add new edges
  if (patch.addEdges?.length) {
    flow.edges.push(...patch.addEdges);
  }

  // 5. Update existing nodes
  if (patch.updateNodes?.length) {
    for (const update of patch.updateNodes) {
      const node = flow.nodes.find(n => n.id === update.id);
      if (node) {
        if (update.label !== undefined) node.label = update.label;
        if (update.config !== undefined) node.config = update.config;
      }
    }
  }

  flow.updatedAt = Date.now();
  await saveFlow(flow);
  return flow;
}

function buildPatchDescription(patch: FlowPatch): string {
  const parts: string[] = [];
  if (patch.name) parts.push(`rename to "${patch.name}"`);
  if (patch.addNodes?.length) parts.push(`add ${patch.addNodes.length} node(s)`);
  if (patch.removeNodeIds?.length) parts.push(`remove ${patch.removeNodeIds.length} node(s)`);
  if (patch.updateNodes?.length) parts.push(`update ${patch.updateNodes.length} node(s)`);
  if (patch.addEdges?.length) parts.push(`add ${patch.addEdges.length} edge(s)`);
  if (patch.removeEdgeIds?.length) parts.push(`remove ${patch.removeEdgeIds.length} edge(s)`);
  return parts.length > 0 ? parts.join(", ") : "update";
}

// ── List flows with counts (for AI tools) ────────────────────────

export async function listFlowsWithCounts(): Promise<Array<{
  id: string;
  name: string;
  description: string;
  nodeCount: number;
  edgeCount: number;
  updatedAt: number;
}>> {
  const database = await getDb();
  const rows = await database.select<Array<{ id: string; name: string; description: string; data: string; updated_at: number }>>(
    "SELECT id, name, description, data, updated_at FROM flows ORDER BY updated_at DESC"
  );
  return rows.map(r => {
    const flow = JSON.parse(r.data) as FlowDefinition;
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      nodeCount: flow.nodes.length,
      edgeCount: flow.edges.length,
      updatedAt: r.updated_at,
    };
  });
}
