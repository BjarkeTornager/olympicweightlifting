import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyJournal } from "../lib/domain";
import {
  applyGoals,
  describePlan,
  planGoals,
  proteinPerKg,
  weeklyRates,
  type BodyGoalsInput,
} from "../lib/body-goals";
import { prepareAction } from "../lib/agent/actions";

const today = "2026-09-26";
const athlete: BodyGoalsInput = {
  age: 34,
  sex: "male",
  heightCm: 182,
  weightKg: 88,
  targetWeightKg: 81,
  targetDate: null,
  activity: "moderate",
  trainingDays: 4,
  sessionMinutes: 75,
  experience: "developing",
};

test("the plan follows Mifflin–St Jeor, training energy and a sustainable rate", () => {
  const plan = planGoals(athlete, today);
  // 10×88 + 6.25×182 − 5×34 + 5 = 1852.5 kcal resting.
  assert.equal(plan.restingKcal, 1850);
  // ×1.375 plus 4 × 75 min × 0.075 kcal/kg/min × 88 kg over 7 days.
  assert.equal(plan.maintenanceKcal, 2830);
  assert.equal(plan.direction, "lose");
  assert.equal(plan.weeklyChangeKg, 0.44);
  assert.equal(plan.calories, 2350);
  assert.equal(plan.protein, 176);
  assert.equal(plan.weeksToGoal, 16);
  assert.equal(plan.sessionsPerWeek, 4);
  assert.deepEqual(plan.notes, []);
  const kcal = plan.protein * 4 + plan.carbs * 4 + plan.fat * 9;
  assert.equal(kcal, plan.calories);
});

test("macros are worked out from the calories shown, so they add up to them", () => {
  for (const change of [
    {},
    { targetWeightKg: 88 },
    { targetWeightKg: 92, experience: "new" as const },
    { sex: "female" as const, heightCm: 165, weightKg: 65, targetWeightKg: 60 },
    { activity: "high" as const, trainingDays: 6, sessionMinutes: 120 },
  ]) {
    const plan = planGoals({ ...athlete, ...change }, today);
    assert.equal(plan.calories % 10, 0);
    assert.ok(plan.carbs > 0);
    // Only the carbohydrate gram is rounded after the fat: within 2 kcal.
    const kcal = plan.protein * 4 + plan.carbs * 4 + plan.fat * 9;
    assert.ok(
      Math.abs(kcal - plan.calories) <= 2,
      `${kcal} vs ${plan.calories}`,
    );
  }
});

test("maintaining, gaining and deadlines stay within safe limits", () => {
  assert.equal(
    planGoals({ ...athlete, targetWeightKg: 88 }, today).direction,
    "maintain",
  );
  const maintain = planGoals({ ...athlete, targetWeightKg: 88 }, today);
  assert.equal(maintain.calories, maintain.maintenanceKcal);
  const gain = planGoals({ ...athlete, targetWeightKg: 92 }, today);
  assert.equal(gain.direction, "gain");
  assert.equal(gain.weeklyChangeKg, 0.22);
  assert.ok(gain.calories > gain.maintenanceKcal);
  const rushed = planGoals(
    { ...athlete, targetWeightKg: 75, targetDate: "2026-10-26" },
    today,
  );
  assert.equal(rushed.weeklyChangeKg, 0.44);
  assert.match(rushed.notes[0], /sustainable/);
  // A relaxed deadline needs less than the maximum rate.
  const relaxed = planGoals(
    { ...athlete, targetWeightKg: 86, targetDate: "2027-03-26" },
    today,
  );
  assert.ok(relaxed.weeklyChangeKg < 0.44);
});

test("the plan's rates and protein are the exported figures Coach quotes", () => {
  // Coach's goals text is written from weeklyRates and proteinPerKg
  // (coach-prompt.test.ts), so the plan must use exactly these.
  const kgPerWeek = (rate: number, kg = athlete.weightKg) =>
    Math.round(kg * rate * 100) / 100;
  const plan = planGoals(athlete, today);
  assert.equal(plan.weeklyChangeKg, kgPerWeek(weeklyRates.lose.usual));
  assert.equal(
    plan.protein,
    Math.round(athlete.weightKg * proteinPerKg.bodyweight.losing),
  );
  // Lean (10 % for a man) loses slowest, with protein on lean mass.
  const lean = planGoals(athlete, today, { bodyFatPercent: 10 });
  assert.equal(lean.weeklyChangeKg, kgPerWeek(weeklyRates.lose.lean));
  assert.equal(
    lean.protein,
    Math.round(athlete.weightKg * 0.9 * proteinPerKg.leanMass.losing),
  );
  // With more fat to lose, the fastest rate applies where the floor of
  // resting energy plus training leaves room for it: a more active day here.
  const higher = planGoals({ ...athlete, activity: "high" }, today, {
    bodyFatPercent: 30,
  });
  assert.equal(higher.weeklyChangeKg, kgPerWeek(weeklyRates.lose.higher));
  for (const experience of ["new", "developing", "experienced"] as const) {
    const gain = planGoals(
      { ...athlete, targetWeightKg: 95, experience },
      today,
    );
    assert.equal(gain.weeklyChangeKg, kgPerWeek(weeklyRates.gain[experience]));
    assert.equal(
      gain.protein,
      Math.round(athlete.weightKg * proteinPerKg.bodyweight.other),
    );
  }
  const recomposition = planGoals(athlete, today, {
    focus: "recomposition",
  });
  assert.equal(
    recomposition.weeklyChangeKg,
    kgPerWeek(weeklyRates.recomposition),
  );
});

