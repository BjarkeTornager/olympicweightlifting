// Personal pilot fallback: encrypted backups and readiness checks while this Mac is awake.
// No cloud credentials, journal content or child-process stderr is written to logs.
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  readdir,
  stat,
  unlink,
  writeFile,
  rename,
} from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
const run = promisify(execFile);
const root = join(homedir(), ".local/share/lift-journal");
const keyPath = join(homedir(), ".config/lift-journal/backup.key");
const project = "c542df51-3852-4c13-83a3-ebb313baf657";
const environment = "0ee37968-9272-4e93-9547-daa04b8d7cf9";
const executable = process.env.LIFT_NPM_PATH ?? "/opt/homebrew/bin/npm";
const identity = join(homedir(), ".ssh/lift-journal-railway");
const readyUrl = "https://lift-journal-production.up.railway.app/api/ready";
const railwayArgs = [
  "exec",
  "--yes",
  "--package",
  "@railway/cli@5.49.2",
  "--",
  "railway",
  "ssh",
  "--project",
  project,
  "--environment",
  environment,
  "--service",
  "Postgres",
  "--identity-file",
  identity,
  "--",
  "runuser",
  "-u",
  "postgres",
  "--",
];
export function encryptBackup(bytes, key) {
  if (key.length !== 32) throw Error("Backup key must be 32 bytes.");
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key, iv),
    encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return Buffer.concat([
    Buffer.from("LIFTDB01"),
    iv,
    cipher.getAuthTag(),
    encrypted,
  ]);
}
export function decryptBackup(bytes, key) {
  if (bytes.subarray(0, 8).toString() !== "LIFTDB01")
    throw Error("Unknown backup format.");
  const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(8, 20));
  decipher.setAuthTag(bytes.subarray(20, 36));
  return Buffer.concat([decipher.update(bytes.subarray(36)), decipher.final()]);
}
async function writePrivate(path, value) {
  const temp = `${path}.tmp`;
  await writeFile(temp, value, { mode: 0o600 });
  await chmod(temp, 0o600);
  await rename(temp, path);
}
async function notify(message) {
  // Fixed application messages only; never include provider errors or record contents.
  if (
    process.platform === "darwin" &&
    process.env.LIFT_OPERATIONS_NOTIFY !== "false"
  )
    try {
      await run(
        "/usr/bin/osascript",
        [
          "-e",
          `display notification ${JSON.stringify(message)} with title "Lift Journal"`,
        ],
        { timeout: 10000 },
      );
    } catch {}
}
export async function backup() {
  const key = await readFile(keyPath);
  const mode = (await stat(keyPath)).mode & 0o777;
  if (mode & 0o077) throw Error("Backup key permissions must be private.");
  const folder = join(root, "backups");
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const { stdout } = await run(
    executable,
    [
      ...railwayArgs,
      "pg_dump",
      "--format=custom",
      "--no-owner",
      "--no-acl",
      "railway",
    ],
    { encoding: "buffer", maxBuffer: 256 * 1024 * 1024, timeout: 180000 },
  );
  if (stdout.subarray(0, 5).toString() !== "PGDMP")
    throw Error("No valid PostgreSQL archive received.");
  const sealed = encryptBackup(stdout, key),
    createdAt = new Date().toISOString(),
    name = `railway-${createdAt.replaceAll(":", "-")}.pgdump.enc`,
    path = join(folder, name);
  await writePrivate(path, sealed);
  const metadata = {
    format: "LIFTDB01",
    createdAt,
    bytes: sealed.length,
    sha256: createHash("sha256").update(sealed).digest("hex"),
    source: "Railway PostgreSQL",
    retentionDays: 30,
  };
  await writePrivate(`${path}.json`, JSON.stringify(metadata, null, 2));
  // Remove only archives created by this backup tool, after a new archive is durable.
  for (const name of await readdir(folder))
    if (/^railway-\d{4}-\d{2}-\d{2}T[\d-]+\.\d{3}Z\.pgdump\.enc$/.test(name)) {
      const old = join(folder, name);
      if (Date.now() - (await stat(old)).mtimeMs > 30 * 86400000) {
        await unlink(old);
        try {
          await unlink(`${old}.json`);
        } catch {}
      }
    }
  return { path, ...metadata };
}
export async function checkReady(fetcher = fetch) {
  const r = await fetcher(readyUrl, {
    signal: AbortSignal.timeout(15000),
    redirect: "error",
  });
  if (!r.ok || (await r.json()).status !== "ready")
    throw Error("Site readiness failed.");
}
async function tick(force = false) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const statusPath = join(root, "operations-status.json");
  let status = {
    failures: 0,
    lastBackup: null,
    lastCheck: null,
    backupFailureNotified: false,
  };
  try {
    status = { ...status, ...JSON.parse(await readFile(statusPath, "utf8")) };
  } catch {}
  let failed = false;
  try {
    await checkReady();
    if (status.failures >= 2) await notify("The website is responding again.");
    status.failures = 0;
    status.lastCheck = new Date().toISOString();
  } catch {
    status.failures++;
    failed = true;
    if (status.failures === 2)
      await notify(
        "The website failed two readiness checks. Check Railway and your internet connection.",
      );
  }
  if (
    force ||
    !status.lastBackup ||
    Date.now() - Date.parse(status.lastBackup) > 24 * 3600000
  ) {
    try {
      const saved = await backup();
      status.lastBackup = saved.createdAt;
      status.backupFailureNotified = false;
      console.log(
        JSON.stringify({
          event: "encrypted_backup_saved",
          createdAt: saved.createdAt,
          bytes: saved.bytes,
        }),
      );
    } catch {
      failed = true;
      if (!status.backupFailureNotified) {
        await notify(
          "The encrypted database backup failed. Check Railway access and the backup job.",
        );
        status.backupFailureNotified = true;
      }
    }
  }
  await writePrivate(statusPath, JSON.stringify(status, null, 2));
  console.log(
    JSON.stringify({
      event: "operations_check",
      ready: status.failures === 0,
      lastBackup: status.lastBackup,
      failures: status.failures,
    }),
  );
  if (failed) process.exitCode = 1;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  tick(process.argv.includes("--backup-now")).catch(() => {
    console.error(JSON.stringify({ event: "operations_failed" }));
    process.exitCode = 1;
  });
