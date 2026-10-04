import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyJournal } from "../lib/domain";
import {
  applyGoals,
  ASSUMED_SESSION,
  describePlan,
  planGoals,
  proteinPerKg,
  weeklyRates,
  type BodyGoalsInput,
} from "../lib/body-goals";
import { prepareAction } from "../lib/agent/actions";
import { LIFTING_MET, LIFTING_NET_KCAL_PER_KG_HOUR } from "../lib/energy";
import { voiceAction } from "../lib/voice-actions";

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
  // ×1.55 on his feet some of the day (2,871 kcal), plus 4 sessions of
  // 1.25 h × 4 kcal/kg/h net × 88 kg over 7 days (251 kcal): 3,123 kcal,
  // 2,830 before maintenance was raised.
  assert.equal(plan.maintenanceKcal, 3120);
  assert.equal(plan.direction, "lose");
  // 0.5 % of 88 kg a week is 484 kcal a day, under the 500 kcal cap.
  assert.equal(plan.weeklyChangeKg, 0.44);
  assert.equal(plan.calories, 2640);
  assert.equal(plan.protein, 176);
  assert.equal(plan.weeksToGoal, 16);
  assert.equal(plan.sessionsPerWeek, 4);
  assert.deepEqual(plan.notes, []);
  // Only the carbohydrate gram is rounded after the fat: within 2 kcal.
  const kcal = plan.protein * 4 + plan.carbs * 4 + plan.fat * 9;
  assert.ok(Math.abs(kcal - plan.calories) <= 2, `${kcal}`);
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
  const smallWoman = {
    ...athlete,
    sex: "female" as const,
    age: 60,
    heightCm: 150,
    weightKg: 50,
    targetWeightKg: 45,
    activity: "low" as const,
    trainingDays: 0,
  };
  const small = planGoals(smallWoman, today);
  // Resting energy is 980 kcal and maintenance 1,370 (1.4 × resting): the
  // 1,200 kcal floor leaves a small deficit, so the plan loses slowly.
  assert.equal(small.restingKcal, 980);
  assert.equal(small.maintenanceKcal, 1370);
  assert.equal(small.direction, "lose");
  assert.equal(small.calories, 1200);
  assert.equal(small.calories, small.floorKcal);
  assert.equal(small.weeklyChangeKg, 0.15);
  assert.ok(small.notes.some((n) => /loses more slowly/.test(n)));
  // At 70 and 45 kg, maintenance is 1,230: no room for a deficit above the
  // floor, so the plan holds at maintenance.
  const smaller = planGoals(
    { ...smallWoman, age: 70, weightKg: 45, targetWeightKg: 42 },
    today,
  );
  assert.equal(smaller.restingKcal, 880);
  assert.equal(smaller.direction, "maintain");
  assert.equal(smaller.calories, 1230);
  assert.ok(smaller.notes.some((n) => /isn't room for a safe deficit/.test(n)));
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
    calories: 2640,
    protein: 176,
    carbs: 320,
    fat: 73,
  });
  // The brief is the athlete's own: the plan's 4 sessions don't replace
  // the 5 days they said they have.
  assert.deepEqual(next.profile.lifting, state.profile.lifting);
  assert.match(prepared.detail, /2,640 kcal a day/);
  // The original state is untouched until the change is saved.
  assert.equal(state.profile.body, undefined);
  // The saved goals, with their timestamp, plan the same way.
  assert.equal(planGoals(next.profile.body!, today).calories, 2640);
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

test("everyday movement counts 1.4, 1.55 or 1.75 times resting energy, never less than 1.4", () => {
  const resting = 1852.5;
  // 4 sessions of 75 min at 4 kcal/kg/h net, at 88 kg, over 7 days.
  const training = (4 * 1.25 * 4 * 88) / 7;
  const tens = (kcal: number) => Math.round(kcal / 10) * 10;
  for (const [activity, factor] of [
    ["low", 1.4],
    ["moderate", 1.55],
    ["high", 1.75],
  ] as const)
    assert.equal(
      planGoals({ ...athlete, activity }, today).maintenanceKcal,
      tens(resting * factor + training),
      activity,
    );
  // Sitting most of the day with no training still counts 1.4.
  assert.equal(
    planGoals({ ...athlete, activity: "low", trainingDays: 0 }, today)
      .maintenanceKcal,
    tens(resting * 1.4),
  );
});

