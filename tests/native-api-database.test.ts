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

test(
  "the iPhone app creates a programme, follows it, logs and corrects sets, and reads the session back",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const { getPool } = await import("../lib/db");
    const { readJournal } = await import("../lib/server");
    const { applyNativeAction } = await import("../lib/native-actions");
    const { buildTraining, findSession } =
      await import("../lib/native-training");
    const pool = getPool();
    const id = crypto.randomUUID();
    await pool.query(
      "INSERT INTO users(id,name,email,email_verified) VALUES ($1,'Train test',$1||'@example.test',true)",
      [id],
    );
    const save = (action: Record<string, unknown>) =>
      applyNativeAction(
        id,
        { id: crypto.randomUUID(), timezone: tz, action },
        now,
      );
    try {
      await save({
        kind: "create_training_program",
        trainingProgram: {
          name: "Autumn strength",
          days: [
            {
              name: "Squat day",
              exercises: [
                { exerciseId: "back_squat", sets: 3, reps: 5, weight: 100 },
                // No weight: choose a load when training.
                { exerciseId: "snatch", sets: 2, reps: 2 },
              ],
            },
          ],
        },
      });
      let journal = await readJournal(id);
      let training = buildTraining(
        journal.state,
        journal.revision,
        "2026-09-26",
      );
      const autumn = training.programmes.find(
        (p) => p.name === "Autumn strength",
      )!;
      assert.ok(autumn && !autumn.builtIn && !autumn.active);
      assert.equal(autumn.days[0].exercises[1].weight, undefined);

      await save({ kind: "use_programme", programmeId: autumn.id });
      journal = await readJournal(id);
      training = buildTraining(journal.state, journal.revision, "2026-09-26");
      assert.equal(training.programmes.find((p) => p.active)?.id, autumn.id);
      assert.equal(training.next?.title, "Squat day");
      await assert.rejects(
        save({ kind: "use_programme", programmeId: "no-such-programme" }),
        (e: Error & { status?: number }) => e.status === 422,
      );

      await save({
        kind: "start_training_day",
        trainingProgramId: autumn.id,
        dayId: autumn.days[0].id,
        date: "2026-09-26",
      });
      await save({
        kind: "log_sets",
        exerciseId: "back_squat",
        sets: [{ weight: 100, reps: 5, result: "success" }],
      });
      await save({
        kind: "log_sets",
        exerciseId: "back_squat",
        sets: [{ weight: 100, reps: 3, result: "miss" }],
      });
      journal = await readJournal(id);
      training = buildTraining(journal.state, journal.revision, "2026-09-26");
      const squat = training.activeWorkout!.exercises.find(
        (e) => e.exerciseId === "back_squat",
      )!;
      assert.deepEqual(
        squat.sets.map((s) => [s.logged, s.result]),
        [
          [true, "success"],
          [true, "miss"],
          [false, ""],
        ],
      );
      await save({
        kind: "correct_workout_set",
        workoutId: training.activeWorkout!.id,
        entryId: squat.entryId,
        setId: squat.sets[1].id,
        setChanges: { reps: 5, result: "success" },
      });
      await save({ kind: "finish_workout" });
      journal = await readJournal(id);
      training = buildTraining(journal.state, journal.revision, "2026-09-26");
      assert.equal(training.activeWorkout, undefined);
      const session = findSession(journal.state, training.recent[0].id)!;
      assert.equal(session.finished, true);
      assert.equal(training.recent[0].topSet, "Back squat 100 kg × 5");
      assert.deepEqual(
        session.exercises[0].sets
          .filter((s) => s.logged)
          .map((s) => [s.weight, s.reps, s.result]),
        [
          [100, 5, "success"],
          [100, 5, "success"],
        ],
      );
      await save({
        kind: "delete_training_program",
        trainingProgramId: autumn.id,
      });
      journal = await readJournal(id);
      assert.equal(
        buildTraining(journal.state, journal.revision, "2026-09-26").programmes
          .length,
        1,
      );
    } finally {
      await pool.query("DELETE FROM users WHERE id = $1", [id]);
    }
  },
);

