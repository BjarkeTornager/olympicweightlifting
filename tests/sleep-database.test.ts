import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

const tz = "Europe/Copenhagen";
const now = new Date("2026-09-26T18:00:00Z");

test(
  "the iPhone's night comes from one source, which a web client from before sources keeps",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    assert.ok(
      new URL(process.env.TEST_DATABASE_URL!).pathname.endsWith("_test"),
    );
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const { getPool } = await import("../lib/db");
    const { readJournal, writeJournal } = await import("../lib/server");
    const { syncHealth } = await import("../lib/health-sync");
    const { foodSnapshotForClient } = await import("../lib/food-compatibility");
    const pool = getPool();
    const id = crypto.randomUUID(),
      email = `sleep-${id}@example.test`;
    await pool.query(
      "INSERT INTO users(id,name,email,email_verified) VALUES ($1,'Sleep test',$2,true)",
      [id, email],
    );
    await pool.query(
      "INSERT INTO journal_invitations(id,email,created_by) VALUES($1,$2,$3)",
      [crypto.randomUUID(), email, id],
    );
    try {
      // The watch and an app on the phone both recorded the night.
      const night = {
        date: "2026-09-26",
        samples: [
          {
            start: "2026-09-25T22:30:00+02:00",
            end: "2026-09-26T07:30:00+02:00",
            value: "asleep",
            source: "AutoSleep",
          },
          {
            start: "2026-09-25T23:10:00+02:00",
            end: "2026-09-26T03:00:00+02:00",
            value: "core",
            source: "Apple Watch",
          },
          {
            start: "2026-09-26T03:00:00+02:00",
            end: "2026-09-26T06:40:00+02:00",
            value: "deep",
            source: "Apple Watch",
          },
        ],
      };
      const synced = await syncHealth(
        id,
        { timezone: tz, sleep: [night] },
        now,
      );
      assert.deepEqual(
        synced.sleep.map((s) => [s.result, s.hours]),
        [["imported", 7.5]],
      );
      let journal = await readJournal(id);
      assert.equal(
        journal.state.health.checkins[0].sleepImport?.source,
        "Apple Watch",
      );

      // A cached web client from before sources reads the night without
      // one, and saves an unrelated change.
      const older = foodSnapshotForClient(
        new Request("https://journal.example.test/api/journal", {
          headers: { "X-Sleep-Import-Version": "1" },
        }),
        journal,
      );
      assert.equal(
        older.state.health.checkins[0].sleepImport?.source,
        undefined,
      );
      older.state.profile.name = "Edited on an older client";
      await writeJournal(id, {
        state: older.state,
        revision: older.revision,
        mutationId: crypto.randomUUID(),
        preserveMissingFoodTags: true,
        preserveMissingCoachData: true,
      });
      journal = await readJournal(id);
      assert.equal(journal.state.profile.name, "Edited on an older client");
      assert.equal(
        journal.state.health.checkins[0].sleepImport?.source,
        "Apple Watch",
      );

      // The same night again changes nothing.
      const again = await syncHealth(id, { timezone: tz, sleep: [night] }, now);
      assert.equal(again.changed, false);
      assert.deepEqual(
        again.sleep.map((s) => s.result),
        ["unchanged"],
      );
    } finally {
      await pool.query("DELETE FROM journal_invitations WHERE email = $1", [
        email,
      ]);
      await pool.query("DELETE FROM users WHERE id = $1", [id]);
    }
  },
);
