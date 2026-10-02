import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

test(
  "Feature use is counted per account, feature and day, without content",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    assert.ok(
      new URL(process.env.TEST_DATABASE_URL!).pathname.endsWith("_test"),
    );
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const { getPool } = await import("../lib/db");
    const { countUse } = await import("../lib/feature-use");
    const { loadRecordedDates } = await import("../lib/usage-report");
    const { writeJournal, readJournal } = await import("../lib/server");
    const pool = getPool();
    const id = crypto.randomUUID();
    await pool.query(
      "INSERT INTO users(id,name,email,email_verified) VALUES ($1,'Usage test',$1||'@example.test',true)",
      [id],
    );
    try {
      const day = new Date("2026-10-02T08:00:00Z");
      await countUse(id, "coach.message", day);
      await countUse(id, "coach.message", day);
      await countUse(id, "coach.message", new Date("2026-10-03T08:00:00Z"));
      await countUse(id, "voice.call.elevenlabs", day);
      // Names outside the pattern are ignored, never stored.
      await countUse(id, "Coach said: I ate pizza", day);
      // A failed write is logged, never thrown into the request.
      await countUse("no-such-account", "coach.message", day);
      const { rows } = await pool.query(
        "SELECT feature, day::text AS day, count FROM feature_use WHERE user_id=$1 ORDER BY feature, day",
        [id],
      );
      assert.deepEqual(rows, [
        { feature: "coach.message", day: "2026-10-02", count: 2 },
        { feature: "coach.message", day: "2026-10-03", count: 1 },
        { feature: "voice.call.elevenlabs", day: "2026-10-02", count: 1 },
      ]);

      // Recorded dates come from the journal as dates only.
      const { state, revision } = await readJournal(id);
      state.health.checkins.push(
        {
          date: "2026-09-29",
          sleepHours: 7.5,
          energy: null,
          soreness: null,
          waterMl: null,
          bodyweight: null,
          notes: "",
          updatedAt: "2026-09-29T07:00:00.000Z",
        },
        {
          date: "2026-09-30",
          sleepHours: null,
          energy: 4,
          soreness: null,
          waterMl: null,
          bodyweight: null,
          notes: "",
          updatedAt: "2026-09-29T07:00:00.000Z",
        },
      );
      state.health.vitals = [
        {
          date: "2026-09-29",
          restingHeartRate: null,
          heartRateVariabilityMs: null,
          averageHeartRate: null,
          steps: 8200,
          activeEnergyKcal: null,
          source: "apple-health",
          updatedAt: "2026-09-29T20:00:00.000Z",
        },
        {
          date: "2026-09-30",
          restingHeartRate: 55,
          heartRateVariabilityMs: null,
          averageHeartRate: null,
          steps: 0,
          activeEnergyKcal: null,
          source: "apple-health",
          updatedAt: "2026-09-30T20:00:00.000Z",
        },
      ];
      await writeJournal(id, {
        state,
        revision,
        mutationId: crypto.randomUUID(),
      });
      const dates = (await loadRecordedDates("2026-09-01")).get(id);
      assert.deepEqual(dates, {
        sleep: ["2026-09-29"],
        food: [],
        movement: ["2026-09-29"],
        other: ["2026-09-29", "2026-09-30"],
      });
      assert.equal(
        (await loadRecordedDates("2026-09-30")).get(id)?.sleep.length,
        0,
      );

      // Deleting the account deletes its counts.
      await pool.query("DELETE FROM users WHERE id=$1", [id]);
      const left = await pool.query(
        "SELECT count(*)::int AS n FROM feature_use WHERE user_id=$1",
        [id],
      );
      assert.equal(left.rows[0].n, 0);
    } finally {
      await pool.query("DELETE FROM users WHERE id=$1", [id]);
      await pool.end();
    }
  },
);
