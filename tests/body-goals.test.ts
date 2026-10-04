import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyJournal } from "../lib/domain";
import {
  adjustedWeightKg,
  applyGoals,
  ASSUMED_SESSION,
  bodyGoalsSchema,
  CARBS_FLOOR_G,
  describePlan,
  goalsForState,
  planForState,
  planGoals,
  planTargets,
  proteinPerKg,
  TARGETS_DIFFER,
  weeklyRates,
  type BodyGoalsInput,
  type GoalPlan,
} from "../lib/body-goals";
import { prepareAction } from "../lib/agent/actions";
import { coachingContext } from "../lib/coaching";
import { LIFTING_MET, LIFTING_NET_KCAL_PER_KG_HOUR } from "../lib/energy";
import { journalSchema } from "../lib/model";
import { voiceAction } from "../lib/voice-actions";
import { dayForCoach } from "../lib/journal-summary";
import { voiceContext } from "../lib/voice-checkin";
import { buildToday } from "../lib/native-api";

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
  // 2.0 g/kg is 176 g, to 5 g; fat a quarter of 2,640 kcal (73 g) to the
  // 5 g above; carbohydrate the rest.
  assert.equal(plan.protein, 175);
  assert.equal(plan.fat, 75);
  assert.equal(plan.carbs, 315);
  assert.equal(plan.weeksToGoal, 16);
  assert.equal(plan.sessionsPerWeek, 4);
  assert.deepEqual(plan.notes, []);
  // To 5 g, with the carbohydrate rounded last: within 10 kcal.
  const kcal = plan.protein * 4 + plan.carbs * 4 + plan.fat * 9;
  assert.ok(Math.abs(kcal - plan.calories) <= 10, `${kcal}`);
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
    assert.ok(plan.carbs >= CARBS_FLOOR_G);
    // To 5 g, with the carbohydrate rounded last: within 10 kcal.
    const kcal = plan.protein * 4 + plan.carbs * 4 + plan.fat * 9;
    assert.ok(
      Math.abs(kcal - plan.calories) <= 10,
      `${kcal} vs ${plan.calories}`,
    );
  }
});

test("at a BMI of 30 or more without body fat, protein comes from a height-adjusted weight", () => {
  // The weight at a BMI of 25 plus a quarter of the rest: 140 kg at 180 cm
  // is 81 kg plus 14.75 kg.
  assert.equal(adjustedWeightKg(140, 180), 95.75);
  const estimate = (n: string) =>
    n ===
    "Protein is an estimate from your height and weight; add a body fat reading for a better number.";
  const heavy = {
    ...athlete,
    weightKg: 140,
    heightCm: 180,
    targetWeightKg: 120,
  };
  for (const [goals, protein] of [
    // Losing, 2.0 g/kg of the adjusted weight: 190 g where 2.0 g/kg of
    // bodyweight gave 280, and 230 g at 200 kg (was 400).
    [heavy, 190],
    [{ ...athlete, weightKg: 200, heightCm: 185, targetWeightKg: 160 }, 230],
    // Otherwise 1.6 g/kg of bodyweight, kept between 1.8 and 2.0 g/kg of
    // the adjusted weight: 165 g for a muscular 105 kg at 175 cm (was 189),
    // 210 g at 150 kg and 190 cm (was 270).
    [{ ...athlete, weightKg: 105, heightCm: 175, targetWeightKg: 105 }, 165],
    [{ ...athlete, weightKg: 150, heightCm: 190, targetWeightKg: 150 }, 210],
  ] as const) {
    const plan = planGoals(goals, today);
    assert.equal(plan.protein, protein, `${goals.weightKg} kg`);
    assert.ok(plan.notes.some(estimate), `${goals.weightKg} kg`);
  }
  // A body fat reading gives lean mass and protein from it: 2.5 g/kg of
  // 91 kg, with no note.
  const measured = planGoals(heavy, today, { bodyFatPercent: 35 });
  assert.equal(measured.protein, 230);
  assert.ok(!measured.notes.some(estimate));
  // Just under a BMI of 30, bodyweight as before: 2.0 g/kg of 99 kg.
  const under = planGoals({ ...athlete, weightKg: 99 }, today);
  assert.equal(under.protein, 200);
  assert.ok(!under.notes.some(estimate));
  // Under 18 a reading isn't used, so the note doesn't ask for one; in
  // pregnancy the plan sets no protein target to estimate.
  const teen = planGoals(
    { ...athlete, age: 16, heightCm: 170, weightKg: 100, targetWeightKg: 100 },
    today,
  );
  assert.equal(teen.protein, 160);
  assert.ok(!teen.notes.some(estimate));
  const pregnant = planGoals(
    { ...heavy, sex: "female", age: 30, targetWeightKg: 140 },
    today,
    { pregnancy: "pregnant" },
  );
  assert.ok(!pregnant.notes.some(estimate));
});

