/**
 * SQLite storage for tracking installed community flows.
 * Uses the same registerSchema pattern as flow-storage.ts and chat-storage.ts.
 */

import { registerSchema, getDb } from "./db";
import type { InstalledCommunityFlow } from "./registry-types";

// Register the schema initializer
registerSchema(async (db) => {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS installed_community_flows (
      community_id TEXT PRIMARY KEY,
      local_flow_id TEXT NOT NULL,
      installed_version TEXT NOT NULL,
      installed_at INTEGER NOT NULL
    )
  `);
});

/** Track a newly installed community flow */
export async function trackInstall(
  communityId: string,
  localFlowId: string,
  version: string
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT OR REPLACE INTO installed_community_flows (community_id, local_flow_id, installed_version, installed_at)
     VALUES ($1, $2, $3, $4)`,
    [communityId, localFlowId, version, Date.now()]
  );
}

/** Get all installed community flows */
export async function getInstalledFlows(): Promise<InstalledCommunityFlow[]> {
  const db = await getDb();
  const rows = await db.select<Array<{
    community_id: string;
    local_flow_id: string;
    installed_version: string;
    installed_at: number;
  }>>(
    "SELECT community_id, local_flow_id, installed_version, installed_at FROM installed_community_flows"
  );
  return rows.map((row) => ({
    communityId: row.community_id,
    localFlowId: row.local_flow_id,
    installedVersion: row.installed_version,
    installedAt: row.installed_at,
  }));
}

/** Check if a community flow is installed */
export async function isInstalled(communityId: string): Promise<boolean> {
  const db = await getDb();
  const rows = await db.select<Array<{ cnt: number }>>(
    "SELECT COUNT(*) as cnt FROM installed_community_flows WHERE community_id = $1",
    [communityId]
  );
  return rows[0]?.cnt > 0;
}

/** Get the installed version of a community flow, or null if not installed */
export async function getInstalledVersion(communityId: string): Promise<string | null> {
  const db = await getDb();
  const rows = await db.select<Array<{ installed_version: string }>>(
    "SELECT installed_version FROM installed_community_flows WHERE community_id = $1",
    [communityId]
  );
  return rows[0]?.installed_version ?? null;
}

/** Remove install tracking for a community flow */
export async function removeInstallTracking(communityId: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    "DELETE FROM installed_community_flows WHERE community_id = $1",
    [communityId]
  );
}
