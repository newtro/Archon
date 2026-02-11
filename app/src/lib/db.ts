import Database from "@tauri-apps/plugin-sql";

let db: Database | null = null;
const schemaInitializers: Array<(db: Database) => Promise<void>> = [];

/** Register a schema initializer to run on first DB connection. */
export function registerSchema(init: (db: Database) => Promise<void>): void {
  schemaInitializers.push(init);
}

/** Get the shared SQLite database connection (lazy-initialized). */
export async function getDb(): Promise<Database> {
  if (!db) {
    db = await Database.load("sqlite:archon.db");
    for (const init of schemaInitializers) {
      await init(db);
    }
  }
  return db;
}