test("fat is a quarter of energy, with no floor per kg of bodyweight", () => {
  // At 140 kg the old 0.8 g/kg floor gave 112 g; a quarter of 3,560 kcal
  // is 99 g, to the 5 g above.
  const heavy = planGoals(
    { ...athlete, weightKg: 140, heightCm: 180, targetWeightKg: 120 },
    today,
  );
  assert.equal(heavy.calories, 3560);
  assert.equal(heavy.fat, 100);
  for (const change of [
    {},
    { targetWeightKg: 88 },
    { weightKg: 200, heightCm: 185, targetWeightKg: 160 },
    { sex: "female" as const, heightCm: 165, weightKg: 65, targetWeightKg: 60 },
  ]) {
    const plan = planGoals({ ...athlete, ...change }, today);
    assert.equal(plan.fat, Math.ceil(plan.calories / 36 / 5) * 5);
  }
});

test("carbohydrate stays at 130 g or more: fat gives first, then protein, then calories, and a note says so", () => {
  const woman = {
    ...athlete,
    sex: "female" as const,
    age: 50,
    heightCm: 150,
    weightKg: 55,
    targetWeightKg: 44,
    activity: "low" as const,
    trainingDays: 1,
  };
  const macros = (plan: GoalPlan) => [
    plan.calories,
    plan.protein,
    plan.fat,
    plan.carbs,
  ];
  const note = (plan: GoalPlan) =>
    plan.notes.find((n) => n.startsWith("To keep 130 g of carbohydrate"));
  // 1,240 kcal with 110 g protein and a quarter in fat (35 g) leaves 121 g
  // of carbohydrate; fat at 30 g, 22 % of energy, leaves 135 g.
  const fat = planGoals(woman, today);
  assert.deepEqual(macros(fat), [1240, 110, 30, 135]);
  assert.equal(
    note(fat),
    "To keep 130 g of carbohydrate a day, the generally recommended minimum, fat is about 22% of calories rather than a quarter.",
  );
  // With no training, 1,200 kcal: fat at a fifth (30 g, to the 5 g above)
  // still leaves 122.5 g, so protein goes from 110 g towards 1.6 g/kg.
  const protein = planGoals({ ...woman, trainingDays: 0 }, today);
  assert.deepEqual(macros(protein), [1200, 100, 30, 135]);
  assert.equal(
    note(protein),
    "To keep 130 g of carbohydrate a day, the generally recommended minimum, fat is about 23% of calories rather than a quarter and protein is 100 g rather than 110 g.",
  );
  // At 80, 152 cm and 69 kg, the 1,200 kcal floor with 1.6 g/kg (115 g)
  // and a fifth in fat still leaves 117.5 g: calories go up to 1,250, and
  // the rate and weeks follow them.
  const calories = planGoals(
    {
      ...woman,
      age: 80,
      heightCm: 152,
      weightKg: 69,
      targetWeightKg: 60,
      trainingDays: 0,
    },
    today,
  );
  assert.equal(calories.floorKcal, 1200);
  assert.deepEqual(macros(calories), [1250, 115, 30, 130]);
  assert.equal(calories.direction, "lose");
  assert.equal(calories.weeklyChangeKg, 0.24);
  assert.equal(calories.weeksToGoal, 38);
  assert.equal(
    note(calories),
    "To keep 130 g of carbohydrate a day, the generally recommended minimum, fat is about 22% of calories rather than a quarter, protein is 115 g rather than 140 g and the plan loses more slowly: about 0.24 kg a week.",
  );
  // Carbohydrate, not the floor, sets those calories, so only its note.
  assert.ok(!calories.notes.some((n) => /resting energy and training/.test(n)));
  // With room to spare, no note.
  assert.equal(note(planGoals(athlete, today)), undefined);
  // At 45, 158 cm, 67 to 60 kg: a quarter of 1,450 kcal is 40.3 g, 45 g to
  // the 5 g above, which leaves 126 g of carbohydrate. Fat at 40 g, 24.8 %
  // of energy, is still a quarter, so no note says it is less.
  const roundUp = planGoals(
    {
      ...woman,
      age: 45,
      heightCm: 158,
      weightKg: 67,
      targetWeightKg: 60,
      sessionMinutes: 60,
    },
    today,
  );
  assert.deepEqual(macros(roundUp), [1450, 135, 40, 140]);
  assert.equal(note(roundUp), undefined);
  // In pregnancy the plan saves no macros, so no note on them.
  const older = {
    ...woman,
    age: 72,
    heightCm: 136,
    targetWeightKg: 55,
    trainingDays: 0,
  };
  assert.ok(note(planGoals(older, today)));
  assert.equal(
    note(planGoals(older, today, { pregnancy: "pregnant" })),
    undefined,
  );
});

