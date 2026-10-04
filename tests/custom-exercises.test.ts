import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorkout, emptyJournal } from "../lib/domain";
import {
  canonicalCustomName,
  customExerciseId,
  customExerciseIds,
  exerciseKey,
  resolveExerciseId,
} from "../lib/exercises";
import { prepareAction } from "../lib/agent/actions";
import { newTurnReads, runReadTool } from "../lib/agent/read-tools";
import type { JournalState } from "../lib/model";
import { mixedProgram } from "./fixtures/training-programs";

const today = "2026-10-04";
const fly = "custom:Standing cable reverse fly";
const done = (weight: number, reps: number) => ({
  weight,
  reps,
  result: "success" as const,
});
const withWorkout = () => {
  const state = emptyJournal();
  state.activeWorkout = createWorkout(state, undefined, today);
  return state;
};
// A finished session holding one exercise, as the journal stores it.
const session = (state: JournalState, date: string, exerciseId: string) =>
  state.sessions.push({
    ...createWorkout(state, undefined, date),
    exercises: [
      {
        id: crypto.randomUUID(),
        exerciseId,
        athleteNotes: "",
        coachCue: "",
        prescribed: {},
        sets: [
          {
            id: crypto.randomUUID(),
            weight: "10",
            reps: "10",
            rpe: "",
            result: "success",
            logged: true,
          },
        ],
      },
    ],
    finishedAt: `${date}T18:00:00Z`,
  });
const logSets = (exerciseId: string, sets = [done(10, 10)]) => ({
  kind: "log_sets",
  exerciseId,
  sets,
});

test("a custom exercise name is saved as one tidy line, refused rather than cut", () => {
  assert.equal(
    canonicalCustomName("  standing   cable\treverse fly\n"),
    "Standing cable reverse fly",
  );
  // Only the first letter changes: the rest stays as typed.
  assert.equal(canonicalCustomName("eZ-bar curl"), "EZ-bar curl");
  assert.equal(canonicalCustomName("RDL off blocks"), "RDL off blocks");
  // A doubled prefix, zero-width and control characters go; NFC composes.
  assert.equal(
    canonicalCustomName("custom: custom:Zercher squat"),
    "Zercher squat",
  );
  assert.equal(canonicalCustomName("cable\u200b fly\u0007"), "Cable fly");
  assert.equal(canonicalCustomName("cafe\u0301 squat"), "Café squat");
  assert.equal(customExerciseId("landmine squat"), "custom:Landmine squat");
  assert.throws(
    () => canonicalCustomName(" \u200b "),
    /Give the exercise a name/,
  );
  assert.throws(
    () => canonicalCustomName("custom:"),
    /Give the exercise a name/,
  );
  // 120 UTF-16 units at most: an emoji counts twice.
  assert.equal(canonicalCustomName("a".repeat(120)).length, 120);
  assert.equal(canonicalCustomName("🏋".repeat(60)).length, 120);
  assert.throws(() => canonicalCustomName("a".repeat(121)), /at most 120/);
  assert.throws(() => canonicalCustomName("🏋".repeat(61)), /at most 120/);
});

test("exercise keys compare names, ids and spellings", () => {
  assert.equal(exerciseKey("Clean & Jerk"), "clean and jerk");
  assert.equal(exerciseKey("clean_and_jerk"), "clean and jerk");
  assert.equal(
    exerciseKey("custom:Standing  cable_reverse-FLY"),
    "standing cable reverse fly",
  );
  assert.equal(exerciseKey("custom:custom:Cable\u200bfly"), "cablefly");
});

test("the athlete's own exercises come from every place they are saved", () => {
  const state = withWorkout();
  session(state, "2026-09-01", "custom:Old movement");
  session(state, "2026-10-01", "custom:Recent movement");
  session(state, "2026-10-02", "back_squat");
  state.templates.push({
    id: "t",
    name: "Pull",
    exercises: [
      { exerciseId: "custom:Band pull-apart", sets: [{ weight: 0, reps: 15 }] },
    ],
  });
  state.activeWorkout = prepareAction(
    state,
    logSets(fly),
    today,
  ).state.activeWorkout;
  const programmed = prepareAction(
    state,
    { kind: "create_training_program", trainingProgram: mixedProgram },
    today,
  ).state;
  assert.deepEqual(customExerciseIds(programmed), [
    fly,
    "custom:Recent movement",
    "custom:Old movement",
    "custom:Band pull-apart",
    "custom:Landmine squat",
  ]);
});

