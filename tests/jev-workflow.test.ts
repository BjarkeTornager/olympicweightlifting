import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyJournal } from "../lib/domain";
import { saveCheckin } from "../lib/health";
import { prepareAction } from "../lib/agent/actions";
import {
  scenarios,
  checkJournal,
  TEST_DATE,
} from "../scripts/jev/workflow-fixtures";

test("workflow checks detect dropped correction fields and unauthorized preview saves", () => {
  const before = emptyJournal();
  saveCheckin(
    before,
    { date: TEST_DATE, sleepHours: 7.5, waterMl: 750 },
    TEST_DATE,
  );
  const after = structuredClone(before);
  saveCheckin(after, { date: TEST_DATE, waterMl: 1250 }, TEST_DATE);
  const correction = scenarios.find((s) => s.id === "checkin_preservation")!
    .turns[1];
  assert.deepEqual(checkJournal(before, after, correction), []);
  after.health.checkins[0].sleepHours = null;
  assert.match(checkJournal(before, after, correction).join(" "), /sleepHours/);
  assert.match(
    checkJournal(
      before,
      after,
      scenarios.find((s) => s.id === "preview_only")!.turns[0],
    ).join(" "),
    /Unexpected mutation: health/,
  );
});

test("workflow checks count equal sets and distinguish ongoing from completed workouts", () => {
  const before = emptyJournal();
  const workout = {
    title: "Synthetic",
    date: TEST_DATE,
    category: "accessories",
    exercises: [
      {
        exerciseId: "back_squat",
        sets: [{ weight: 80, reps: 5, result: "success" }],
      },
    ],
  };
  const one = prepareAction(
    before,
    { kind: "log_workout_progress", workout, completion: "ongoing" },
    TEST_DATE,
  ).state;
  const spec = scenarios.find((s) => s.id === "strength_continuity")!.turns[1];
  assert.match(checkJournal(before, one, spec).join(" "), /active/);
  const two = prepareAction(
    one,
    { kind: "log_workout_progress", workout, completion: "ongoing" },
    TEST_DATE,
  ).state;
  assert.deepEqual(checkJournal(one, two, spec), []);
  const finished = prepareAction(
    two,
    { kind: "finish_workout" },
    TEST_DATE,
  ).state;
  assert.match(checkJournal(two, finished, spec).join(" "), /active/);
});
