import { test } from "node:test";
import assert from "node:assert/strict";
import { EXERCISES, EXERCISE_BY_ID } from "../js/public-data.js";
import { emptyJournal } from "../lib/domain";
import { searchExercises } from "../lib/exercises";
import { prepareAction } from "../lib/agent/actions";
import {
  startTemplate,
  templateFromWorkout,
  trainingSummary,
} from "../lib/training";

test("gym search resolves familiar names, equipment and muscles without confusing distinct lifts", () => {
  const ids = (q: string) => searchExercises(q).map((e) => e.id);
  assert.ok(ids("DB bench").includes("dumbbell_bench_press"));
  assert.equal(ids("DB bench")[0], "dumbbell_bench_press");
  assert.ok(ids("lat pull down").includes("lat_pulldown"));
  assert.deepEqual(ids("RFESS"), ["bulgarian_split_squat"]);
  assert.deepEqual(ids("conventional deadlift"), ["deadlift"]);
  assert.deepEqual(ids("RDL"), ["romanian_deadlift"]);
  assert.deepEqual(ids("seated_cable_row"), ["seated_cable_row"]);
  assert.deepEqual(
    searchExercises("", {
      muscle: "Chest",
      equipment: "Machine",
      discipline: "gym",
    }).map((e) => e.id),
    ["chest_press_machine"],
  );
  assert.deepEqual(searchExercises("snatch", { discipline: "gym" }), []);
  assert.ok(
    searchExercises("squat", { discipline: "gym" }).some(
      (e) => e.id === "back_squat",
    ),
  );
  assert.deepEqual(searchExercises("unknown exercise 123"), []);
});

test("gym catalogue has attributed exact-variant tutorials and fits the Coach tool result budget", () => {
  assert.equal(new Set(EXERCISES.map((e) => e.id)).size, EXERCISES.length);
  const added = EXERCISES.filter(
    (e) => e.sourceName === "PureGym" || e.sourceName === "NASM",
  );
  assert.equal(added.length, 30);
  for (const exercise of added) {
    assert.match(exercise.videoId!, /^[\w-]{11}$/);
    assert.ok(
      exercise.videoTitle && exercise.videoAuthor && exercise.sourceUrl,
    );
    assert.ok(
      exercise.muscles.length &&
        exercise.equipment.length &&
        exercise.loggingNotes,
    );
    assert.ok(exercise.cues.length >= 3);
    assert.equal(exercise.tracksOutcome, false);
  }
  // The source page incorrectly embeds an incline row; retain the corrected seated tutorial.
  assert.equal(EXERCISE_BY_ID.seated_cable_row.videoId, "lJoozxC0Rns");
  assert.match(EXERCISE_BY_ID.seated_leg_curl.videoTitle, /Seated Leg Curl/);
  assert.match(
    EXERCISE_BY_ID.dumbbell_bench_press.loggingNotes,
    /two 20 kg dumbbells = 40 kg/,
  );
  assert.match(EXERCISE_BY_ID.dumbbell_row.loggingNotes, /single dumbbell/);
  assert.match(EXERCISE_BY_ID.reverse_lunge.loggingNotes, /8 per side = 16/);
  assert.ok(
    JSON.stringify(
      EXERCISES.map((e) => ({
        ...e,
        videoUrl: e.videoId
          ? `https://www.youtube.com/watch?v=${e.videoId}`
          : null,
      })),
    ).length < 60000,
  );
});

test("new gym movements round-trip through Coach reviews, history, routines and progress", () => {
  const state = emptyJournal();
  const input = {
    kind: "record_session",
    workout: {
      title: "Full body gym",
      date: "2026-09-07",
      category: "open",
      exercises: [
        {
          exerciseId: "dumbbell_bench_press",
          sets: [{ weight: 40, reps: 8, result: "success" }],
        },
        {
          exerciseId: "seated_leg_curl",
          sets: [{ weight: 30, reps: 10, result: "success" }],
        },
        {
          exerciseId: "push_up",
          sets: [{ weight: 0, reps: 12, result: "success" }],
        },
        {
          exerciseId: "dumbbell_row",
          sets: [{ weight: 20, reps: 16, result: "success" }],
        },
      ],
    },
  };
  const prepared = prepareAction(state, input, "2026-09-07");
  assert.equal(state.sessions.length, 0);
  assert.deepEqual(
    prepared.workout!.exercises.map((e) => e.exerciseId),
    input.workout.exercises.map((e) => e.exerciseId),
  );
  const nextWorkout = startTemplate(
    templateFromWorkout(prepared.workout!),
    "2026-09-08",
  );
  assert.deepEqual(
    nextWorkout.exercises.map((e) => [
      e.exerciseId,
      e.sets[0].weight,
      e.sets[0].reps,
    ]),
    [
      ["dumbbell_bench_press", 40, 8],
      ["seated_leg_curl", 30, 10],
      ["push_up", 0, 12],
      ["dumbbell_row", 20, 16],
    ],
  );
  assert.ok(nextWorkout.exercises.every((e) => !e.sets[0].logged));
  assert.equal(
    trainingSummary(prepared.state, "2026-09-07", "2026-09-07").volume,
    940,
  );
  assert.throws(
    () =>
      prepareAction(
        state,
        {
          ...input,
          workout: {
            ...input.workout,
            exercises: [
              {
                ...input.workout.exercises[0],
                exerciseId: "invented_gym_exercise",
              },
            ],
          },
        },
        "2026-09-07",
      ),
    /exercise/i,
  );
});