test("the plan's notes on macros show only beside the plan's own macros", () => {
  const goalNotes = (state: ReturnType<typeof emptyJournal>) =>
    buildToday(state, 1, today, new Set()).body?.goalNotes;
  const state = emptyJournal();
  const plan = applyGoals(
    state,
    {
      ...athlete,
      sex: "female",
      age: 50,
      heightCm: 150,
      weightKg: 55,
      targetWeightKg: 44,
      activity: "low",
      trainingDays: 1,
    },
    today,
  );
  assert.ok(goalNotes(state)?.some((n) => n.startsWith("To keep 130 g")));
  // The same calories with an older plan's macros (fat at 0.8 g/kg, so
  // 101 g of carbohydrate): the line that they differ, not the note.
  state.nutrition.targets = {
    ...state.nutrition.targets,
    fat: 44,
    carbs: 101,
  };
  assert.deepEqual(goalNotes(state), [TARGETS_DIFFER]);
  // A few grams either way, as the next body fat reading moves them, keep
  // the notes.
  state.nutrition.targets = {
    ...planTargets(plan),
    protein: plan.protein + 5,
    carbs: plan.carbs - 5,
  };
  assert.deepEqual(goalNotes(state), plan.notes);
  // A protein target well off the plan's gets the line too, as does none.
  for (const protein of [plan.protein + 30, null]) {
    state.nutrition.targets = { ...planTargets(plan), protein };
    assert.deepEqual(goalNotes(state), [TARGETS_DIFFER], `${protein}`);
  }
});

