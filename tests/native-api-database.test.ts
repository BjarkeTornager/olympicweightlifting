import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

const tz = "Europe/Copenhagen";
const now = new Date("2026-09-26T18:00:00Z");

test(
  "the iPhone app's saves and Apple Health syncs are applied once and keep the athlete's edits",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    assert.ok(
      new URL(process.env.TEST_DATABASE_URL!).pathname.endsWith("_test"),
    );
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const { getPool } = await import("../lib/db");
    const { readJournal, writeJournal } = await import("../lib/server");
    const { applyNativeAction } = await import("../lib/native-actions");
    const { syncHealth } = await import("../lib/health-sync");
    const pool = getPool();
    const id = crypto.randomUUID();
    await pool.query(
      "INSERT INTO users(id,name,email,email_verified) VALUES ($1,'Native test',$1||'@example.test',true)",
      [id],
    );
    try {
      // A queued save retried after a lost response is saved once.
      const save = {
        id: crypto.randomUUID(),
        timezone: tz,
        action: {
          kind: "log_drink",
          drink: { date: "2026-09-26", ml: 500, kind: "water" },
        },
      };
      const first = await applyNativeAction(id, save, now);
      assert.equal(first.status, "saved");
      assert.match(first.detail, /0\.5 L/);
      // Another device saves in between; the retry must not overwrite it.
      const between = await readJournal(id);
      const other = structuredClone(between.state);
      other.profile.name = "Other device";
      await writeJournal(id, {
        state: other,
        revision: between.revision,
        mutationId: crypto.randomUUID(),
      });
      const retry = await applyNativeAction(id, save, now);
      assert.equal(retry.status, "duplicate");
      let journal = await readJournal(id);
      assert.equal(journal.state.health.drinks?.length, 1);
      assert.equal(journal.state.profile.name, "Other device");
      // An offline save made before that other change still applies on top of it.
      const late = await applyNativeAction(
        id,
        {
          id: crypto.randomUUID(),
          timezone: tz,
          action: {
            kind: "record_checkin",
            checkin: { date: "2026-09-26", energy: 4 },
          },
        },
        now,
      );
      assert.equal(late.status, "saved");
      journal = await readJournal(id);
      assert.equal(journal.state.profile.name, "Other device");
      assert.equal(journal.state.health.checkins[0].energy, 4);
      // A refused change explains why.
      await assert.rejects(
        applyNativeAction(
          id,
          {
            id: crypto.randomUUID(),
            timezone: tz,
            action: { kind: "finish_workout" },
          },
          now,
        ),
        (e: Error & { status?: number }) => e.status === 422,
      );

      const run = {
        id: crypto.randomUUID(),
        kind: "running",
        name: "Outdoor Run",
        start: "2026-09-26T06:30:00+02:00",
        end: "2026-09-26T07:20:00+02:00",
        durationSeconds: 3000,
        distanceKm: 10,
        averageHeartRate: 148,
        maxHeartRate: 171,
      };
      const night = {
        date: "2026-09-26",
        samples: [
          {
            start: "2026-09-25T23:10:00+02:00",
            end: "2026-09-26T03:00:00+02:00",
            value: "core",
          },
          {
            start: "2026-09-26T03:00:00+02:00",
            end: "2026-09-26T06:40:00+02:00",
            value: "deep",
          },
        ],
      };
      const batch = {
        timezone: tz,
        sleep: [night],
        days: [{ date: "2026-09-26", restingHeartRate: 51, steps: 9000 }],
        workouts: [run],
      };
      const synced = await syncHealth(id, batch, now);
      assert.equal(synced.changed, true);
      assert.deepEqual(
        synced.sleep.map((s) => [s.result, s.hours]),
        [["imported", 7.5]],
      );
      assert.equal(synced.daysUpdated, 1);
      assert.deepEqual(synced.workouts, [{ id: run.id, result: "imported" }]);
      journal = await readJournal(id);
      assert.equal(journal.state.cardio.sessions.length, 1);
      assert.equal(journal.state.health.checkins[0].sleepHours, 7.5);
      assert.equal(journal.state.health.checkins[0].energy, 4);
      assert.equal(journal.state.health.vitals?.[0].restingHeartRate, 51);

      // The same batch again writes nothing.
      const again = await syncHealth(id, batch, now);
      assert.equal(again.changed, false);
      assert.equal(again.revision, journal.revision);

      // The athlete deletes the imported run; it does not come back.
      const deleted = await applyNativeAction(
        id,
        {
          id: crypto.randomUUID(),
          timezone: tz,
          action: { kind: "delete_cardio", cardioId: run.id },
        },
        now,
      );
      assert.equal(deleted.status, "saved");
      const redelivered = await syncHealth(
        id,
        { ...batch, workouts: [{ ...run, distanceKm: 10.1 }] },
        now,
      );
      assert.deepEqual(redelivered.workouts, [
        { id: run.id, result: "preserved" },
      ]);
      assert.equal((await readJournal(id)).state.cardio.sessions.length, 0);

      // A workout deleted in Apple Health is removed if still untouched.
      const walk = {
        ...run,
        id: crypto.randomUUID(),
        kind: "walking",
        name: "Outdoor Walk",
        start: "2026-09-26T12:00:00+02:00",
        end: "2026-09-26T12:40:00+02:00",
        durationSeconds: 2400,
        distanceKm: 3.1,
      };
      await syncHealth(id, { timezone: tz, workouts: [walk] }, now);
      assert.equal((await readJournal(id)).state.cardio.sessions.length, 1);
      const removed = await syncHealth(
        id,
        { timezone: tz, deletedWorkoutIds: [walk.id] },
        now,
      );
      assert.deepEqual(removed.workouts, [{ id: walk.id, result: "removed" }]);
      assert.equal((await readJournal(id)).state.cardio.sessions.length, 0);
    } finally {
      await pool.query("DELETE FROM users WHERE id = $1", [id]);
    }
  },
);
