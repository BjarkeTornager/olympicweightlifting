import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyJournal } from "../lib/domain";
import {
  applyGoals,
  babyWeeks,
  CARBS_FLOOR_G,
  describePlan,
  LACTATION_KCAL,
  notesForTargets,
  planForState,
  planGoals,
  planTargets,
  POSTPARTUM_WEEKS,
  pregnancyCarbsFloorG,
  TARGETS_DIFFER,
  type BodyGoals,
  type GoalPlan,
} from "../lib/body-goals";
import { prepareAction } from "../lib/agent/actions";
import { localClock } from "../lib/agent/time-context";
import { coachingContext } from "../lib/coaching";
import { offsetDate } from "../lib/health";
import { journalSchema } from "../lib/model";
import { buildToday } from "../lib/native-api";
import { voiceAction, voiceToolArgs } from "../lib/voice-actions";
import { voiceContext, voiceInstruction } from "../lib/voice-checkin";
import { elevenLabsTools } from "../lib/voice-elevenlabs";

// Pregnancy, breastfeeding and kidney disease, asked with the goals: the
// plan sets no deficit in pregnancy, adds the lactation allowance and waits
// six weeks after a birth before a gentle deficit, keeps more carbohydrate
// in both, and sets no protein target in any of them or with kidney disease
// or a doctor's limit on protein.
const today = "2026-09-26";
type Goals = Omit<BodyGoals, "updatedAt">;
const mother: Goals = {
  age: 31,
  sex: "female",
  heightCm: 168,
  weightKg: 76,
  targetWeightKg: 68,
  targetDate: null,
  activity: "moderate",
  trainingDays: 3,
  sessionMinutes: 60,
  experience: "developing",
};
const man: Goals = {
  age: 52,
  sex: "male",
  heightCm: 180,
  weightKg: 90,
  targetWeightKg: 85,
  targetDate: null,
  activity: "low",
  trainingDays: 3,
  sessionMinutes: 60,
  experience: "developing",
};
const deficit = (plan: GoalPlan) => plan.maintenanceKcal - plan.calories;
const kcal = (plan: GoalPlan) =>
  plan.protein * 4 + plan.carbs * 4 + plan.fat * 9;
const feedingNote = (plan: GoalPlan) =>
  plan.notes.find((n) => n.startsWith("While you're breastfeeding")) ?? "";

test("pregnancy plans no deficit and no targets, protein included, and carbohydrate of at least 175 g", () => {
  for (const targetWeightKg of [68, 76, 82]) {
    const plan = planGoals({ ...mother, targetWeightKg }, today, {
      pregnancy: "pregnant",
      weeksSinceBirth: 10,
    });
    assert.equal(plan.direction, "maintain");
    assert.equal(deficit(plan), 0);
    assert.equal(plan.dailyTargets, false);
    assert.equal(plan.proteinTarget, false);
    assert.equal(planTargets(plan).protein, null);
    assert.ok(plan.carbs >= pregnancyCarbsFloorG.pregnant);
    // The age of an earlier baby doesn't apply in pregnancy.
    assert.equal(feedingNote(plan), "");
  }
  assert.equal(pregnancyCarbsFloorG.pregnant, 175);
});

