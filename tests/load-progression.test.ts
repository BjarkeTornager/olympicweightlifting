import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createWorkout,
  days,
  emptyJournal,
  finishWorkout,
  replanDraft,
  setTechniqueChecked,
  setWorkoutRecovery,
  takeLoadReset,
} from "../lib/domain";
import { defaultRestSeconds, restSeconds } from "../lib/exercises";
import { journalSchema, type JournalState, type Plan } from "../lib/model";
import { workoutView } from "../lib/native-training";
import {
  saveTrainingProgram,
  startTrainingDay,
} from "../lib/training-programs";
import { shortSleepHint } from "../lib/training";

const monday = days.find((d) => d.id === "monday")!;
const plan = (state: JournalState, index: number) =>
  state.activeWorkout!.exercises[index].prescribed.progression as Plan;

// A journal with Monday trained on each date: the snatch at 60 kg and the
// snatch pull at 80 kg, every set made at RPE 8 unless `change` says so.
function trained(
  dates: string[],
  change: (
    entry: JournalState["sessions"][number]["exercises"][number],
  ) => void = () => {},
) {
  const state = emptyJournal();
  for (const date of dates) {
    state.activeWorkout = createWorkout(state, monday, date);
    state.activeWorkout.exercises = state.activeWorkout.exercises.slice(0, 2);
    state.activeWorkout.exercises.forEach((entry, i) => {
      const weight = [60, 80][i];
      entry.prescribed.targetWeight = weight;
      entry.sets.forEach((s) =>
        Object.assign(s, {
          weight: String(weight),
          rpe: "8",
          result: "success",
          logged: true,
        }),
      );
      change(entry);
    });
    Object.assign(state, finishWorkout(state));
  }
  return state;
}

test("an under-18 profile gets no automatic increase without a coach's technique check", () => {
  const state = trained(["2026-09-21"]);
  state.profile.age = 16;
  state.activeWorkout = createWorkout(state, monday, "2026-09-28");
  assert.equal(plan(state, 0).status, "confirm");
  assert.equal(state.activeWorkout.exercises[0].prescribed.targetWeight, 60);
  assert.ok(
    state.activeWorkout.exercises[0].sets.every((s) => s.weight === "60"),
  );
  setTechniqueChecked(state, true);
  assert.equal(plan(state, 0).status, "increase");
  assert.ok(
    state.activeWorkout.exercises[0].sets.every((s) => s.weight === "62"),
  );
  // Taking it back holds again; work already entered would be kept.
  setTechniqueChecked(state, false);
  assert.equal(state.activeWorkout.exercises[0].sets[0].weight, "60");
  journalSchema.parse(state);
  // The age set with the goals counts first; 0 is unknown, not a child.
  state.activeWorkout = null;
  state.profile.age = 30;
  state.profile.body = { age: 15 } as NonNullable<
    JournalState["profile"]["body"]
  >;
  assert.equal(
    createWorkout(state, monday, "2026-09-28").exercises[0].prescribed
      .targetWeight,
    60,
  );
  state.profile.body = undefined;
  state.profile.age = 0;
  assert.equal(
    createWorkout(state, monday, "2026-09-28").exercises[0].prescribed
      .targetWeight,
    62,
  );
});

test("limited recovery repeats loads for exercises not started, and keeps entered work", () => {
  const state = trained(["2026-09-21"]);
  state.activeWorkout = createWorkout(state, monday, "2026-09-28");
  Object.assign(state.activeWorkout.exercises[1].sets[0], {
    result: "success",
    logged: true,
    touched: true,
  });
  setWorkoutRecovery(state, "limited");
  assert.equal(state.activeWorkout.recovery, "limited");
  assert.equal(state.activeWorkout.exercises[0].sets[0].weight, "60");
  assert.equal(state.activeWorkout.exercises[1].sets[0].weight, "82");
  setWorkoutRecovery(state, "auto");
  assert.equal(state.activeWorkout.exercises[0].sets[0].weight, "62");
});

test("a proposed reset is taken only before logging, and replanning keeps it", () => {
  const state = trained(["2026-09-14", "2026-09-21"], (entry) => {
    if (entry.exerciseId === "snatch_pull") entry.sets[3].result = "miss";
  });
  state.activeWorkout = createWorkout(state, monday, "2026-09-28");
  const pull = state.activeWorkout.exercises[1];
  assert.equal(plan(state, 1).resetWeight, 72);
  assert.equal(pull.prescribed.targetWeight, 80, "The plan never imposes it");
  assert.throws(
    () => takeLoadReset(state, state.activeWorkout!.exercises[0].id),
    /no reset/,
  );
  takeLoadReset(state, pull.id);
  assert.equal(pull.prescribed.targetWeight, 72);
  assert.ok(pull.sets.every((s) => s.weight === "72"));
  assert.equal(plan(state, 1).status, "reset");
  assert.equal(plan(state, 1).resetWeight, undefined);
  setWorkoutRecovery(state, "limited");
  replanDraft(state);
  assert.ok(pull.sets.every((s) => s.weight === "72"));
  setWorkoutRecovery(state, "auto");
  assert.ok(pull.sets.every((s) => s.weight === "72"));
  // Next time builds from the reset load: with an RPE straight away, or
  // after a second session without one.
  pull.sets.forEach((s) =>
    Object.assign(s, { result: "success", logged: true }),
  );
  const unrated = structuredClone(state);
  Object.assign(unrated, finishWorkout(unrated));
  unrated.activeWorkout = createWorkout(unrated, monday, "2026-10-05");
  assert.equal(unrated.activeWorkout.exercises[1].prescribed.targetWeight, 72);
  pull.sets.forEach((s) => (s.rpe = "7"));
  Object.assign(state, finishWorkout(state));
  state.activeWorkout = createWorkout(state, monday, "2026-10-05");
  assert.equal(state.activeWorkout.exercises[1].prescribed.targetWeight, 74);
  // Once a set is logged, the remaining weights are changed directly.
  const again = trained(["2026-09-14", "2026-09-21"], (entry) => {
    entry.sets[0].result = "miss";
  });
  again.activeWorkout = createWorkout(again, monday, "2026-09-28");
  Object.assign(again.activeWorkout.exercises[1].sets[0], {
    result: "success",
    logged: true,
  });
  assert.throws(
    () => takeLoadReset(again, again.activeWorkout!.exercises[1].id),
    /already logged/,
  );
});

