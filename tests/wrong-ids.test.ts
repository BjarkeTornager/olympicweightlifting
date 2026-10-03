import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyJournal } from "../lib/domain";
import { saveCardio } from "../lib/cardio";
import { prepareSetCorrection } from "../lib/agent/prepare-workouts";
import { guardChange } from "../lib/agent/change-guards";
import { newTurnReads, runReadTool } from "../lib/agent/read-tools";
import type { JournalState } from "../lib/model";

const today = "2026-09-24";
function withWorkout() {
  const state = emptyJournal();
  state.activeWorkout = {
    id: "w1",
    title: "Training",
    date: today,
    programId: "open",
    programDayId: "open",
    recovery: "auto",
    athleteNotes: "",
    coachNotes: "",
    exercises: [
      {
        id: "e1",
        exerciseId: "back_squat",
        athleteNotes: "",
        coachCue: "",
        prescribed: {},
        sets: [
          {
            id: "s1",
            weight: "100",
            reps: "5",
            rpe: "",
            result: "success",
            logged: true,
          },
          { id: "s2", weight: "105", reps: "5", rpe: "", result: "" },
        ],
      },
    ],
  } as JournalState["activeWorkout"];
  return state;
}
const correction = (entryId: string, setId: string) => ({
  kind: "correct_workout_set" as const,
  workoutId: "w1",
  entryId,
  setId,
  setChanges: { weight: 107.5 },
});

test("a wrong set or exercise id says which id to copy again", () => {
  assert.throws(
    () => prepareSetCorrection(withWorkout(), correction("e9", "s1"), today),
    /No exercise with that entryId/,
  );
  assert.throws(
    () => prepareSetCorrection(withWorkout(), correction("e1", "s9"), today),
    /No set with that setId/,
  );
  assert.throws(
    () => prepareSetCorrection(withWorkout(), correction("e1", "s2"), today),
    /planned, not logged/,
  );
  const state = withWorkout();
  prepareSetCorrection(state, correction("e1", "s1"), today);
  assert.equal(state.activeWorkout!.exercises[0].sets[0].weight, 107.5);
});

test("a cardio correction with an unknown id says the id is wrong, not unread", async () => {
  const state = emptyJournal();
  const run = saveCardio(
    state,
    { date: "2026-09-23", activity: "running", durationSeconds: 1800 },
    today,
  );
  const guard = (cardioId: string) =>
    guardChange(
      { kind: "update_cardio", cardioId, changes: { distanceKm: 5.6 } },
      {
        userId: "u",
        state,
        reads: newTurnReads(),
        viewedImageIds: new Set(),
        message: "Correction",
        recent: [],
        saving: true,
      },
    );
  await assert.rejects(
    guard(crypto.randomUUID()),
    /No activity with that cardioId/,
  );
  await assert.rejects(guard(run.id), /Read the full original cardio activity/);
});

test("an exercise name used as a filter id reads that exercise; an unknown one is refused", async () => {
  const state = withWorkout();
  const history = structuredClone(state.activeWorkout!);
  history.id = "h1";
  history.date = "2026-09-17";
  history.exercises = [
    { ...history.exercises[0], id: "e2", exerciseId: "clean_and_jerk" },
    { ...history.exercises[0], id: "e3", exerciseId: "custom:Zercher squat" },
  ];
  state.sessions.push(history);
  const ctx = {
    userId: "u",
    state,
    currentDate: today,
    timezone: "UTC",
    reads: newTurnReads(),
  };
  const summary = async (exerciseId: string) =>
    (await runReadTool(
      "training_summary",
      { from: "2026-09-14", exerciseId },
      ctx,
    )) as { sessions: number; records: { exerciseId: string }[] };
  // Before, "clean and jerk" matched nothing and read as "no sessions".
  for (const name of ["clean_and_jerk", "clean and jerk", "Clean & Jerk"]) {
    const read = await summary(name);
    assert.equal(read.sessions, 1, name);
    assert.equal(read.records[0].exerciseId, "clean_and_jerk");
  }
  const custom = (await runReadTool(
    "find_sessions",
    { exerciseId: "zercher squat" },
    ctx,
  )) as { sessions: { id: string }[] };
  assert.deepEqual(
    custom.sessions.map((s) => s.id),
    ["h1"],
  );
  // A catalogue exercise the athlete never did is a real empty answer.
  assert.equal((await summary("front squat")).sessions, 0);
  await assert.rejects(
    summary("squats"),
    /No exercise has the id "squats"\. Use an exact exerciseId such as .*back_squat/,
  );
  await assert.rejects(
    runReadTool("lifting_review", { exerciseId: "clean and jerks" }, ctx),
    /No exercise has the id/,
  );
  // A filtered read still doesn't count as reading every session of the dates.
  assert.deepEqual(ctx.reads.trainingRanges, []);
});