test("breastfeeding: maintenance plus the allowance, no deficit before 6 weeks or while the baby's age isn't known, then a gentle one", () => {
  const plain = planGoals(mother, today);
  assert.equal(plain.direction, "lose");
  assert.equal(POSTPARTUM_WEEKS, 6);
  // Its age not known, or under 6 weeks: maintenance with the allowance.
  for (const weeksSinceBirth of [null, 0, 3, 5]) {
    const plan = planGoals(mother, today, {
      pregnancy: "breastfeeding",
      weeksSinceBirth,
    });
    assert.equal(plan.maintenanceKcal, plain.maintenanceKcal + LACTATION_KCAL);
    assert.equal(plan.direction, "maintain");
    assert.equal(plan.calories, plan.maintenanceKcal);
    assert.match(feedingNote(plan), /no deficit until your baby is 6 weeks/);
    assert.match(feedingNote(plan), /milk supply/);
    assert.match(feedingNote(plan), /midwife or health visitor/);
    // Without its age, the note says how to plan a gentle loss later,
    // with the plan, not the baby, as what loses.
    assert.equal(
      feedingNote(plan).includes(
        "If you'd like the plan to include a gentle loss once your baby is 6 weeks old, say how old your baby is.",
      ),
      weeksSinceBirth == null,
    );
    assert.doesNotMatch(feedingNote(plan), /like it to lose/);
  }
  // From 6 weeks a gentle loss: 0.5 % of 76 kg is within 500 kcal a day.
  for (const weeksSinceBirth of [6, 12, 40]) {
    const plan = planGoals(mother, today, {
      pregnancy: "breastfeeding",
      weeksSinceBirth,
    });
    assert.equal(plan.direction, "lose");
    assert.equal(plan.maintenanceKcal, 2950);
    assert.equal(plan.calories, 2530);
    assert.equal(plan.weeklyChangeKg, 0.38);
    assert.match(feedingNote(plan), /keeps any deficit gentle/);
    assert.match(feedingNote(plan), /at most about 0\.5 kg a week/);
  }
  // At a BMI of 25 or more the deficit stays within 500 kcal, even with
  // high body fat, which would otherwise allow 1,000.
  const higher = planGoals(
    { ...mother, weightKg: 95, targetWeightKg: 75 },
    today,
    { pregnancy: "breastfeeding", weeksSinceBirth: 10, bodyFatPercent: 40 },
  );
  assert.equal(deficit(higher), 500);
  assert.ok(
    higher.notes.includes(
      "The deficit is kept to 500 kcal a day while you're breastfeeding, so the plan loses about 0.45 kg a week.",
    ),
  );
  // Below a BMI of 25, where loss while breastfeeding wasn't studied,
  // half that.
  const leaner = planGoals(
    { ...mother, weightKg: 62, targetWeightKg: 58 },
    today,
    { pregnancy: "breastfeeding", weeksSinceBirth: 8 },
  );
  assert.equal(deficit(leaner), 250);
  assert.equal(leaner.weeklyChangeKg, 0.23);
  assert.match(feedingNote(leaner), /at most about 0\.25 kg a week/);
  // Holding or gaining weight, the note doesn't ask about the baby.
  const holding = planGoals({ ...mother, targetWeightKg: 76 }, today, {
    pregnancy: "breastfeeding",
  });
  assert.match(feedingNote(holding), /and sets no deficit, with no protein/);
  assert.doesNotMatch(feedingNote(holding), /how old/);
  // Under 18 there is still no deficit.
  const teen = planGoals({ ...mother, age: 17 }, today, {
    pregnancy: "breastfeeding",
    weeksSinceBirth: 20,
  });
  assert.equal(teen.direction, "maintain");
  assert.equal(deficit(teen), 0);
});

test("breastfeeding: the floor counts making milk, carbohydrate is at least 210 g, and there is no protein target", () => {
  const plan = planGoals(mother, today, {
    pregnancy: "breastfeeding",
    weeksSinceBirth: 12,
  });
  assert.equal(plan.proteinTarget, false);
  assert.deepEqual(planTargets(plan), {
    goal: "lose",
    calories: 2530,
    protein: null,
    carbs: 315,
    fat: 75,
  });
  // The other macros still allow for the usual protein, so they add up.
  assert.ok(Math.abs(kcal(plan) - plan.calories) <= 10);
  assert.match(
    describePlan(mother, plan),
    /2,530 kcal a day: 315 g carbs and 75 g fat, with no protein target\./,
  );
  assert.match(feedingNote(plan), /with no protein target/);
  // A small woman with more fat to lose: resting energy and milk set the
  // floor, above the 500 kcal cap.
  const small = planGoals(
    {
      ...mother,
      age: 40,
      heightCm: 155,
      weightKg: 61,
      targetWeightKg: 55,
      activity: "low",
      trainingDays: 0,
    },
    today,
    { pregnancy: "breastfeeding", weeksSinceBirth: 9, bodyFatPercent: 40 },
  );
  assert.ok(deficit(small) > 0 && deficit(small) < 500);
  assert.equal(small.floorKcal, small.restingKcal + LACTATION_KCAL);
  assert.ok(small.calories >= small.floorKcal);
  assert.ok(
    small.notes.some((n) =>
      n.startsWith(
        "Calories are kept at a level that covers your resting energy, training and making milk",
      ),
    ),
  );
  assert.equal(pregnancyCarbsFloorG.breastfeeding, 210);
});

