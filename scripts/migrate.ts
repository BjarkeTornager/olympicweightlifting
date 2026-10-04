import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { sql } from "drizzle-orm";
import { getDb, getPool } from "../lib/db";
import { migrationOrderProblems } from "../lib/db/migration-order";
import { catalog } from "../lib/db/schema";
import { EXERCISES, program } from "../lib/domain";
import { regateSavedGoalTargets } from "../lib/legacy-goal-targets";
async function main() {
  // A separate migration role can own DDL while the app uses a restricted role.
  if (process.env.MIGRATION_DATABASE_URL)
    process.env.DATABASE_URL = process.env.MIGRATION_DATABASE_URL;
  // drizzle would skip a migration older than the newest applied one and
  // still report success; stop the release instead.
  const outOfOrder = migrationOrderProblems("./drizzle");
  if (outOfOrder.length)
    throw Error(`Migrations are out of order. ${outOfOrder.join(" ")}`);
  const db = getDb();
  try {
    // Serialise migrations across concurrent releases using a dedicated connection.
    const client = await getPool().connect();
    try {
      await client.query("SELECT pg_advisory_lock(81521342)");
      await migrate(db, { migrationsFolder: "./drizzle" });
    } finally {
      await client.query("SELECT pg_advisory_unlock(81521342)");
      client.release();
    }
    await db
      .insert(catalog)
      .values([
        ...EXERCISES.map((e) => ({
          id: `exercise:${e.id}`,
          kind: "exercise",
          data: e,
        })),
        {
          id: `program:${program.id}:${program.revision}`,
          kind: "program",
          data: program,
        },
      ])
      .onConflictDoUpdate({
        target: catalog.id,
        set: { data: sql`excluded.data` },
      });
    console.log("Database migrations and catalogue seeds complete.");
    // Goal targets saved before the plan's safety limits that break one now
    // follow the plan again. A failure here never stops the release.
    try {
      const changed = await regateSavedGoalTargets();
      console.log(`Goal targets brought within the plan's limits: ${changed}.`);
    } catch (error) {
      console.error(
        "Goal targets not checked:",
        error instanceof Error ? error.message : "Unknown failure",
      );
    }
  } finally {
    await getPool().end();
  }
}
void main().catch((error: unknown) => {
  console.error(
    "Database migration failed:",
    error instanceof Error ? error.message : "Unknown failure",
  );
  process.exitCode = 1;
});
