import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyJournal, mergeImport } from "../lib/domain";
import {
  formatSet,
  startTemplate,
  templateFromWorkout,
  trainingSummary,
  weeklyVolume,
} from "../lib/training";
import { prepareAction } from "../lib/agent/actions";
import { athleteDate } from "../lib/agent/engine";
const input = {
  kind: "record_session",
  workout: {
    title: "Accessory training",
    date: "2026-09-05",
    category: "accessories",
    exercises: [
      {
        exerciseId: "romanian_deadlift",
        sets: [
          { weight: 60, reps: 8, result: "success" },
          { weight: 80, reps: 8, result: "success" },
          { weight: 100, reps: 8, result: "success" },
        ],
      },
      {
        exerciseId: "dead_bug",
        sets: [{ weight: 0, reps: 16, result: "success" }],
      },
    ],
  },
};
test("agent prepares exact accessory history without changing the source or inventing timestamps", () => {
  const state = emptyJournal(),
    prepared = prepareAction(state, input, "2026-09-06");
  assert.equal(state.sessions.length, 0);
  assert.equal(prepared.state.sessions.length, 1);
  assert.equal(prepared.workout!.programDayId, "gym_accessories");
  assert.equal(prepared.workout!.finishedAt, undefined);
  assert.equal(prepared.workout!.exercises[1].sets[0].weight, 0);
  assert.equal(
    prepared.state.prs.romanian_deadlift,
    state.prs.romanian_deadlift,
  );
  assert.throws(
    () =>
      prepareAction(
        state,
        { ...input, workout: { ...input.workout, date: "2026-09-07" } },
        "2026-09-06",
      ),
    /future/,
  );
  assert.throws(() =>
    prepareAction(
      state,
      {
        ...input,
        workout: {
          ...input.workout,
          exercises: [
            {
              exerciseId: "sql_exec",
              sets: [{ weight: 10, reps: 8, result: "success" }],
            },
          ],
        },
      },
      "2026-09-06",
    ),
  );
  assert.throws(() =>
    prepareAction(state, { ...input, userId: "someone-else" }, "2026-09-06"),
  );
});
test("repeat and routine import preserve set values with fresh IDs and no completed flags", () => {
  const state = prepareAction(emptyJournal(), input, "2026-09-06").state,
    original = state.sessions[0];
  const template = templateFromWorkout(original),
    repeat = startTemplate(template, "2026-09-06");
  assert.notEqual(repeat.id, original.id);
  assert.notEqual(repeat.exercises[0].id, original.exercises[0].id);
  assert.ok(
    repeat.exercises.every(
      (e) => !e.completed && e.sets.every((s) => !s.logged && !s.result),
    ),
  );
  assert.equal(repeat.exercises[0].sets[2].weight, 100);
  const incoming = emptyJournal();
  incoming.templates = [template];
  const merged = mergeImport(state, incoming);
  assert.equal(mergeImport(merged, incoming).templates.length, 1);
  incoming.templates[0] = { ...template, name: "Conflicting title" };
  assert.throws(() => mergeImport(merged, incoming), /different version/);
});
test("agent fills only pending sets and refuses to replace an unfinished workout", () => {
  let state = prepareAction(
    emptyJournal(),
    { ...input, kind: "plan_workout" },
    "2026-09-06",
  ).state;
  assert.throws(
    () =>
      prepareAction(
        state,
        { kind: "start_programme", dayId: "monday", date: "2026-09-06" },
        "2026-09-06",
      ),
    /unfinished/,
  );
  state = prepareAction(
    state,
    {
      kind: "log_sets",
      exerciseId: "romanian_deadlift",
      sets: [{ weight: 62.5, reps: 8, result: "success" }],
    },
    "2026-09-06",
  ).state;
  state = prepareAction(
    state,
    {
      kind: "log_sets",
      exerciseId: "romanian_deadlift",
      sets: [{ weight: 82.5, reps: 8, result: "success" }],
    },
    "2026-09-06",
  ).state;
  assert.deepEqual(
    state.activeWorkout!.exercises[0].sets.map((s) => s.weight),
    [62.5, 82.5, 100],
  );
  const finished = prepareAction(
    state,
    { kind: "finish_workout" },
    "2026-09-06",
  ).state;
  assert.equal(finished.sessions[0].exercises.length, 1);
  assert.equal(finished.sessions[0].exercises[0].sets.length, 2);
  assert.equal(finished.activeWorkout, null);
  assert.throws(
    () =>
      prepareAction(
        finished,
        {
          kind: "update_session",
          sessionId: "not-owned",
          workout: input.workout,
        },
        "2026-09-06",
      ),
    /not in your journal/,
  );
});
test("volume, rep records and local calendar dates remain accurate", () => {
  const state = prepareAction(emptyJournal(), input, "2026-09-06").state;
  state.sessions[0].exercises[0].sets.push({
    id: "miss",
    weight: 120,
    reps: 8,
    result: "miss",
    logged: true,
  });
  const stats = trainingSummary(state, "2026-09-01", "2026-09-06");
  assert.equal(stats.sets, 5);
  assert.equal(stats.volume, 1920);
  assert.equal(stats.reps, 40);
  assert.equal(
    stats.records.find((r) => r.exerciseId === "romanian_deadlift")!.weight,
    100,
  );
  assert.equal(weeklyVolume(state)[0].week, "2026-08-31");
  assert.equal(formatSet(0, 16), "Bodyweight × 16");
  assert.equal(
    athleteDate("Europe/Copenhagen", new Date("2026-09-05T23:30:00Z")),
    "2026-09-06",
  );
  assert.equal(
    athleteDate("America/Los_Angeles", new Date("2026-09-06T01:30:00Z")),
    "2026-09-05",
  );
});
