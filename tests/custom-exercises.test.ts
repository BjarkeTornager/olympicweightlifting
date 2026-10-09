import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorkout, emptyJournal } from "../lib/domain";
import {
  canonicalCustomName,
  customExerciseId,
  customExerciseIds,
  exerciseKey,
  newExerciseFor,
  ownExercises,
  resolveExerciseId,
} from "../lib/exercises";
import { buildTraining } from "../lib/native-training";
import { prepareAction } from "../lib/agent/actions";
import { receiptEntryView } from "../lib/native-api";
import { plannedSetsText } from "../lib/training";
import { guardChange } from "../lib/agent/change-guards";
import { newTurnReads, runReadTool } from "../lib/agent/read-tools";
import { isValidLoggedSet } from "../js/progression.js";
import type { JournalState } from "../lib/model";
import { trainingPrograms } from "../lib/training-programs";
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
  // A name that shows nothing, or no letter or number, is no name: a
  // combining mark, a variation selector, a blank filler letter, the braille
  // blank or emoji alone.
  for (const blank of ["\u0301", "\uFE0F", "\u3164", "\u2800 \u115F", "🏋💪"])
    assert.throws(
      () => canonicalCustomName(blank),
      /Give the exercise a name/,
      JSON.stringify(blank),
    );
  assert.equal(canonicalCustomName("\u3164squat\uFE0F"), "Squat");
  // 120 UTF-16 units at most: an emoji counts twice.
  assert.equal(canonicalCustomName("a".repeat(120)).length, 120);
  assert.equal(canonicalCustomName(`Squat ${"🏋".repeat(57)}`).length, 120);
  assert.throws(() => canonicalCustomName("a".repeat(121)), /at most 120/);
  assert.throws(
    () => canonicalCustomName(`Squat ${"🏋".repeat(58)}`),
    /at most 120/,
  );
});