test("training counts the planned sessions and their length, net of rest, at most 1,000 kcal a day", () => {
  // One cost for an hour of lifting: the burn estimate's 5 METs less the
  // 1 MET of resting energy maintenance already counts.
  assert.equal(LIFTING_NET_KCAL_PER_KG_HOUR, LIFTING_MET - 1);
  assert.equal(LIFTING_NET_KCAL_PER_KG_HOUR, 4);
  // Six days free, four sessions planned at this level: energy for four.
  assert.equal(
    planGoals({ ...athlete, trainingDays: 6 }, today).maintenanceKcal,
    planGoals(athlete, today).maintenanceKcal,
  );
  // Longer sessions count more: 4 × 0.75 h more × 4 × 88 / 7 is 151 kcal.
  const longer = planGoals({ ...athlete, sessionMinutes: 120 }, today);
  assert.ok(
    Math.abs(
      longer.maintenanceKcal - planGoals(athlete, today).maintenanceKcal - 151,
    ) <= 10,
  );
  // Five 4-hour sessions would count 1,006 kcal a day at 88 kg: held to
  // 1,000, in maintenance and the floor, with a note.
  const most = planGoals(
    {
      ...athlete,
      experience: "experienced",
      trainingDays: 6,
      sessionMinutes: 240,
    },
    today,
  );
  assert.equal(most.sessionsPerWeek, 5);
  assert.equal(most.maintenanceKcal, 3870);
  assert.equal(most.floorKcal, 2850);
  assert.ok(
    most.notes.some((n) =>
      n.startsWith("The plan counts your training as 1,000 kcal a day at most"),
    ),
  );
  assert.ok(!planGoals(athlete, today).notes.some((n) => /at most/.test(n)));
});

test("a goal change through Coach or the voice coach keeps the saved session length and experience", () => {
  const state = emptyJournal();
  applyGoals(
    state,
    { ...athlete, sessionMinutes: 120, experience: "experienced" },
    today,
  );
  // A new goal weight, with the required details and nothing else.
  const stated: Partial<BodyGoalsInput> &
    Omit<BodyGoalsInput, "sessionMinutes" | "experience"> = { ...athlete };
  delete stated.sessionMinutes;
  delete stated.experience;
  const typed = prepareAction(
    state,
    { kind: "set_body_goals", bodyGoals: { ...stated, targetWeightKg: 84 } },
    today,
  );
  assert.equal(typed.state.profile.body?.targetWeightKg, 84);
  assert.equal(typed.state.profile.body?.sessionMinutes, 120);
  assert.equal(typed.state.profile.body?.experience, "experienced");
  assert.ok(!typed.detail.includes(ASSUMED_SESSION));
  const spoken = voiceAction(
    "set_goals",
    { ...stated, targetWeightKg: 84, targetDate: "", summary: "Goal 84 kg" },
    state,
    today,
  );
  const body = prepareAction(state, spoken, today).state.profile.body;
  assert.equal(body?.sessionMinutes, 120);
  assert.equal(body?.experience, "experienced");
  // Given again, they change.
  applyGoals(
    state,
    { ...stated, sessionMinutes: 60, experience: "new" },
    today,
  );
  assert.equal(state.profile.body?.sessionMinutes, 60);
  assert.equal(state.profile.body?.experience, "new");
  // With no goals saved, the lifting brief's, its 10 minutes brought up to
  // the goals' 15.
  const briefed = emptyJournal();
  briefed.profile.lifting = {
    goal: "Snatch 80 kg",
    why: "",
    experience: "new",
    daysPerWeek: 3,
    minutesPerSession: 10,
    equipment: "",
    constraints: "",
    priority: "",
    targetDate: null,
    updatedAt: new Date().toISOString(),
  };
  applyGoals(briefed, stated, today);
  assert.equal(briefed.profile.body?.sessionMinutes, 15);
  assert.equal(briefed.profile.body?.experience, "new");
  // With neither, 75 minutes and "developing", and the review says the
  // length was assumed.
  const fresh = prepareAction(
    emptyJournal(),
    { kind: "set_body_goals", bodyGoals: stated },
    today,
  );
  assert.equal(fresh.state.profile.body?.sessionMinutes, 75);
  assert.equal(fresh.state.profile.body?.experience, "developing");
  assert.ok(fresh.detail.includes(ASSUMED_SESSION));
  // Not when no lifting days are planned.
  assert.ok(
    !prepareAction(
      emptyJournal(),
      { kind: "set_body_goals", bodyGoals: { ...stated, trainingDays: 0 } },
      today,
    ).detail.includes(ASSUMED_SESSION),
  );
});