test("across the grid, breastfeeding never cuts before 6 weeks, keeps the gentle cap after, and keeps 210 g of carbohydrate", () => {
  let plans = 0;
  for (const sex of ["female", "unspecified"] as const)
    for (const age of [18, 25, 40, 55])
      for (const heightCm of [150, 170, 190])
        for (const weightKg of [45, 60, 75, 110, 160])
          for (const change of [-0.2, -0.05, 0, 0.1])
            for (const activity of ["low", "moderate", "very_high"] as const)
              for (const trainingDays of [0, 3, 6])
                for (const bodyFatPercent of [null, 35])
                  for (const weeksSinceBirth of [null, 2, 6, 30]) {
                    const goals = {
                      ...mother,
                      age,
                      sex,
                      heightCm,
                      weightKg,
                      targetWeightKg:
                        Math.round(weightKg * (1 + change) * 10) / 10,
                      activity,
                      trainingDays,
                    };
                    const plan = planGoals(goals, today, {
                      pregnancy: "breastfeeding",
                      weeksSinceBirth,
                      bodyFatPercent,
                    });
                    plans++;
                    const where = JSON.stringify({
                      ...goals,
                      bodyFatPercent,
                      weeksSinceBirth,
                    });
                    const cut = deficit(plan);
                    const bmi = weightKg / (heightCm / 100) ** 2;
                    if (
                      (weeksSinceBirth == null ||
                        weeksSinceBirth < POSTPARTUM_WEEKS) &&
                      cut > 0
                    )
                      assert.fail(`a deficit before 6 weeks: ${where}`);
                    if (cut > (bmi >= 25 ? 500 : 250))
                      assert.fail(`deficit ${cut}: ${where}`);
                    if (plan.calories < plan.floorKcal)
                      assert.fail(`below the floor: ${where}`);
                    if (plan.carbs < pregnancyCarbsFloorG.breastfeeding)
                      assert.fail(`carbohydrate ${plan.carbs} g: ${where}`);
                    if (Math.abs(kcal(plan) - plan.calories) > 10)
                      assert.fail(`macros ${kcal(plan)}: ${where}`);
                    if (planTargets(plan).protein != null)
                      assert.fail(`a protein target: ${where}`);
                  }
  assert.equal(plans, 2 * 4 * 3 * 5 * 4 * 3 * 3 * 2 * 4);
});