test("warnings: underweight goals and too little energy", () => {
  // BMI 17.5 at the goal: the plan holds until the athlete confirms.
  const under = planGoals({ ...athlete, targetWeightKg: 58 }, today);
  assert.equal(under.direction, "maintain");
  assert.ok(under.confirmToLose);
  assert.ok(under.notes.some((n) => /just below the healthy range/.test(n)));
  const small = planGoals(
    {
      ...athlete,
      sex: "female",
      age: 60,
      heightCm: 150,
      weightKg: 50,
      targetWeightKg: 45,
      activity: "low",
      trainingDays: 0,
    },
    today,
  );
  // Resting energy is 980 kcal and maintenance 1,170: no room for a
  // deficit above the 1,200 kcal floor, so the plan holds at the floor.
  assert.equal(small.restingKcal, 980);
  assert.equal(small.direction, "maintain");
  assert.equal(small.calories, 1200);
  assert.equal(small.calories, small.floorKcal);
  assert.ok(small.notes.some((n) => /isn't room for a safe deficit/.test(n)));
  const eager = planGoals(
    { ...athlete, trainingDays: 7, experience: "new" },
    today,
  );
  assert.equal(eager.sessionsPerWeek, 3);
});

test("saving goals sets profile and daily targets and leaves the lifting brief alone", () => {
  const state = emptyJournal();
  state.profile.lifting = {
    goal: "Snatch 80 kg",
    why: "",
    experience: "developing",
    daysPerWeek: 5,
    minutesPerSession: 75,
    equipment: "",
    constraints: "",
    priority: "",
    targetDate: null,
    updatedAt: new Date().toISOString(),
  };
  const prepared = prepareAction(
    state,
    { kind: "set_body_goals", bodyGoals: athlete },
    today,
  );
  const next = prepared.state;
  assert.equal(next.profile.body?.targetWeightKg, 81);
  assert.equal(next.profile.bodyweight, 88);
  assert.equal(next.profile.age, 34);
  assert.deepEqual(next.nutrition.targets, {
    goal: "lose",
    calories: 2350,
    protein: 176,
    carbs: 254,
    fat: 70,
  });
  // The brief is the athlete's own: the plan's 4 sessions don't replace
  // the 5 days they said they have.
  assert.deepEqual(next.profile.lifting, state.profile.lifting);
  assert.match(prepared.detail, /2,350 kcal a day/);
  // The original state is untouched until the change is saved.
  assert.equal(state.profile.body, undefined);
  // The saved goals, with their timestamp, plan the same way.
  assert.equal(planGoals(next.profile.body!, today).calories, 2350);
  const fresh = emptyJournal();
  applyGoals(fresh, athlete, today);
  assert.equal(fresh.profile.lifting, undefined);
  const brief = structuredClone(state.profile.lifting);
  applyGoals(state, { ...athlete, trainingDays: 2 }, today);
  assert.deepEqual(state.profile.lifting, brief);
});

test("sessions follow the days available, with no floor of 2", () => {
  const none = planGoals({ ...athlete, trainingDays: 0 }, today);
  assert.equal(none.sessionsPerWeek, 0);
  assert.match(describePlan(athlete, none), /No lifting days planned\.$/);
  const one = planGoals({ ...athlete, trainingDays: 1 }, today);
  assert.equal(one.sessionsPerWeek, 1);
  assert.match(describePlan(athlete, one), /1 training session a week\.$/);
  assert.ok(one.notes.some((n) => /One heavy session a week/.test(n)));
  assert.equal(
    planGoals({ ...athlete, trainingDays: 3 }, today).sessionsPerWeek,
    3,
  );
  // Up to what suits the experience.
  assert.equal(
    planGoals({ ...athlete, trainingDays: 6 }, today).sessionsPerWeek,
    4,
  );
});