test("on the safety grid the macros add up, fat stays within 20-35 % of energy (25-35 % under 18), carbohydrate is at least 130 g, and protein at most 2.0 g/kg of the adjusted weight at a BMI of 30 or more", () => {
  // The grid the safety limits are tested on (goal-safety.test.ts).
  let plans = 0;
  for (const age of [14, 16, 17, 18, 30, 50, 80])
    for (const sex of ["male", "female", "unspecified"] as const)
      for (const heightCm of [150, 165, 180, 200])
        for (const weightKg of [40, 55, 70, 90, 120, 160, 200])
          for (const change of [-0.2, -0.1, 0, 0.1, 0.2])
            for (const activity of [
              "low",
              "moderate",
              "high",
              "very_high",
            ] as const)
              for (let trainingDays = 0; trainingDays <= 7; trainingDays++)
                for (const sessionMinutes of [30, 75, 120, 180])
                  for (const bodyFatPercent of [null, 15, 35]) {
                    const goals = {
                      ...athlete,
                      age,
                      sex,
                      heightCm,
                      weightKg,
                      targetWeightKg:
                        Math.round(weightKg * (1 + change) * 10) / 10,
                      activity,
                      trainingDays,
                      sessionMinutes,
                    };
                    const plan = planGoals(goals, today, { bodyFatPercent });
                    plans++;
                    const where = () =>
                      JSON.stringify({ ...goals, bodyFatPercent });
                    const { calories, protein, fat, carbs } = plan;
                    const kcal = protein * 4 + carbs * 4 + fat * 9;
                    if (Math.abs(kcal - calories) > 10)
                      assert.fail(`${kcal} of ${calories} kcal: ${where()}`);
                    if ([protein, fat, carbs].some((g) => g % 5 !== 0))
                      assert.fail(`not to 5 g: ${where()}`);
                    const fatShare = (fat * 9) / calories;
                    if (fatShare < (age < 18 ? 0.25 : 0.2) || fatShare > 0.35)
                      assert.fail(`fat ${fatShare}: ${where()}`);
                    // The note calls fat less than a quarter when it is as
                    // shown, and only then.
                    const underQuarter = plan.notes.some((n) =>
                      /fat is about \d+% of calories rather than a quarter/.test(
                        n,
                      ),
                    );
                    if (underQuarter !== Math.round(fatShare * 100) < 25)
                      assert.fail(`fat note at ${fatShare}: ${where()}`);
                    if (carbs < CARBS_FLOOR_G)
                      assert.fail(`carbohydrate ${carbs} g: ${where()}`);
                    // Within its 5 g rounding.
                    if (
                      plan.leanMassKg == null &&
                      weightKg / (heightCm / 100) ** 2 >= 30 &&
                      protein > 2 * adjustedWeightKg(weightKg, heightCm) + 2.5
                    )
                      assert.fail(`protein ${protein} g: ${where()}`);
                  }
  assert.equal(plans, 7 * 3 * 4 * 7 * 5 * 4 * 8 * 4 * 3);
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
  const grams = (value: number) => Math.round(value / 5) * 5;
  const plan = planGoals(athlete, today);
  assert.equal(plan.weeklyChangeKg, kgPerWeek(weeklyRates.lose.usual));
  assert.equal(
    plan.protein,
    grams(athlete.weightKg * proteinPerKg.bodyweight.losing),
  );
  // Lean (10 % for a man) loses slowest, with protein on lean mass.
  const lean = planGoals(athlete, today, { bodyFatPercent: 10 });
  assert.equal(lean.weeklyChangeKg, kgPerWeek(weeklyRates.lose.lean));
  assert.equal(
    lean.protein,
    grams(athlete.weightKg * 0.9 * proteinPerKg.leanMass.losing),
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
      grams(athlete.weightKg * proteinPerKg.bodyweight.other),
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
    protein: 175,
    carbs: 315,
    fat: 75,
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

test("everyday movement counts 1.4, 1.55, 1.75 or 2.0 times resting energy, never less than 1.4", () => {
  const resting = 1852.5;
  // 4 sessions of 75 min at 4 kcal/kg/h net, at 88 kg, over 7 days.
  const training = (4 * 1.25 * 4 * 88) / 7;
  const tens = (kcal: number) => Math.round(kcal / 10) * 10;
  for (const [activity, factor] of [
    ["low", 1.4],
    ["moderate", 1.55],
    ["high", 1.75],
    ["very_high", 2],
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

test("heavy manual work counts 2.0 and is saved in a shape older versions of the app still read", () => {
  const state = emptyJournal();
  const plan = applyGoals(state, { ...athlete, activity: "very_high" }, today);
  // 1,852.5 × 2.0 + 251 kcal of training.
  assert.equal(plan.maintenanceKcal, 3960);
  // profile.body keeps the three levels older versions accept, with a flag
  // beside it.
  assert.deepEqual(bodyGoalsSchema.shape.activity.options, [
    "low",
    "moderate",
    "high",
  ]);
  assert.equal(state.profile.body?.activity, "high");
  assert.equal(state.profile.heavyManualWork, true);
  const saved = journalSchema.parse(structuredClone(state));
  assert.equal(goalsForState(saved)?.activity, "very_high");
  assert.equal(planForState(saved, today)?.maintenanceKcal, 3960);
  const context = coachingContext(saved, today);
  assert.ok("goals" in context && context.goals?.activity === "very_high");
  // The day both coaches read (typed Coach's "Everything recorded today",
  // the voice context and read_journal) says the same, so a coach that
  // resends the saved details with a new goal weight keeps the level.
  assert.equal(dayForCoach(saved, today).goals?.activity, "very_high");
  const voice = voiceContext(saved, today);
  assert.equal(voice.day.goals?.activity, "very_high");
  const seen: Record<string, unknown> = { ...voice.day.goals };
  delete seen.updatedAt;
  const resent = prepareAction(
    saved,
    voiceAction(
      "set_goals",
      { ...seen, targetWeightKg: 80, targetDate: "", summary: "Goal 80 kg" },
      saved,
      today,
    ),
    today,
  ).state;
  assert.equal(resent.profile.body?.targetWeightKg, 80);
  assert.equal(resent.profile.heavyManualWork, true);
  assert.equal(planForState(resent, today)?.maintenanceKcal, 3960);
  // Another level clears the flag.
  applyGoals(state, athlete, today);
  assert.equal(state.profile.heavyManualWork, undefined);
  assert.equal(goalsForState(state)?.activity, "moderate");
  assert.equal(planForState(state, today)?.maintenanceKcal, 3120);
});