test("kidney disease or a doctor's limit on protein: no protein target, and the other macros allow for about 0.8 g/kg", () => {
  const usual = planGoals(man, today);
  assert.equal(usual.proteinTarget, true);
  const limited = planGoals(man, today, { limitProtein: true });
  assert.equal(limited.proteinTarget, false);
  // Calories and fat as before; carbohydrate fills what 0.8 g/kg leaves.
  assert.equal(limited.calories, usual.calories);
  assert.equal(limited.fat, usual.fat);
  assert.equal(limited.protein, 70);
  assert.equal(limited.carbs, 330);
  assert.ok(Math.abs(kcal(limited) - limited.calories) <= 10);
  assert.deepEqual(planTargets(limited), {
    goal: "lose",
    calories: 2140,
    protein: null,
    carbs: 330,
    fat: 60,
  });
  assert.ok(
    limited.notes.includes(
      "As you have kidney disease or a doctor's advice to limit protein, the plan sets no protein target. Follow your doctor's or dietitian's advice on how much protein suits you.",
    ),
  );
  assert.match(
    describePlan(man, limited),
    /2,140 kcal a day: 330 g carbs and 60 g fat, with no protein target\./,
  );
  // At a BMI of 30 or more, 0.8 g/kg of the adjusted weight, and no note
  // asking for a body fat reading to estimate a protein target.
  const heavy = planGoals(
    { ...man, weightKg: 140, targetWeightKg: 120 },
    today,
    {
      limitProtein: true,
    },
  );
  assert.equal(heavy.protein, 75);
  assert.ok(!heavy.notes.some((n) => n.startsWith("Protein is an estimate")));
  // For everyone it is asked of: women, teenagers, and with body fat known.
  for (const plan of [
    planGoals(mother, today, { limitProtein: true }),
    planGoals({ ...man, age: 16, heightCm: 175, weightKg: 70 }, today, {
      limitProtein: true,
    }),
    planGoals(man, today, { limitProtein: true, bodyFatPercent: 22 }),
  ]) {
    assert.equal(plan.proteinTarget, false);
    assert.equal(planTargets(plan).protein, null);
    assert.ok(plan.carbs >= CARBS_FLOOR_G);
    assert.ok(Math.abs(kcal(plan) - plan.calories) <= 10);
  }
});

test("the answers are kept with the goals until the athlete says otherwise, apart from the shape older versions read", () => {
  const state = emptyJournal();
  // Through Coach's reviewed change, as through the form or voice.
  const prepared = prepareAction(
    state,
    {
      kind: "set_body_goals",
      bodyGoals: { ...man, limitProtein: true },
    },
    today,
  );
  const next = prepared.state;
  assert.deepEqual(Object.keys(next.profile.goalHealth ?? {}).sort(), [
    "limitProtein",
    "updatedAt",
  ]);
  assert.equal(next.nutrition.targets.protein, null);
  assert.match(prepared.detail, /no protein target/);
  // profile.goalChecks keeps its strict shape, so older versions of the
  // app still read the journal; goalHealth sits beside it.
  assert.equal(next.profile.goalChecks, undefined);
  journalSchema.parse(next);
  // A later change that doesn't mention it keeps it; false removes it.
  applyGoals(next, { ...man, trainingDays: 4 }, today);
  assert.equal(next.profile.goalHealth?.limitProtein, true);
  assert.equal(next.nutrition.targets.protein, null);
  applyGoals(next, { ...man, limitProtein: false }, today);
  assert.equal(next.profile.goalHealth, undefined);
  assert.equal(next.nutrition.targets.protein, 180);

  // The baby's age is kept as the day it was born, only while
  // breastfeeding.
  const feeding = emptyJournal();
  applyGoals(
    feeding,
    { ...mother, pregnancy: "breastfeeding", weeksSinceBirth: 4 },
    today,
  );
  assert.equal(feeding.profile.goalHealth?.babyBornOn, "2026-08-29");
  assert.equal(feeding.profile.goalChecks?.pregnancy, "breastfeeding");
  journalSchema.parse(feeding);
  assert.equal(feeding.nutrition.targets.goal, "maintain");
  assert.equal(feeding.nutrition.targets.protein, null);
  // Two weeks on, the plan could lose gently, but the saved targets are
  // never rewritten on their own: the goals say the targets differ, for
  // the athlete to review with Coach.
  const later = "2026-10-10";
  assert.equal(planForState(feeding, later)?.direction, "lose");
  assert.equal(feeding.nutrition.targets.goal, "maintain");
  assert.deepEqual(
    notesForTargets(planForState(feeding, later)!, feeding.nutrition.targets),
    [TARGETS_DIFFER],
  );
  // Saving the goals again then, without the age, keeps it.
  applyGoals(feeding, { ...mother, trainingDays: 4 }, later);
  assert.equal(feeding.profile.goalHealth?.babyBornOn, "2026-08-29");
  assert.equal(feeding.nutrition.targets.goal, "lose");
  // An empty age on the form removes it, as its preview shows.
  applyGoals(feeding, { ...mother, weeksSinceBirth: null }, later);
  assert.equal(feeding.profile.goalHealth, undefined);
  assert.equal(feeding.profile.goalChecks?.pregnancy, "breastfeeding");
  assert.equal(feeding.nutrition.targets.goal, "maintain");
  // No longer breastfeeding: both go.
  applyGoals(feeding, { ...mother, pregnancy: "neither" }, later);
  assert.equal(feeding.profile.goalChecks, undefined);
  assert.equal(feeding.profile.goalHealth, undefined);
  // The age given in pregnancy isn't kept.
  applyGoals(
    feeding,
    { ...mother, pregnancy: "pregnant", weeksSinceBirth: 30 },
    later,
  );
  assert.equal(feeding.profile.goalHealth, undefined);
});

