import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrationOrderProblems } from "../lib/db/migration-order";

test("every migration is newer than the one before it, so none is skipped", () => {
  assert.deepEqual(migrationOrderProblems(), []);
});

test("a migration renumbered by hand after another branch's is caught", (t) => {
  // Two branches each added a 0017; the one merged second was renumbered to
  // 0018 but kept its journal entry and snapshot.
  const folder = mkdtempSync(join(tmpdir(), "migrations-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  mkdirSync(join(folder, "meta"));
  const entries = [
    { tag: "0000_start", when: 1000, id: "a", prevId: "0" },
    { tag: "0001_ledger", when: 3000, id: "b", prevId: "a" },
    { tag: "0002_sweepers", when: 2000, id: "c", prevId: "a" },
  ];
  writeFileSync(
    join(folder, "meta", "_journal.json"),
    JSON.stringify({
      entries: entries.map(({ tag, when }, idx) => ({ idx, tag, when })),
    }),
  );
  entries.forEach(({ tag, id, prevId }, idx) => {
    writeFileSync(join(folder, `${tag}.sql`), "SELECT 1;");
    writeFileSync(
      join(folder, "meta", `000${idx}_snapshot.json`),
      JSON.stringify({ id, prevId }),
    );
  });
  writeFileSync(join(folder, "0001_leftover.sql"), "SELECT 1;");
  assert.deepEqual(migrationOrderProblems(folder), [
    "0002_sweepers is older than 0001_ledger, so a database that has 0001_ledger would skip it.",
    "0002_sweepers's snapshot doesn't follow 0001_ledger's, so it wasn't generated on top of it.",
    "0001_leftover.sql isn't in the journal, so it never runs.",
  ]);
});
