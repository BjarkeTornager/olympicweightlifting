import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyJournal } from "../lib/domain";
import { saveCardio } from "../lib/cardio";
import { prepareSetCorrection } from "../lib/agent/prepare-workouts";
import { guardChange } from "../lib/agent/change-guards";
import { newTurnReads } from "../lib/agent/read-tools";
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