test("with no protein target, the iPhone shows none", () => {
  const state = emptyJournal();
  applyGoals(state, { ...man, limitProtein: true }, today);
  const native = buildToday(state, 1, today, new Set());
  assert.equal(native.nutrition.targetCalories, 2140);
  assert.equal(native.nutrition.targetProtein, undefined);
  assert.ok(
    native.body?.goalNotes?.some((n) => /sets no protein target/.test(n)),
  );
});

test("Coach and the voice coach pass the answers to the same plan, and get no protein figure to quote", () => {
  // Models send an empty value for an unknown answer; 0 weeks and "no"
  // are answers, and weeks come to the nearest whole one.
  const blank = voiceToolArgs.set_goals.parse({
    ...man,
    summary: "Goals",
    weeksSinceBirth: "",
    limitProtein: "",
  });
  assert.equal(blank.weeksSinceBirth, undefined);
  assert.equal(blank.limitProtein, undefined);
  const given = voiceToolArgs.set_goals.parse({
    ...mother,
    summary: "Goals",
    pregnancy: "breastfeeding",
    weeksSinceBirth: 0,
    limitProtein: false,
  });
  assert.equal(given.weeksSinceBirth, 0);
  assert.equal(given.limitProtein, false);
  assert.equal(
    voiceToolArgs.set_goals.parse({
      ...mother,
      summary: "Goals",
      weeksSinceBirth: 9.6,
    }).weeksSinceBirth,
    10,
  );
  // A voice save reaches the same plan as typed Coach and the form.
  const action = voiceAction(
    "set_goals",
    {
      ...mother,
      summary: "Goals",
      pregnancy: "breastfeeding",
      weeksSinceBirth: 10,
      limitProtein: true,
    },
    emptyJournal(),
    today,
  );
  assert.ok(
    action.kind === "set_body_goals" &&
      action.bodyGoals.weeksSinceBirth === 10 &&
      action.bodyGoals.limitProtein === true,
  );
  const state = prepareAction(emptyJournal(), action, today).state;
  assert.deepEqual(
    { ...state.profile.goalHealth, updatedAt: undefined },
    { limitProtein: true, babyBornOn: "2026-07-18", updatedAt: undefined },
  );
  assert.equal(state.nutrition.targets.goal, "lose");
  assert.equal(state.nutrition.targets.protein, null);
  // Coach gets the plan without a protein figure to quote as a target.
  const plan = coachingContext(state, today).goals?.plan;
  assert.equal(plan?.proteinTarget, false);
  assert.equal(plan?.protein, undefined);
  assert.equal(plan?.calories, state.nutrition.targets.calories);
  // The voice coach hears the same, with the notes that say why.
  const goals = voiceContext(state, today).goals ?? "";
  assert.match(goals, /g fat, with no protein target\./);
  assert.match(goals, /keeps any deficit gentle/);
  assert.match(goals, /kidney disease or a doctor's advice to limit protein/);
  // Both voice providers offer the two answers, and the voice coach asks
  // the questions as optional ones, at goal setup only.
  const setGoals = elevenLabsTools().find(
    (t) => t.name === "set_goals",
  ) as unknown as {
    parameters: { properties: Record<string, { type: string }> };
  };
  assert.equal(setGoals.parameters.properties.weeksSinceBirth.type, "integer");
  assert.equal(setGoals.parameters.properties.limitProtein.type, "boolean");
  const instruction = voiceInstruction(
    voiceContext(emptyJournal(), today),
    localClock(`${today}T09:00:00Z`, "UTC"),
    "Sam",
  );
  assert.ok(
    instruction.includes(
      "Then ask two optional health questions, saying they're kept with their goals only so the plan stays safe: whether they have kidney disease or a doctor has told them to limit protein, and, for women and anyone who'd rather not give their sex, aged 14 to 55, whether they are pregnant or breastfeeding, and if breastfeeding how many weeks old the baby is.",
    ),
  );
  assert.ok(instruction.includes("don't ask about them outside goal setup"));
});

test("a protein target the athlete sets beside a plan that sets none is their own: the notes stay, and saving the goals keeps it", () => {
  const state = emptyJournal();
  applyGoals(state, { ...man, limitProtein: true }, today);
  const plan = planForState(state, today)!;
  assert.equal(state.nutrition.targets.protein, null);
  // Their doctor's figure, saved as they said it, as the kidney note
  // advises.
  const own = prepareAction(
    state,
    { kind: "set_diet_targets", targets: { protein: 70 } },
    today,
  ).state;
  assert.equal(own.nutrition.targets.protein, 70);
  assert.deepEqual(notesForTargets(plan, own.nutrition.targets), plan.notes);
  const native = buildToday(own, 1, today, new Set());
  assert.equal(native.nutrition.targetProtein, 70);
  assert.deepEqual(native.body?.goalNotes, plan.notes);
  // Another target set by hand still says the targets differ.
  const calories = prepareAction(
    own,
    { kind: "set_diet_targets", targets: { calories: 2600 } },
    today,
  ).state;
  assert.deepEqual(notesForTargets(plan, calories.nutrition.targets), [
    TARGETS_DIFFER,
  ]);
  // Coach's goals review, like the form, keeps it and says so.
  const reviewed = prepareAction(
    own,
    { kind: "set_body_goals", bodyGoals: { ...man, trainingDays: 4 } },
    today,
  );
  const next = reviewed.state;
  assert.equal(next.nutrition.targets.protein, 70);
  assert.match(
    reviewed.detail,
    /Your own protein target of 70 g stays as it is\./,
  );
  assert.deepEqual(
    notesForTargets(planForState(next, today)!, next.nutrition.targets),
    planForState(next, today)!.notes,
  );
  // Once the plan sets protein again, its own replaces it, and the review
  // says why first.
  const removed = prepareAction(
    next,
    { kind: "set_body_goals", bodyGoals: { ...man, limitProtein: false } },
    today,
  );
  assert.equal(removed.state.nutrition.targets.protein, 180);
  assert.ok(
    removed.detail.startsWith(
      "Removes your answer about kidney disease or a doctor's limit on protein, so the plan sets 180 g of protein a day. Lose about",
    ),
    removed.detail,
  );
  // A protein target set before the answer isn't one for it, so the answer
  // removes it.
  const earlier = emptyJournal();
  applyGoals(earlier, man, today);
  const handSet = prepareAction(
    earlier,
    { kind: "set_diet_targets", targets: { protein: 150 } },
    today,
  ).state;
  const answered = applyGoals(handSet, { ...man, limitProtein: true }, today);
  assert.equal(handSet.nutrition.targets.protein, null);
  assert.ok(!answered.notes.some((n) => n.startsWith("Your own protein")));
  assert.deepEqual(answered.changes, []);
});

test("a voice goals save that removes the kidney answer or changes the baby's age says so first", () => {
  // The model fills every field of a call that changes only the goal
  // weight, the answers with false and 0.
  const filled = {
    summary: "Goals",
    targetDate: "",
    focus: "",
    bodyFatPercent: 0,
    targetBodyFatPercent: 0,
    weeksSinceBirth: 0,
    limitProtein: false,
    confirmLowWeight: false,
  };
  const kidney = emptyJournal();
  applyGoals(kidney, { ...man, limitProtein: true }, today);
  const removed = prepareAction(
    kidney,
    voiceAction(
      "set_goals",
      { ...man, ...filled, targetWeightKg: 80 },
      kidney,
      today,
    ),
    today,
  );
  assert.ok(
    removed.detail.startsWith(
      "Removes your answer about kidney disease or a doctor's limit on protein, so the plan sets 180 g of protein a day. Lose about",
    ),
    removed.detail,
  );
  // While breastfeeding, the removal says no more, as the plan still sets
  // no protein target, and a changed age is named too.
  const feeding = emptyJournal();
  applyGoals(
    feeding,
    {
      ...mother,
      pregnancy: "breastfeeding",
      weeksSinceBirth: 10,
      limitProtein: true,
    },
    today,
  );
  const changed = prepareAction(
    feeding,
    voiceAction(
      "set_goals",
      { ...mother, ...filled, pregnancy: "breastfeeding", targetWeightKg: 66 },
      feeding,
      today,
    ),
    today,
  );
  assert.ok(
    changed.detail.startsWith(
      "Removes your answer about kidney disease or a doctor's limit on protein. Saves your baby's age as 0 weeks, not 10. Hold around 76 kg.",
    ),
    changed.detail,
  );
  assert.equal(changed.state.profile.goalHealth?.babyBornOn, today);
  // The same answers again change nothing, and say nothing.
  const same = prepareAction(
    feeding,
    voiceAction(
      "set_goals",
      {
        ...mother,
        ...filled,
        pregnancy: "breastfeeding",
        weeksSinceBirth: 10,
        limitProtein: true,
      },
      feeding,
      today,
    ),
    today,
  );
  assert.ok(same.detail.startsWith("Lose about"), same.detail);
  assert.equal(
    same.state.profile.goalHealth?.babyBornOn,
    feeding.profile.goalHealth?.babyBornOn,
  );
  // The voice coach says it first, before anything is saved, and leaves
  // the answer out if it isn't right (goalsReadBack).
  const instruction = voiceInstruction(
    voiceContext(emptyJournal(), today),
    localClock(`${today}T09:00:00Z`, "UTC"),
    "Sam",
  );
  assert.ok(
    instruction.includes(
      "if it lists changes to their saved answers, say those first and ask whether they're right, and if one isn't, call set_goals again leaving that answer out",
    ),
  );
});

test("saving the goals again keeps the baby's birth day, so a gentle deficit can start at 6 weeks", () => {
  const born = "2026-09-01";
  const state = emptyJournal();
  applyGoals(
    state,
    { ...mother, pregnancy: "breastfeeding", weeksSinceBirth: 0 },
    born,
  );
  assert.equal(state.profile.goalHealth?.babyBornOn, born);
  // The form sends back the age it shows, in whole weeks, on every save.
  for (let day = 6; day <= 60; day += 6) {
    const date = offsetDate(born, day);
    const plan = applyGoals(
      state,
      {
        ...mother,
        pregnancy: "breastfeeding",
        weeksSinceBirth: babyWeeks(state, date),
      },
      date,
    );
    assert.equal(state.profile.goalHealth?.babyBornOn, born, date);
    assert.deepEqual(plan.changes, [], date);
  }
  assert.equal(
    planForState(state, offsetDate(born, 41))?.direction,
    "maintain",
  );
  assert.equal(planForState(state, offsetDate(born, 42))?.direction, "lose");
  // A different age is a new answer, and moves the day.
  const date = offsetDate(born, 60);
  const plan = applyGoals(state, { ...mother, weeksSinceBirth: 6 }, date);
  assert.equal(babyWeeks(state, date), 6);
  assert.equal(state.profile.goalHealth?.babyBornOn, offsetDate(date, -42));
  assert.deepEqual(plan.changes, ["Saves your baby's age as 6 weeks, not 8."]);
});