test("exercise keys compare names, ids and spellings", () => {
  assert.equal(exerciseKey("Clean & Jerk"), "clean and jerk");
  assert.equal(exerciseKey("clean_and_jerk"), "clean and jerk");
  assert.equal(
    exerciseKey("custom:Standing  cable_reverse-FLY"),
    "standing cable reverse fly",
  );
  assert.equal(exerciseKey("custom:custom:Cable\u200bfly"), "cablefly");
  // Plurals and the DB short form compare with the catalogue's names.
  assert.equal(exerciseKey("Front squats"), "front squat");
  assert.equal(exerciseKey("Bench presses"), "bench press");
  assert.equal(exerciseKey("cable flies"), "cable fly");
  assert.equal(exerciseKey("Pull-ups"), exerciseKey("pull up"));
  assert.equal(exerciseKey("RDLs"), "rdl");
  assert.equal(exerciseKey("DB row"), "dumbbell row");
  // A vowel sign belongs to its letter, so these two names stay apart.
  assert.notEqual(exerciseKey("काल स्क्वाट"), exerciseKey("किल स्क्वाट"));
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
  // A plural or the DB short form of a catalogue name is that exercise.
  for (const [id, catalogue] of [
    ["custom:Front squats", "front_squat"],
    ["custom:Deadlifts", "deadlift"],
    ["custom:RDLs", "romanian_deadlift"],
    ["custom:DB row", "dumbbell_row"],
    ["custom:Pull-ups", "pull_up"],
    ["custom:Hip thrusts", "hip_thrust"],
  ])
    assert.equal(resolveExerciseId(state, id), catalogue, id);
  // A placeholder for a group of movements is not named by its id:
  // upper_back is "Rows / pull-ups".
  assert.equal(
    resolveExerciseId(state, "custom:Upper back"),
    "custom:Upper back",
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

test("an id the journal already holds stays, so editing a session keeps its entry", () => {
  const state = emptyJournal();
  // Saved before ids were made canonical: custom:Back squat beside the
  // catalogue lift, and two spellings of one exercise.
  session(state, "2026-09-01", "custom:Back squat");
  session(state, "2026-09-02", "custom:cable thing");
  session(state, "2026-09-03", "custom:Cable thing");
  for (const w of state.sessions)
    Object.assign(w.exercises[0], {
      athleteNotes: "Knee felt fine",
      coachCue: "Brace",
      prescribed: { targetSets: 3 },
    });
  const change = (
    kind: "update_session" | "log_workout_progress",
    date: string,
    exerciseId: string,
  ) => {
    const w = state.sessions.find((s) => s.date === date)!;
    return prepareAction(
      state,
      {
        kind,
        sessionId: w.id,
        ...(kind === "log_workout_progress" ? { completion: "completed" } : {}),
        workout: {
          title: w.title,
          date,
          category: "open",
          exercises: [{ exerciseId, sets: [done(100, 5)] }],
        },
      },
      today,
    ).state.sessions.find((s) => s.date === date)!.exercises;
  };
  for (const [date, id, sent] of [
    ["2026-09-01", "custom:Back squat", "custom:Back squat"],
    ["2026-09-02", "custom:cable thing", "custom:cable thing"],
    // Another spelling joins the session's own entry too.
    ["2026-09-02", "custom:cable thing", "custom:CABLE THING"],
  ]) {
    const entry = state.sessions.find((s) => s.date === date)!.exercises[0];
    assert.deepEqual(
      change("update_session", date, sent).map((e) => [
        e.id,
        e.exerciseId,
        e.athleteNotes,
        e.coachCue,
        e.prescribed,
        e.sets.length,
      ]),
      [[entry.id, id, "Knee felt fine", "Brace", { targetSets: 3 }, 1]],
      sent,
    );
    assert.deepEqual(
      change("log_workout_progress", date, sent).map((e) => [
        e.exerciseId,
        e.sets.length,
      ]),
      [[id, 2]],
      sent,
    );
  }
  // An exact id from history is kept, but the workout in progress keeps
  // its own spelling of the exercise.
  state.activeWorkout = createWorkout(state, undefined, today);
  assert.equal(
    resolveExerciseId(state, "custom:cable thing"),
    "custom:cable thing",
  );
  const started = prepareAction(
    state,
    logSets("custom:Cable thing"),
    today,
  ).state;
  const joined = prepareAction(started, logSets("custom:cable thing"), today);
  assert.deepEqual(
    joined.state.activeWorkout!.exercises.map((e) => [
      e.exerciseId,
      e.sets.length,
    ]),
    [["custom:Cable thing", 2]],
  );
  // A programme saved again keeps the ids it holds.
  const created = prepareAction(
    emptyJournal(),
    { kind: "create_training_program", trainingProgram: mixedProgram },
    today,
  ).state;
  const programme = trainingPrograms(created).at(-1)!;
  programme.days[0].exercises[1].exerciseId = "custom:Back squat";
  const days = structuredClone(mixedProgram.days);
  days[0].exercises[1].exerciseId = "custom:Back squat";
  const resaved = prepareAction(
    created,
    {
      kind: "update_training_program",
      trainingProgramId: programme.id,
      programChanges: { name: "Renamed", days },
    },
    today,
  );
  assert.deepEqual(
    resaved.training?.kind === "program" &&
      resaved.training.after.days[0].exercises.map((e) => e.exerciseId),
    ["seated_leg_curl", "custom:Back squat"],
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

test("add_workout_exercise adds planned sets to the workout in progress", () => {
  const add = {
    kind: "add_workout_exercise",
    exerciseId: "custom:standing cable reverse fly",
    plannedSets: [
      { weight: 10, reps: 10 },
      { weight: 15, reps: 10 },
      { weight: 15, reps: 8 },
      { weight: null, reps: 8 },
    ],
    note: "Superset with face pulls.",
  };
  assert.throws(
    () => prepareAction(emptyJournal(), add, today),
    /no workout in progress.*plan_workout/,
  );
  const started = prepareAction(
    withWorkout(),
    logSets("back_squat", [done(100, 5)]),
    today,
  ).state;
  assert.throws(
    () => prepareAction(started, { ...add, workoutId: "w-old" }, today),
    /isn't the workout in progress/,
  );
  const added = prepareAction(
    started,
    { ...add, workoutId: started.activeWorkout!.id },
    today,
  );
  assert.equal(added.title, "Add Standing cable reverse fly to your workout");
  assert.equal(added.workoutReview?.status, "ongoing");
  const [squat, entry] = added.state.activeWorkout!.exercises;
  assert.equal(squat.sets.filter(isValidLoggedSet).length, 1);
  assert.equal(entry.exerciseId, fly);
  // The note goes with the target, where Train and current_workout show
  // it, and the review says it.
  assert.deepEqual(entry.prescribed, {
    targetSets: 4,
    reps: "8–10",
    notes: "Superset with face pulls.",
  });
  assert.match(added.detail, /Note: Superset with face pulls\.$/);
  assert.deepEqual(
    entry.sets.map((s) => [s.weight, s.reps, isValidLoggedSet(s)]),
    [
      [10, 10, false],
      [15, 10, false],
      [15, 8, false],
      ["", 8, false],
    ],
  );
  // More of an exercise already there joins its entry after its own sets.
  const logged = prepareAction(
    added.state,
    logSets(fly, [done(10, 10)]),
    today,
  );
  const more = prepareAction(
    logged.state,
    {
      kind: "add_workout_exercise",
      exerciseId: fly,
      plannedSets: [{ weight: 15, reps: 8 }],
    },
    today,
  );
  assert.equal(
    more.title,
    "Add 1 Standing cable reverse fly set to your workout",
  );
  const flies = more.state.activeWorkout!.exercises.filter(
    (e) => e.exerciseId === fly,
  );
  assert.equal(flies.length, 1);
  assert.deepEqual(
    flies[0].sets.map((s) => [s.weight, s.reps, isValidLoggedSet(s)]),
    [
      [10, 10, true],
      [15, 10, false],
      [15, 8, false],
      ["", 8, false],
      [15, 8, false],
    ],
  );
  assert.equal(flies[0].completed, false);
  // The target counts the new set; its reps already cover it.
  assert.deepEqual(flies[0].prescribed, {
    targetSets: 5,
    reps: "8–10",
    notes: "Superset with face pulls.",
  });
  // The review and the iPhone receipt tell planned sets from logged ones,
  // and a planned set without a load says so.
  assert.equal(
    plannedSetsText(flies[0].sets),
    "Planned: 1 × 10 at 15 kg, 1 × 8 at 15 kg, 1 × 8 (load to choose), 1 × 8 at 15 kg",
  );
  assert.deepEqual(
    receiptEntryView({
      title: more.title,
      detail: more.detail,
      workout: more.state.activeWorkout,
    }).lines.at(-1),
    {
      label: "Standing cable reverse fly",
      value: `10 kg × 10, ${plannedSetsText(flies[0].sets)}`,
    },
  );
  // Planned sets are targets: finishing keeps only what was logged.
  const finished = prepareAction(more.state, { kind: "finish_workout" }, today);
  assert.deepEqual(
    finished.state.sessions[0].exercises.map((e) => [
      e.exerciseId,
      e.sets.length,
    ]),
    [
      ["back_squat", 1],
      [fly, 1],
    ],
  );
});

test("sets added to an exercise with a target widen it, and keep its load only while they share it", () => {
  let state = prepareAction(
    withWorkout(),
    logSets("back_squat", [done(100, 5)]),
    today,
  ).state;
  const add = (plannedSets: { weight: number | null; reps: number }[]) => {
    state = prepareAction(
      state,
      {
        kind: "add_workout_exercise",
        exerciseId: "custom:Band pull-apart",
        plannedSets,
        note: "Pause at the back",
      },
      today,
    ).state;
    return state.activeWorkout!.exercises.at(-1)!.prescribed;
  };
  const three = Array.from({ length: 3 }, () => ({ weight: 0, reps: 15 }));
  assert.deepEqual(add(three), {
    targetSets: 3,
    reps: "15",
    targetWeight: 0,
    notes: "Pause at the back",
  });
  assert.deepEqual(add([{ weight: 0, reps: 20 }]), {
    targetSets: 4,
    reps: "15–20",
    targetWeight: 0,
    notes: "Pause at the back",
  });
  assert.deepEqual(add([{ weight: 5, reps: 12 }]), {
    targetSets: 5,
    reps: "12–20",
    notes: "Pause at the back",
  });
  // An exercise logged without a target gets one from all its sets.
  const logged = prepareAction(
    state,
    {
      kind: "add_workout_exercise",
      exerciseId: "back_squat",
      plannedSets: [{ weight: 100, reps: 3 }],
    },
    today,
  ).state.activeWorkout!.exercises[0];
  assert.deepEqual(logged.prescribed, {
    targetSets: 2,
    reps: "3–5",
    targetWeight: 100,
  });
});

test("Coach reads the workout in progress before adding to it", async () => {
  const ctx = {
    userId: "u",
    state: withWorkout(),
    reads: newTurnReads(),
    viewedImageIds: new Set<string>(),
    message: "Add standing cable reverse fly to my workout",
    recent: [],
    saving: false,
  };
  const add = {
    kind: "add_workout_exercise" as const,
    exerciseId: fly,
    plannedSets: [{ weight: 10, reps: 10 }],
  };
  await assert.rejects(guardChange(add, ctx), /Read the current workout first/);
  ctx.reads.draft = true;
  await assert.doesNotReject(guardChange(add, ctx));
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
  // A catalogue name or alias, singular or plural, an alias of two lifts, a
  // muscle, equipment or kind of training, or a name the catalogue has
  // exercises for, is never offered as a new exercise.
  for (const query of [
    "back squat",
    "rear delt fly",
    "overhead press",
    "chest",
    "dumbbell",
    "cardio",
    "upper body",
    "abs",
    "squat",
    "squats",
    "row",
    "leg curl",
  ])
    assert.ok(!(await search({ query })).some((e) => e.custom), query);
  // Plurals and short forms find the catalogue exercise first.
  for (const [query, id] of [
    ["front squats", "front_squat"],
    ["deadlifts", "deadlift"],
    ["RDLs", "romanian_deadlift"],
    ["pull-ups", "pull_up"],
    ["hip thrusts", "hip_thrust"],
    ["face pulls", "face_pull"],
    ["db row", "dumbbell_row"],
  ]) {
    const found = await search({ query });
    assert.equal(found[0]?.id, id, query);
    assert.ok(!found.some((e) => e.custom), query);
  }
  const programme = await search({
    queries: ["Back squats", "Romanian deadlifts", "Face pulls", "Pull-ups"],
  });
  assert.ok(!programme.some((e) => e.custom));
  for (const id of ["back_squat", "romanian_deadlift", "face_pull", "pull_up"])
    assert.ok(
      programme.some((e) => e.id === id),
      id,
    );
  // A name the catalogue has but for one word shows those exercises beside
  // the ready id, and the ready id's note names them.
  const machine = await search({ query: "standing calf raise machine" });
  assert.deepEqual(
    machine.map((e) => [e.id, e.custom]),
    [
      ["standing_calf_raise", undefined],
      ["custom:Standing calf raise machine", true],
    ],
  );
  assert.match(
    machine[1].loggingNotes,
    /nearest are standing_calf_raise\. If one is the same movement, use its id/,
  );
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
  const similar = related.find(
    (e) => e.id === "custom:standing Cable reverse fly",
  );
  assert.match(similar!.loggingNotes, /only if it is the same movement/);
  // Their own exercises match whole words: "row" is not in "narrow".
  session(state, "2026-10-02", "custom:Narrow grip bench");
  assert.ok(
    !(await search({ query: "row" })).some((e) => e.id.startsWith("custom:")),
  );
  // Two spellings of one of their exercises show once, in the spelling a
  // change reuses, naming the other.
  session(state, "2026-09-01", "custom:standing cable reverse fly");
  const spellings = (await search({ query: fly })).filter((e) => e.custom);
  assert.deepEqual(
    spellings.map((e) => e.id),
    ["custom:standing Cable reverse fly"],
  );
  assert.match(
    spellings[0].loggingNotes,
    /custom:standing cable reverse fly is an older spelling of it/,
  );
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

test("a history search reads every spelling of one exercise, and asks which of two", async () => {
  const state = emptyJournal();
  const ctx = {
    userId: "u",
    state,
    currentDate: today,
    timezone: "UTC",
    reads: newTurnReads(),
  };
  const find = async (exerciseId: string) =>
    (
      (await runReadTool("find_sessions", { exerciseId }, ctx)) as {
        total: number;
      }
    ).total;
  // A catalogue alias in the custom namespace reads the lift logged by it.
  session(state, "2026-09-01", "strict_press");
  session(state, "2026-09-02", "strict_press");
  assert.equal(await find("custom:Overhead press"), 2);
  assert.equal(await find("custom:Military press"), 2);
  // Once both lifts with that alias are logged, Coach is asked to choose.
  session(state, "2026-09-03", "push_press");
  await assert.rejects(
    find("custom:Overhead press"),
    /such as strict_press, push_press/,
  );
  // Spellings saved before ids were made canonical read together.
  session(state, "2026-09-04", "custom:Cable fly");
  session(state, "2026-09-05", "custom:cable fly");
  session(state, "2026-09-06", "custom:Back squat");
  session(state, "2026-09-07", "back_squat");
  session(state, "2026-09-08", "back_squat");
  assert.equal(await find("custom:CABLE FLY"), 2);
  assert.equal(await find("custom:cable fly"), 2);
  assert.equal(await find("custom:back squat"), 3);
  assert.equal(await find("back_squat"), 3);
  const summary = (await runReadTool(
    "training_summary",
    { from: "2026-09-01", exerciseId: "custom:Cable fly" },
    ctx,
  )) as { sessions: number };
  assert.equal(summary.sessions, 2);
});

test("pickers list the athlete's own exercises once and offer a typed new one", () => {
  const state = emptyJournal();
  session(state, "2026-09-01", "custom:cable thing");
  session(state, "2026-09-20", "custom:Cable thing");
  session(state, "2026-09-21", fly);
  session(state, "2026-09-22", "back_squat");
  // One per movement, in the spelling changes reuse, by name.
  assert.deepEqual(ownExercises(state), [
    { id: "custom:Cable thing", name: "Cable thing" },
    { id: fly, name: "Standing cable reverse fly" },
  ]);
  assert.equal(
    resolveExerciseId(state, "custom:CABLE THING"),
    "custom:Cable thing",
  );
  // A typed name nobody has yet is saved tidily as the athlete's own.
  assert.deepEqual(newExerciseFor(state, "  landmine   press "), {
    id: "custom:Landmine press",
    name: "Landmine press",
  });
  // Nothing new for a library name or alias, plural or not, one of theirs,
  // or something that can't be a name.
  for (const typed of [
    "back squat",
    "Front squats",
    "RDL",
    "cable things",
    "standing cable reverse fly",
    "",
    "\u3164",
    "x".repeat(121),
  ])
    assert.equal(newExerciseFor(state, typed), undefined, typed);
});

test("the iPhone's exercise list adds the athlete's own after the library", () => {
  const state = emptyJournal();
  session(state, "2026-09-21", fly);
  const { exercises } = buildTraining(state, 0, today);
  const rdl = exercises.find((e) => e.id === "romanian_deadlift");
  assert.ok(rdl?.aliases?.includes("RDL"));
  assert.deepEqual(exercises.at(-1), {
    id: fly,
    name: "Standing cable reverse fly",
    category: "Your exercises",
  });
});