test(
  "Apple Health lifting synced while a session is open is counted once, after the session",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    const { getPool } = await import("../lib/db");
    const { readJournal, writeJournal } = await import("../lib/server");
    const { syncHealth } = await import("../lib/health-sync");
    const { createWorkout, days } = await import("../lib/domain");
    const { dayBurn } = await import("../lib/energy");
    const pool = getPool();
    const id = crypto.randomUUID();
    await pool.query(
      "INSERT INTO users(id,name,email,email_verified) VALUES ($1,'Deferred lifting test',$1||'@example.test',true)",
      [id],
    );
    const date = "2026-09-26";
    const lifting = {
      id: crypto.randomUUID(),
      kind: "strength",
      name: "Strength Training",
      start: "2026-09-26T17:05:00+02:00",
      end: "2026-09-26T18:25:00+02:00",
      durationSeconds: 4800,
      caloriesKcal: 410,
    };
    const receipt = async (workoutId: string) =>
      (
        await pool.query(
          "SELECT status, started_at, workout FROM health_workout_imports WHERE user_id = $1 AND workout_id = $2",
          [id, workoutId],
        )
      ).rows[0];
    try {
      // A session open in the journal while the watch records it.
      let journal = await readJournal(id);
      const state = structuredClone(journal.state);
      state.profile.bodyweight = 88;
      state.activeWorkout = createWorkout(state, days[0], date);
      await writeJournal(id, {
        state,
        revision: journal.revision,
        mutationId: crypto.randomUUID(),
      });
      const first = await syncHealth(
        id,
        { timezone: tz, workouts: [lifting] },
        now,
      );
      // The phone hears "skipped": it has nothing to send again.
      assert.deepEqual(first.workouts, [{ id: lifting.id, result: "skipped" }]);
      assert.equal(first.changed, false);
      const kept = await receipt(lifting.id);
      assert.equal(kept.status, "deferred");
      assert.equal(
        new Date(kept.started_at).toISOString(),
        "2026-09-26T15:05:00.000Z",
      );
      assert.equal(kept.workout.caloriesKcal, 410);
      // A sync while the session is still open leaves it waiting.
      const waiting = await syncHealth(id, { timezone: tz }, now);
      assert.deepEqual(waiting.workouts, []);
      assert.equal((await receipt(lifting.id)).status, "deferred");

      // The session is finished; the next sync matches the watch's workout
      // to it instead of counting the lifting twice.
      journal = await readJournal(id);
      const finished = structuredClone(journal.state);
      finished.sessions.push({
        ...finished.activeWorkout!,
        firstSetAt: "2026-09-26T15:10:00.000Z",
        finishedAt: "2026-09-26T16:30:00.000Z",
        durationMinutes: 80,
      });
      finished.activeWorkout = null;
      await writeJournal(id, {
        state: finished,
        revision: journal.revision,
        mutationId: crypto.randomUUID(),
      });
      const reconciled = await syncHealth(id, { timezone: tz }, now);
      assert.deepEqual(reconciled.workouts, [
        { id: lifting.id, result: "skipped" },
      ]);
      const after = await receipt(lifting.id);
      assert.equal(after.status, "skipped");
      assert.equal(after.workout, null);
      journal = await readJournal(id);
      assert.equal(journal.state.cardio.sessions.length, 0);
      // Only the session's estimate: 4 × 88 kg × 80 min, about 470 kcal.
      assert.deepEqual(dayBurn(journal.state, date), {
        kcal: 470,
        estimated: true,
        count: 1,
        untimed: 0,
      });
      // Deleted in Apple Health while waiting: it never comes in.
      const other = { ...lifting, id: crypto.randomUUID() };
      const open = structuredClone(journal.state);
      open.activeWorkout = createWorkout(open, days[0], date);
      await writeJournal(id, {
        state: open,
        revision: journal.revision,
        mutationId: crypto.randomUUID(),
      });
      await syncHealth(id, { timezone: tz, workouts: [other] }, now);
      const gone = await syncHealth(
        id,
        { timezone: tz, deletedWorkoutIds: [other.id] },
        now,
      );
      assert.deepEqual(gone.workouts, [{ id: other.id, result: "removed" }]);
      assert.equal((await receipt(other.id)).status, "removed");
    } finally {
      await pool.query("DELETE FROM users WHERE id = $1", [id]);
    }
  },
);