test("rest starts from the programme, then the athlete's default, then the exercise type", () => {
  assert.equal(defaultRestSeconds("snatch"), 180);
  assert.equal(defaultRestSeconds("back_squat"), 180);
  assert.equal(defaultRestSeconds("clean_pull"), 180);
  assert.equal(defaultRestSeconds("deadlift"), 180);
  assert.equal(defaultRestSeconds("strict_press"), 120);
  assert.equal(defaultRestSeconds("bench_press"), 120);
  assert.equal(defaultRestSeconds("lateral_raise"), 90);
  assert.equal(defaultRestSeconds("dead_bug"), 90);
  assert.equal(defaultRestSeconds("custom:Sled push"), 90);
  const state = emptyJournal();
  const block = saveTrainingProgram(state, {
    name: "Block",
    days: [
      {
        name: "Day 1",
        exercises: [
          {
            exerciseId: "snatch",
            sets: 3,
            reps: 2,
            weight: 60,
            restSeconds: 150,
          },
          { exerciseId: "lateral_raise", sets: 3, reps: 12, weight: 8 },
        ],
      },
    ],
  });
  const [snatch, raise] = startTrainingDay(
    block,
    block.days[0].id,
    "2026-09-28",
  ).exercises;
  assert.equal(restSeconds(snatch), 150);
  assert.equal(
    restSeconds(snatch, 60),
    150,
    "The programme's own rest comes first",
  );
  assert.equal(restSeconds(raise), 90);
  assert.equal(
    restSeconds(raise, 120),
    120,
    "Then the athlete's chosen default",
  );
});

test("the app sees why each load, where rest starts, recovery and the technique check", () => {
  const state = trained(["2026-09-21"]);
  state.profile.age = 16;
  state.activeWorkout = createWorkout(state, monday, "2026-09-28");
  state.health.checkins.push({
    date: "2026-09-28",
    sleepHours: 5.75,
    energy: null,
    soreness: null,
    waterMl: null,
    bodyweight: null,
    notes: "",
    updatedAt: "2026-09-28T06:00:00.000Z",
  } as JournalState["health"]["checkins"][number]);
  Object.assign(state.activeWorkout.exercises[2].sets[0], {
    weight: "100",
    result: "success",
    logged: true,
    rpe: 8,
  });
  let view = workoutView(state.activeWorkout, false, state);
  const [snatch, , squat, upperBack] = view.exercises;
  assert.equal(snatch.progression?.status, "confirm");
  assert.match(snatch.progression!.reason, /Under 18/);
  assert.equal(snatch.restSeconds, 180);
  assert.equal(upperBack.progression, undefined, "Manual loads need no reason");
  assert.equal(upperBack.restSeconds, 90);
  assert.equal(squat.sets[0].rpe, 8);
  assert.equal(view.recovery, "auto");
  assert.match(
    view.recoveryHint!,
    /^You slept 5 h 45 min before this session\./,
  );
  assert.equal(view.techniqueCheck, false);
  setTechniqueChecked(state, true);
  setWorkoutRecovery(state, "limited");
  view = workoutView(state.activeWorkout, false, state);
  assert.equal(view.techniqueCheck, true);
  assert.equal(view.recovery, "limited");
  assert.equal(view.recoveryHint, undefined, "Already holding loads");
  // An adult sees no technique check; a long night, no hint.
  state.profile.age = 30;
  setTechniqueChecked(state, false);
  setWorkoutRecovery(state, "auto");
  state.health.checkins.at(-1)!.sleepHours = 7;
  view = workoutView(state.activeWorkout, false, state);
  assert.equal(view.techniqueCheck, undefined);
  assert.equal(view.recoveryHint, undefined);
  assert.equal(shortSleepHint(state, "2026-09-28"), undefined);
  // A finished session carries none of the plan.
  const done = workoutView(state.sessions[0], true);
  assert.equal(done.recovery, undefined);
  assert.ok(
    done.exercises.every((e) => e.progression == null && e.restSeconds == null),
  );
  // A routine's workout is not the programme, so recovery changes nothing.
  state.activeWorkout = { ...state.activeWorkout, programId: "personal" };
  assert.equal(
    workoutView(state.activeWorkout, false, state).recovery,
    undefined,
  );
});