test("ids resolve to the catalogue on a whole name or alias, to the athlete's own spelling, or to a new canonical id", () => {
  const state = emptyJournal();
  assert.equal(resolveExerciseId(state, "back_squat"), "back_squat");
  assert.equal(resolveExerciseId(state, "custom:Back squat"), "back_squat");
  assert.equal(
    resolveExerciseId(state, "custom:clean & jerk"),
    "clean_and_jerk",
  );
  assert.equal(resolveExerciseId(state, "custom:rear delt fly"), "reverse_fly");
  // No near matches: a cable reverse fly is not the dumbbell reverse fly.
  assert.equal(
    resolveExerciseId(state, "custom:standing cable reverse fly"),
    fly,
  );
  assert.equal(
    resolveExerciseId(state, "custom:cable reverse fly"),
    "custom:Cable reverse fly",
  );
  // The catalogue's own short name for a lift counts as its name.
  assert.equal(resolveExerciseId(state, "custom:reverse fly"), "reverse_fly");
  // An alias of two lifts names neither.
  assert.equal(
    resolveExerciseId(state, "custom:overhead press"),
    "custom:Overhead press",
  );
  // Ids that are neither pass through, for validation to refuse.
  assert.equal(
    resolveExerciseId(state, "invented_gym_exercise"),
    "invented_gym_exercise",
  );
  // An older spelling the athlete already has is reused exactly as stored.
  session(state, "2026-09-20", "custom:standing Cable reverse fly ");
  for (const id of [
    fly,
    "custom:STANDING CABLE REVERSE FLY",
    "custom:standing Cable reverse fly ",
  ])
    assert.equal(
      resolveExerciseId(state, id),
      "custom:standing Cable reverse fly ",
    );
  // Resolving a resolved id changes nothing.
  const once = resolveExerciseId(emptyJournal(), "custom:  landmine   squat");
  assert.equal(once, "custom:Landmine squat");
  assert.equal(resolveExerciseId(emptyJournal(), once), once);
  // An entry already in the workout in progress keeps its id, so the app
  // logging its next set joins it, even under an older catalogue name.
  const legacy = withWorkout();
  legacy.activeWorkout!.exercises = prepareAction(
    withWorkout(),
    logSets("custom:Zercher squat"),
    today,
  ).state.activeWorkout!.exercises.map((e) => ({
    ...e,
    exerciseId: "custom:Back squat",
  }));
  const next = prepareAction(legacy, logSets("custom:Back squat"), today);
  assert.deepEqual(
    next.state.activeWorkout!.exercises.map((e) => [
      e.exerciseId,
      e.sets.length,
    ]),
    [["custom:Back squat", 2]],
  );
});

test("log_sets with two spellings of a new exercise fills one workout entry", () => {
  const first = prepareAction(
    withWorkout(),
    logSets("custom:standing cable reverse fly", [done(10, 10), done(15, 10)]),
    today,
  );
  assert.equal(first.title, "Log 2 Standing cable reverse fly sets");
  assert.equal(
    first.action.kind === "log_sets" && first.action.exerciseId,
    fly,
  );
  const second = prepareAction(
    first.state,
    logSets("custom:Standing Cable Reverse Fly", [done(15, 8), done(15, 8)]),
    today,
  );
  const entries = second.state.activeWorkout!.exercises;
  assert.deepEqual(
    entries.map((e) => [e.exerciseId, e.sets.length]),
    [[fly, 4]],
  );
  // A catalogue name in the custom namespace is the catalogue exercise.
  const squat = prepareAction(
    second.state,
    logSets("custom:Back squat"),
    today,
  );
  assert.deepEqual(
    squat.state.activeWorkout!.exercises.map((e) => e.exerciseId),
    [fly, "back_squat"],
  );
  assert.throws(
    () => prepareAction(withWorkout(), logSets("custom:\u200b"), today),
    /Give the exercise a name/,
  );
});

test("log_workout_progress and a bundle join the exercise already in the workout", () => {
  const started = prepareAction(withWorkout(), logSets(fly), today).state;
  const raw = {
    kind: "log_workout_progress",
    completion: "ongoing",
    workout: {
      title: "Upper",
      date: today,
      category: "open",
      exercises: [
        {
          exerciseId: "custom:standing cable reverse fly",
          sets: [done(15, 10)],
        },
        {
          exerciseId: "custom:STANDING cable reverse fly",
          sets: [done(15, 8)],
        },
      ],
    },
  };
  const progress = prepareAction(started, raw, today);
  assert.deepEqual(
    progress.state.activeWorkout!.exercises.map((e) => [
      e.exerciseId,
      e.sets.length,
    ]),
    [[fly, 3]],
  );
  // What the model sent is left as it was; the saved action is resolved.
  assert.equal(
    raw.workout.exercises[0].exerciseId,
    "custom:standing cable reverse fly",
  );
  const bundle = prepareAction(
    started,
    {
      kind: "record_bundle",
      entries: [
        { kind: "record_checkin", checkin: { date: today, sleepHours: 7 } },
        {
          ...raw,
          workout: { ...raw.workout, exercises: [raw.workout.exercises[0]] },
        },
      ],
    },
    today,
  );
  assert.deepEqual(
    bundle.state.activeWorkout!.exercises.map((e) => [
      e.exerciseId,
      e.sets.length,
    ]),
    [[fly, 2]],
  );
  assert.ok(
    bundle.action.kind === "record_bundle" &&
      bundle.action.entries[1].kind === "log_workout_progress" &&
      bundle.action.entries[1].workout.exercises[0].exerciseId === fly,
  );
});

