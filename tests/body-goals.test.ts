import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyJournal } from "../lib/domain";
import { applyGoals, planGoals, type BodyGoalsInput } from "../lib/body-goals";
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
  assert.ok(Math.abs(kcal - plan.calories) < 15);
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

test("warnings: underweight goals and too little energy", () => {
  const under = planGoals({ ...athlete, targetWeightKg: 58 }, today);
  assert.ok(under.notes.some((n) => /below the healthy range/.test(n)));
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
  assert.equal(small.calories, small.restingKcal);
  assert.ok(small.notes.some((n) => /resting energy/.test(n)));
  const eager = planGoals(
    { ...athlete, trainingDays: 7, experience: "new" },
    today,
  );
  assert.equal(eager.sessionsPerWeek, 3);
});

test("saving goals sets profile, daily targets and the brief's training days", () => {
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
    carbs: 253,
    fat: 70,
  });
  assert.equal(next.profile.lifting?.daysPerWeek, 4);
  assert.match(prepared.detail, /2,350 kcal a day/);
  // The original state is untouched until the change is saved.
  assert.equal(state.profile.body, undefined);
  // The saved goals, with their timestamp, plan the same way.
  assert.equal(planGoals(next.profile.body!, today).calories, 2350);
  const fresh = emptyJournal();
  applyGoals(fresh, athlete, today);
  assert.equal(fresh.profile.lifting, undefined);
});
