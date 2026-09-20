import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorkout, days, emptyJournal, program } from "../lib/domain";
import { nextTraining, startNextTraining } from "../lib/next-training";
import {
  saveTrainingProgram,
  startTrainingDay,
} from "../lib/training-programs";
import { usualMeals } from "../lib/usual-meals";
import { favouriteFromMeal, mealSchema } from "../lib/nutrition";

const sequence = days.filter((d) => d.weekday !== null);

test("next training follows recorded sessions, ignores future/empty/other programmes and preserves ongoing work", () => {
  const s = emptyJournal();
  assert.equal(nextTraining(s, "2026-09-20").dayId, sequence[0].id);
  const session = createWorkout(s, sequence[0], "2026-09-15");
  session.exercises[0].sets[0] = {
    ...session.exercises[0].sets[0],
    weight: 40,
    reps: 3,
    logged: true,
    result: "success",
  };
  s.sessions.push(session);
  assert.equal(nextTraining(s, "2026-09-20").dayId, sequence[1].id);
  s.sessions.push(createWorkout(s, sequence[2], "2026-09-19"));
  s.sessions.push({
    ...session,
    id: crypto.randomUUID(),
    date: "2026-09-19",
    programDayId: "gym_accessories",
  });
  assert.equal(nextTraining(s, "2026-09-20").dayId, sequence[1].id);
  s.sessions.push({
    ...session,
    id: crypto.randomUUID(),
    date: "2027-01-01",
    programDayId: sequence[2].id,
  });
  assert.equal(nextTraining(s, "2026-09-20").dayId, sequence[1].id);
  startNextTraining(s, "2026-09-20");
  assert.equal(s.activeWorkout?.programDayId, sequence[1].id);
  assert.throws(() => startNextTraining(s), /ongoing workout/);
  assert.equal(s.sessions.length, 4);
});

test("a chosen custom programme advances in order, includes recovery and wraps without inventing completed sets", () => {
  const s = emptyJournal();
  const p = saveTrainingProgram(s, {
    name: "My sequence",
    days: [
      {
        name: "Strength A",
        exercises: [{ exerciseId: "back_squat", sets: 2, reps: 5, weight: 40 }],
      },
      { name: "Recovery", exercises: [], notes: "An easy day" },
      {
        name: "Strength B",
        exercises: [
          { exerciseId: "front_squat", sets: 2, reps: 3, weight: 30 },
        ],
      },
    ],
  });
  s.program.activeProgramId = p.id;
  startNextTraining(s, "2026-09-18");
  assert.equal(s.activeWorkout?.programDayId, p.days[0].id);
  assert.equal(
    s.activeWorkout?.exercises[0].sets.some((set) => set.logged || set.result),
    false,
  );
  const recorded = startTrainingDay(p, p.days[0].id, "2026-09-18");
  recorded.exercises[0].sets[0].logged = true;
  recorded.exercises[0].sets[0].result = "success";
  s.sessions.push(recorded);
  s.activeWorkout = null;
  assert.equal(nextTraining(s, "2026-09-20").title, "Recovery");
  assert.throws(() => startNextTraining(s, "2026-09-20"), /recovery/);
  s.sessions.push({
    ...recorded,
    id: crypto.randomUUID(),
    date: "2026-09-19",
    programDayId: p.days[2].id,
  });
  assert.equal(nextTraining(s, "2026-09-20").dayId, p.days[0].id);
  s.program.customPrograms = [];
  assert.equal(nextTraining(s).programId, program.id);
});

test("usual meals favour the current mealtime, retain saved favourites and never record a suggestion", () => {
  const meal = (
    name: string,
    type: "breakfast" | "dinner",
    date = "2026-09-19",
  ) =>
    mealSchema.parse({
      id: crypto.randomUUID(),
      name,
      type,
      date,
      source: "manual",
      estimated: true,
      items: [
        {
          name,
          portion: "One serving",
          calories: 300,
          protein: 10,
          carbs: 40,
          fat: 8,
        },
      ],
      createdAt: new Date().toISOString(),
    });
  const meals = [
    meal("Oats", "breakfast"),
    meal("Dinner", "dinner"),
    meal("Future", "breakfast", "2027-01-01"),
  ];
  const favourite = favouriteFromMeal(meal("Favourite dinner", "dinner"));
  assert.equal(usualMeals(meals, [favourite], 8, "2026-09-20")[0].name, "Oats");
  assert.equal(
    usualMeals(meals, [favourite], 19, "2026-09-20")[0].name,
    "Favourite dinner",
  );
  assert.ok(
    !usualMeals(meals, [], 8, "2026-09-20").some((m) => m.name === "Future"),
  );
  assert.equal(meals.length, 3);
});
