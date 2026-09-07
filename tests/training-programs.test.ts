import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptyJournal,
  exerciseName,
  mergeImport,
  backup,
  parseLegacyBackup,
} from "../lib/domain";
import { prepareAction, actionToolSchema } from "../lib/agent/actions";
import { journalSchema } from "../lib/model";
import { trainingPrograms, startTrainingDay } from "../lib/training-programs";
import { trainingProgramSchema } from "../lib/training-program-schema";

import { simpleRoutine, mixedProgram } from "./fixtures/training-programs";
const date = "2026-09-07";
test("Coach creates the screenshot routine from scratch, edits it and starts only unlogged sets", () => {
  const initial = emptyJournal();
  const created = prepareAction(
    initial,
    { kind: "create_routine", routine: simpleRoutine },
    date,
  );
  assert.equal(initial.templates.length, 0);
  assert.equal(created.workout, null);
  assert.equal(created.state.activeWorkout, null);
  assert.equal(created.state.sessions.length, 0);
  assert.ok(created.training?.kind === "routine");
  assert.deepEqual(created.training?.after.exercises, simpleRoutine.exercises);
  const id = created.state.templates[0].id;
  const changed = structuredClone(simpleRoutine);
  changed.exercises[0].sets[1].weight = 37.5;
  const edited = prepareAction(
    created.state,
    { kind: "update_routine", routineId: id, routine: changed },
    date,
  );
  assert.equal(edited.state.templates.length, 1);
  assert.equal(edited.state.templates[0].id, id);
  assert.deepEqual(
    edited.state.templates[0].exercises[1],
    simpleRoutine.exercises[1],
  );
  assert.deepEqual(edited.training?.before, created.state.templates[0]);
  const started = prepareAction(
    edited.state,
    { kind: "start_routine", routineId: id, date },
    date,
  );
  assert.equal(started.workout?.exercises[0].sets[1].weight, 37.5);
  assert.ok(
    started.workout?.exercises.every(
      (e) => !e.completed && e.sets.every((s) => !s.logged && !s.result),
    ),
  );
  const deleted = prepareAction(
    started.state,
    { kind: "delete_routine", routineId: id },
    date,
  );
  assert.equal(deleted.state.templates.length, 0);
  assert.deepEqual(deleted.state.activeWorkout, started.workout);
  assert.throws(
    () =>
      prepareAction(
        initial,
        { kind: "update_routine", routineId: id, routine: changed },
        date,
      ),
    /not in your journal/,
  );
});
test("multi-day programs preserve unknown loads, custom movements, ranges and planned cardio without logging results", () => {
  const created = prepareAction(
    emptyJournal(),
    { kind: "create_training_program", trainingProgram: mixedProgram },
    date,
  );
  const p = trainingPrograms(created.state)[0];
  assert.equal(created.workout, null);
  assert.equal(p.days.length, 3);
  const workout = startTrainingDay(p, p.days[0].id, date);
  assert.equal(workout.programId, p.id);
  assert.equal(workout.programDayId, p.days[0].id);
  assert.equal(workout.exercises[0].prescribed.reps, "10–12");
  assert.equal(workout.exercises[0].prescribed.targetRpe, 7);
  assert.equal(
    workout.exercises[0].sets[0].rpe,
    undefined,
    "Target effort is not measured effort",
  );
  assert.equal(workout.exercises[1].sets[0].weight, "");
  assert.equal(exerciseName(workout.exercises[1].exerciseId), "Landmine squat");
  assert.ok(
    workout.exercises.every((e) => e.sets.every((s) => !s.logged && !s.result)),
  );
  assert.equal(created.state.cardio.sessions.length, 0);
  const detailed = structuredClone(p);
  detailed.days[0].cardio = Array.from({ length: 10 }, () => ({
    activity: "walking",
    durationSeconds: 60,
    notes: "A".repeat(2000),
  }));
  assert.doesNotThrow(() =>
    journalSchema.parse({
      ...created.state,
      activeWorkout: startTrainingDay(detailed, detailed.days[0].id, date),
    }),
  );
  assert.equal(
    detailed.days[0].cardio[0].notes?.length,
    2000,
    "The complete instructions remain in the program",
  );
  assert.throws(
    () => startTrainingDay(p, p.days[1].id, date),
    /no strength sets/,
  );
  const state = { ...created.state, activeWorkout: workout };
  const edited = prepareAction(
    state,
    {
      kind: "update_training_program",
      trainingProgramId: p.id,
      programChanges: { name: "Revised plan" },
    },
    date,
  );
  assert.deepEqual(trainingPrograms(edited.state)[0].days, p.days);
  assert.deepEqual(edited.state.activeWorkout, workout);
  assert.deepEqual(edited.training?.before, p);
  const days = structuredClone(p.days);
  days[0].exercises[0].weight = 40;
  [days[0], days[2]] = [days[2], days[0]];
  const reordered = prepareAction(
    edited.state,
    {
      kind: "update_training_program",
      trainingProgramId: p.id,
      programChanges: { days },
    },
    date,
  );
  assert.equal(
    trainingPrograms(reordered.state)[0].days[2].exercises[0].weight,
    40,
  );
  assert.deepEqual(reordered.state.activeWorkout, workout);
  assert.throws(
    () =>
      prepareAction(
        state,
        {
          kind: "start_training_day",
          trainingProgramId: p.id,
          dayId: p.days[0].id,
          date,
        },
        date,
      ),
    /unfinished/,
  );
  assert.throws(
    () =>
      prepareAction(
        emptyJournal(),
        { kind: "delete_training_program", trainingProgramId: p.id },
        date,
      ),
    /not in your journal/,
  );
  const deleted = prepareAction(
    state,
    { kind: "delete_training_program", trainingProgramId: p.id },
    date,
  );
  assert.equal(trainingPrograms(deleted.state).length, 0);
  assert.deepEqual(deleted.state.activeWorkout, workout);
});
test("program validation rejects incorrect IDs, duplicate days, reversed rep ranges and completed-set fields", () => {
  const created = prepareAction(
    emptyJournal(),
    { kind: "create_training_program", trainingProgram: mixedProgram },
    date,
  );
  const p = trainingPrograms(created.state)[0];
  assert.throws(
    () => trainingProgramSchema.parse({ ...p, days: [p.days[0], p.days[0]] }),
    /Duplicate/,
  );
  assert.throws(
    () =>
      journalSchema.parse({
        ...created.state,
        program: { ...created.state.program, customPrograms: [p, p] },
      }),
    /Duplicate/,
  );
  assert.throws(() =>
    journalSchema.parse({
      ...created.state,
      program: {
        ...created.state.program,
        customPrograms: [{ ...p, days: [] }],
      },
    }),
  );
  const invalid = structuredClone(mixedProgram);
  invalid.days[0].exercises[0].repsMax = 5;
  assert.throws(
    () =>
      prepareAction(
        emptyJournal(),
        { kind: "create_training_program", trainingProgram: invalid },
        date,
      ),
    /Maximum reps/,
  );
  assert.throws(
    () =>
      prepareAction(
        created.state,
        {
          kind: "update_training_program",
          trainingProgramId: p.id,
          programChanges: { days: [{ ...p.days[0], id: crypto.randomUUID() }] },
        },
        date,
      ),
    /must belong/,
  );
  assert.equal(
    actionToolSchema.safeParse({
      kind: "create_routine",
      routine: {
        ...simpleRoutine,
        exercises: [
          {
            exerciseId: "made_up_catalogue_id",
            sets: [{ weight: 10, reps: 8 }],
          },
        ],
      },
    }).success,
    false,
  );
  assert.equal(
    actionToolSchema.safeParse({
      kind: "create_routine",
      routine: {
        ...simpleRoutine,
        exercises: [
          {
            exerciseId: "seated_leg_curl",
            sets: [{ weight: 10, reps: 8, result: "success" }],
          },
        ],
      },
    }).success,
    false,
  );
});
test("programs survive old-client round trips and backup merges without overwriting existing plans", () => {
  const a = prepareAction(
    emptyJournal(),
    { kind: "create_training_program", trainingProgram: mixedProgram },
    date,
  ).state;
  a.program.customPrograms.push({
    id: "legacy-plan",
    name: "Legacy opaque plan",
    oldField: true,
  });
  const restored = parseLegacyBackup(backup(a));
  assert.deepEqual(restored.program.customPrograms, a.program.customPrograms);
  const b = prepareAction(
    emptyJournal(),
    {
      kind: "create_training_program",
      trainingProgram: { ...mixedProgram, name: "Second plan" },
    },
    date,
  ).state;
  const merged = mergeImport(a, b);
  assert.equal(trainingPrograms(merged).length, 2);
  assert.equal(mergeImport(merged, restored).program.customPrograms.length, 3);
  const conflicting = structuredClone(a);
  (conflicting.program.customPrograms[0] as { name: string }).name =
    "Conflicting edit";
  assert.throws(() => mergeImport(a, conflicting), /different version/);
});
