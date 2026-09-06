// Restore ONLY into a newly created disposable local PostgreSQL database.
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { decryptBackup } from "./operations.mjs";
const file = process.argv[2];
if (!file || !file.endsWith(".pgdump.enc"))
  throw Error("Provide the exact encrypted backup file.");
const archive = decryptBackup(
  await readFile(file),
  await readFile(join(homedir(), ".config/lift-journal/backup.key")),
);
const container = "olympicweightlifting-postgres-1",
  db = `lift_restore_${Date.now()}`;
const command = (args) =>
  execFileSync("docker", ["exec", container, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
command(["createdb", "-U", "lift", db]);
try {
  await new Promise((resolve, reject) => {
    const child = spawn(
      "docker",
      [
        "exec",
        "-i",
        container,
        "pg_restore",
        "-U",
        "lift",
        "--no-owner",
        "--no-acl",
        "--exit-on-error",
        "--dbname",
        db,
      ],
      { stdio: ["pipe", "ignore", "pipe"] },
    );
    child.stderr.resume();
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(Error("Restore failed.")),
    );
    child.stdin.on("error", reject);
    child.stdin.end(archive);
  });
  const result = command([
    "psql",
    "-U",
    "lift",
    "-d",
    db,
    "-At",
    "-c",
    "SELECT json_build_object('migrations',(SELECT count(*) FROM drizzle.__drizzle_migrations),'users',(SELECT count(*) FROM users),'journals',(SELECT count(*) FROM journals),'sessions',(SELECT coalesce(sum(jsonb_array_length(state->'sessions')),0) FROM journals),'sets',(SELECT count(*) FROM workout_sets));",
  ]);
  console.log(
    JSON.stringify({
      restored: true,
      counts: JSON.parse(result),
      database: db,
    }),
  );
} finally {
  command(["dropdb", "-U", "lift", db]);
}