test("routines and programmes save the athlete's own spelling too", () => {
  const state = prepareAction(withWorkout(), logSets(fly), today).state;
  const routine = prepareAction(
    state,
    {
      kind: "create_routine",
      routine: {
        name: "Shoulders",
        exercises: [
          {
            exerciseId: "custom:standing cable reverse fly",
            sets: [{ weight: 10, reps: 12 }],
          },
          { exerciseId: "custom:Push press", sets: [{ weight: 50, reps: 5 }] },
        ],
      },
    },
    today,
  );
  assert.deepEqual(
    routine.state.templates[0].exercises.map((e) => e.exerciseId),
    [fly, "push_press"],
  );
  const programme = structuredClone(mixedProgram);
  programme.days[0].exercises[1].exerciseId = "custom:landmine  squat";
  const planned = prepareAction(
    state,
    { kind: "create_training_program", trainingProgram: programme },
    today,
  );
  assert.equal(
    planned.training?.kind === "program" &&
      planned.training.after.days[0].exercises[1].exerciseId,
    "custom:Landmine squat",
  );
});

test("the exercises tool offers the athlete's own exercises and a ready id for a movement the catalogue lacks", async () => {
  const state = emptyJournal();
  const ctx = {
    userId: "u",
    state,
    currentDate: today,
    timezone: "UTC",
    reads: newTurnReads(),
  };
  type Found = {
    id: string;
    category: string;
    custom?: boolean;
    loggingNotes: string;
  }[];
  const search = async (args: object) =>
    (await runReadTool("exercises", args, ctx)) as Found;
  const fresh = await search({ query: "standing cable reverse fly" });
  assert.deepEqual(
    fresh.map((e) => [e.id, e.custom]),
    [[fly, true]],
  );
  assert.match(fresh[0].loggingNotes, /use this id to log, plan or add it/);
  // A catalogue name or alias, an alias of two lifts, or a muscle or
  // equipment word is never offered as a new exercise.
  for (const query of [
    "back squat",
    "rear delt fly",
    "overhead press",
    "chest",
    "dumbbell",
  ])
    assert.ok(!(await search({ query })).some((e) => e.custom), query);
  const batch = await search({
    queries: ["back squat", "Standing cable reverse fly"],
  });
  assert.equal(batch[0].id, "back_squat");
  assert.deepEqual(
    batch.filter((e) => e.custom).map((e) => e.id),
    [fly],
  );
  assert.equal(batch.at(-1)!.id, fly);
  // Once logged, it is the athlete's own and keeps their spelling.
  session(state, "2026-10-01", "custom:standing Cable reverse fly");
  const own = await search({ query: "Standing cable reverse fly" });
  assert.deepEqual(
    own.map((e) => [e.id, e.category]),
    [["custom:standing Cable reverse fly", "The athlete's own exercises"]],
  );
  const related = await search({ query: "reverse fly" });
  assert.ok(related.some((e) => e.id === "reverse_fly"));
  assert.ok(related.some((e) => e.id === "custom:standing Cable reverse fly"));
});

test("a history search by the athlete's own exercise is honest when it was never logged", async () => {
  const state = emptyJournal();
  session(state, "2026-10-01", "custom:standing Cable reverse fly");
  const ctx = {
    userId: "u",
    state,
    currentDate: today,
    timezone: "UTC",
    reads: newTurnReads(),
  };
  const find = async (exerciseId: string) =>
    (await runReadTool("find_sessions", { exerciseId }, ctx)) as {
      total: number;
    };
  assert.equal((await find("custom:Landmine squat")).total, 0);
  // Another spelling of a logged one finds it.
  assert.equal((await find(fly)).total, 1);
  assert.equal((await find("custom:STANDING CABLE REVERSE FLY")).total, 1);
  // custom:Back squat reads the catalogue lift, which isn't logged either.
  assert.equal((await find("custom:Back squat")).total, 0);
  assert.deepEqual(ctx.reads.trainingRanges, []);
});
