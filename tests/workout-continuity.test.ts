import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyJournal } from "../lib/domain";
import { prepareAction } from "../lib/agent/actions";
import { mergeWorkoutSessions } from "../lib/workout-continuity";
const date = "2026-09-07";
const workout = {
  title: "Lower body",
  date,
  category: "accessories",
  exercises: [
    {
      exerciseId: "romanian_deadlift",
      sets: [{ weight: 60, reps: 10, result: "success" }],
    },
  ],
};
const progress = {
  kind: "log_workout_progress",
  workout,
  completion: "ongoing",
};
const count = (state: ReturnType<typeof emptyJournal>) =>
  state.sessions.flatMap((w) => w.exercises.flatMap((e) => e.sets)).length;

test("partial multi-exercise reports extend one draft, preserve pending targets, and finish once", () => {
  const planned = prepareAction(
    emptyJournal(),
    {
      kind: "plan_workout",
      workout: {
        ...workout,
        exercises: [
          ...workout.exercises,
          {
            exerciseId: "back_squat",
            sets: [{ weight: 110, reps: 6, result: "success" }],
          },
        ],
      },
    },
    date,
  ).state;
  const pendingId = planned.activeWorkout!.exercises[1].sets[0].id;
  const first = prepareAction(planned, progress, date);
  assert.equal(first.workoutReview!.status, "ongoing");
  assert.equal(first.state.sessions.length, 0);
  assert.equal(first.state.activeWorkout!.exercises[1].sets[0].logged, false);
  const second = prepareAction(
    first.state,
    {
      ...progress,
      workout: {
        ...workout,
        exercises: [
          {
            exerciseId: "back_squat",
            sets: [{ weight: 112, reps: 6, result: "success" }],
          },
          ...workout.exercises,
        ],
      },
    },
    date,
  );
  assert.equal(second.state.activeWorkout!.id, first.state.activeWorkout!.id);
  assert.equal(
    second.state.activeWorkout!.exercises[0].sets.length,
    2,
    "Identical new sets are retained",
  );
  assert.equal(second.state.activeWorkout!.exercises[1].sets[0].id, pendingId);
  assert.equal(second.state.activeWorkout!.exercises[1].sets[0].weight, 112);
  const done = prepareAction(second.state, { kind: "finish_workout" }, date);
  assert.equal(done.state.sessions.length, 1);
  assert.equal(count(done.state), 3);
  assert.equal(done.state.activeWorkout, null);
  assert.equal(done.workoutReview!.status, "completed");
  assert.throws(
    () => prepareAction(done.state, { kind: "finish_workout" }, date),
    /unfinished/,
  );
});

test("same-date and active-session guards stop accidental splits while explicit separate workouts remain possible", () => {
  const active = prepareAction(emptyJournal(), progress, date).state;
  assert.throws(
    () =>
      prepareAction(
        active,
        { kind: "record_session", workout, separateSession: true },
        date,
      ),
    /ongoing workout exists/,
  );
  const done = prepareAction(active, { kind: "finish_workout" }, date).state;
  assert.throws(
    () => prepareAction(done, { kind: "record_session", workout }, date),
    /already exists/,
  );
  assert.throws(() => prepareAction(done, progress, date), /already exists/);
  assert.throws(
    () =>
      prepareAction(
        emptyJournal(),
        {
          kind: "record_bundle",
          entries: [
            { kind: "record_session", workout },
            { kind: "record_session", workout },
          ],
        },
        date,
      ),
    /one training entry/,
  );
  const appended = prepareAction(
    done,
    { ...progress, sessionId: done.sessions[0].id, completion: "completed" },
    date,
  ).state;
  assert.equal(appended.sessions.length, 1);
  assert.equal(count(appended), 2);
  assert.equal(
    appended.sessions[0].exercises[0].sets[0].id,
    done.sessions[0].exercises[0].sets[0].id,
  );
  const reopened = prepareAction(
    done,
    { ...progress, sessionId: done.sessions[0].id },
    date,
  ).state;
  assert.equal(reopened.sessions.length, 0);
  assert.equal(reopened.activeWorkout!.id, done.sessions[0].id);
  assert.equal(reopened.activeWorkout!.finishedAt, undefined);
  assert.equal(
    prepareAction(
      done,
      { kind: "record_session", workout, separateSession: true },
      date,
    ).state.sessions.length,
    2,
  );
});

test("merge preserves exact repeated sets, exercise metadata and notes; rejects foreign IDs, dates and active conflicts", () => {
  const a = prepareAction(
    emptyJournal(),
    {
      kind: "record_session",
      workout: { ...workout, notes: "Partial report" },
    },
    date,
  ).state;
  const state = prepareAction(
    a,
    {
      kind: "record_session",
      workout: { ...workout, notes: "Final exercise" },
      separateSession: true,
    },
    date,
  ).state;
  const before = structuredClone(state);
  state.sessions[1].exercises[0].coachCue = "Preserved cue";
  const ids = state.sessions.map((w) => w.id);
  const merged = mergeWorkoutSessions(state, ids, "One workout", "completed");
  assert.equal(merged.state.sessions.length, 1);
  assert.equal(count(merged.state), 2);
  assert.deepEqual(
    merged.workout.exercises,
    state.sessions.flatMap((w) => w.exercises),
  );
  assert.match(merged.workout.athleteNotes, /Partial report/);
  assert.match(merged.workout.athleteNotes, /Final exercise/);
  assert.equal(
    state.sessions.length,
    before.sessions.length,
    "Input is never mutated",
  );
  assert.throws(
    () =>
      mergeWorkoutSessions(
        state,
        [ids[0], "someone-else"],
        "Combined",
        "completed",
      ),
    /no longer/,
  );
  assert.throws(
    () =>
      mergeWorkoutSessions(state, [ids[0], ids[0]], "Combined", "completed"),
    /different sessions/,
  );
  state.sessions[1].date = "2026-09-06";
  assert.throws(
    () => mergeWorkoutSessions(state, ids, "Combined", "completed"),
    /same training date/,
  );
  state.sessions[1].date = date;
  const ongoing = mergeWorkoutSessions(state, ids, "Continue", "ongoing").state;
  assert.equal(ongoing.sessions.length, 0);
  assert.equal(ongoing.activeWorkout!.finishedAt, undefined);
  state.activeWorkout = ongoing.activeWorkout;
  assert.throws(
    () => mergeWorkoutSessions(state, ids, "Combined", "ongoing"),
    /current draft/,
  );
});
