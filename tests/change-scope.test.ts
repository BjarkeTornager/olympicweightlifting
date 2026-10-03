import { test } from "node:test";
import assert from "node:assert/strict";
import { EXERCISES, createWorkout, emptyJournal } from "../lib/domain";
import { saveCardio } from "../lib/cardio";
import { saveCheckin } from "../lib/health";
import { addDrink } from "../lib/hydration";
import { actionSchema } from "../lib/agent/actions";
import { unchangedFor } from "../lib/agent/change-scope";
import type { JournalState } from "../lib/model";

const date = "2026-09-08",
  dayBefore = "2026-09-07";
const action = (raw: unknown) => actionSchema.parse(raw);
// Whether a change Coach asked for on `seen` still holds after `save`.
const holds = (
  raw: unknown,
  save: (state: JournalState) => void,
  seen = emptyJournal(),
) => {
  const current = structuredClone(seen);
  save(current);
  return unchangedFor(action(raw), seen, current);
};
const checkin = { kind: "record_checkin", checkin: { date, sleepHours: 7 } };
const drink = {
  kind: "log_drink",
  drink: { date, ml: 250, kind: "water" as const },
};

test("a logged change holds while another save leaves its day alone", () => {
  // Health importing the night before, a profile edit, a drink: none touch
  // today's check-in.
  assert.ok(
    holds(checkin, (s) =>
      saveCheckin(s, { date: dayBefore, sleepHours: 6 }, date),
    ),
  );
  assert.ok(holds(checkin, (s) => (s.profile.bodyweight = 81)));
  assert.ok(holds(checkin, (s) => addDrink(s, drink.drink)));
  // Today's check-in was saved meanwhile.
  assert.ok(
    !holds(checkin, (s) => saveCheckin(s, { date, sleepHours: 6 }, date)),
  );
  // Another drink today: logging this one again could double it.
  assert.ok(!holds(drink, (s) => addDrink(s, drink.drink)));
});

test("a correction holds only while its entry is untouched", () => {
  const seen = emptyJournal();
  const run = saveCardio(
    seen,
    { date: dayBefore, activity: "running", durationSeconds: 1500 },
    date,
  );
  const correct = {
    kind: "update_cardio",
    cardioId: run.id,
    changes: { distanceKm: 5 },
  };
  const walk = { date, activity: "walking", durationSeconds: 1200 };
  assert.ok(holds(correct, (s) => saveCardio(s, walk, date), seen));
  assert.ok(
    !holds(
      correct,
      (s) => saveCardio(s, { averageHeartRate: 150 }, date, run.id),
      seen,
    ),
  );
  // Moving it to a day that gained an activity meanwhile.
  assert.ok(
    !holds(
      { ...correct, changes: { date } },
      (s) => saveCardio(s, walk, date),
      seen,
    ),
  );
});

test("training changes hold only while the workout and history are untouched", () => {
  const seen = emptyJournal();
  seen.activeWorkout = createWorkout(seen, undefined, date);
  const logSets = {
    kind: "log_sets",
    exerciseId: EXERCISES[0].id,
    sets: [{ weight: 100, reps: 3, result: "success" }],
  };
  assert.ok(holds(logSets, (s) => addDrink(s, drink.drink), seen));
  assert.ok(
    !holds(logSets, (s) => (s.activeWorkout!.athleteNotes = "Felt good"), seen),
  );
});

test("a bundle holds only while every entry's part does", () => {
  const bundle = { kind: "record_bundle", entries: [checkin, drink] };
  assert.ok(holds(bundle, (s) => (s.profile.bodyweight = 81)));
  assert.ok(!holds(bundle, (s) => addDrink(s, drink.drink)));
});

test("a change with no listed part depends on the whole journal", () => {
  const targets = {
    kind: "set_diet_targets",
    targets: { goal: "maintain", calories: 2500 },
  };
  assert.ok(!holds(targets, (s) => (s.profile.bodyweight = 81)));
});
