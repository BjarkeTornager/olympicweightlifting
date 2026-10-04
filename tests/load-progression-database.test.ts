import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

const tz = "Europe/Copenhagen";

test(
  "the iPhone app records the last set's RPE, holds loads on a short night, confirms a coach's technique check and is refused a reset there is none of",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    assert.ok(
      new URL(process.env.TEST_DATABASE_URL!).pathname.endsWith("_test"),
    );
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const { getPool } = await import("../lib/db");
    const { readJournal, writeJournal } = await import("../lib/server");
    const { applyNativeAction } = await import("../lib/native-actions");
    const { buildTraining } = await import("../lib/native-training");
    const pool = getPool();
    const id = crypto.randomUUID();
    await pool.query(
      "INSERT INTO users(id,name,email,email_verified) VALUES ($1,'Load test',$1||'@example.test',true)",
      [id],
    );
    const save = (action: Record<string, unknown>, date = "2026-09-26") =>
      applyNativeAction(
        id,
        { id: crypto.randomUUID(), timezone: tz, action },
        new Date(`${date}T16:00:00Z`),
      );
    const workout = async () => {
      const journal = await readJournal(id);
      return buildTraining(journal.state, journal.revision, "2026-09-26")
        .activeWorkout!;
    };
    try {
      // Monday's snatch, six singles at 60 kg, the last rated RPE 8.
      await save(
        { kind: "start_programme", dayId: "monday", date: "2026-09-21" },
        "2026-09-21",
      );
      await save(
        {
          kind: "log_sets",
          exerciseId: "snatch",
          sets: Array.from({ length: 6 }, () => ({
            weight: 60,
            reps: 1,
            result: "success",
          })),
        },
        "2026-09-21",
      );
      let current = await workout();
      const snatch = current.exercises[0];
      assert.equal(snatch.restSeconds, 180);
      await save(
        {
          kind: "correct_workout_set",
          workoutId: current.id,
          entryId: snatch.entryId,
          setId: snatch.sets[5].id,
          setChanges: { rpe: 8 },
        },
        "2026-09-21",
      );
      current = await workout();
      assert.equal(current.exercises[0].sets[5].rpe, 8);
      await save({ kind: "finish_workout" }, "2026-09-21");

      // A 16-year-old after a 5 h night.
      const journal = await readJournal(id);
      const state = structuredClone(journal.state);
      state.profile.age = 16;
      await writeJournal(id, {
        state,
        revision: journal.revision,
        mutationId: crypto.randomUUID(),
      });
      await save({
        kind: "record_checkin",
        checkin: { date: "2026-09-26", sleepHours: 5 },
      });
      await save({
        kind: "start_programme",
        dayId: "monday",
        date: "2026-09-26",
      });
      current = await workout();
      assert.equal(current.exercises[0].progression?.status, "confirm");
      assert.equal(current.exercises[0].target, "6 × 1–2 · 60 kg");
      assert.equal(current.techniqueCheck, false);
      assert.equal(current.recovery, "auto");
      assert.match(current.recoveryHint!, /You slept 5 h before this session/);

      const confirmed = await save({
        kind: "confirm_technique",
        checked: true,
      });
      assert.equal(confirmed.title, "Coach checked your technique");
      current = await workout();
      assert.equal(current.techniqueCheck, true);
      assert.equal(current.exercises[0].target, "6 × 1–2 · 62 kg");
      assert.match(
        current.exercises[0].progression!.reason,
        /^Your coach checked your technique\. All prescribed sets and reps were made, the top set at RPE 8\./,
      );

      await save({ kind: "set_workout_recovery", recovery: "limited" });
      current = await workout();
      assert.equal(current.recovery, "limited");
      assert.equal(current.recoveryHint, undefined);
      assert.equal(current.exercises[0].target, "6 × 1–2 · 60 kg");

      await assert.rejects(
        save({
          kind: "take_load_reset",
          entryId: current.exercises[0].entryId,
        }),
        (e: Error & { status?: number }) =>
          e.status === 422 && /no reset/.test(e.message),
      );
    } finally {
      await pool.query("DELETE FROM users WHERE id = $1", [id]);
    }
  },
);
