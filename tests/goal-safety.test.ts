import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyJournal } from "../lib/domain";
import {
  applyGoals,
  describePlan,
  planForState,
  planGoals,
  planTargets,
  TARGETS_DIFFER,
  type BodyGoalsInput,
  type GoalPlan,
} from "../lib/body-goals";
import { leannessLimits, saveBodyFat } from "../lib/body-composition";
import { regateLegacyTargets } from "../lib/legacy-goal-targets";
import { prepareAction } from "../lib/agent/actions";
import { coachingContext } from "../lib/coaching";
import { journalSchema } from "../lib/model";
import { buildToday } from "../lib/native-api";
import { voiceAction, voiceToolArgs } from "../lib/voice-actions";
import { voiceContext, voiceInstruction } from "../lib/voice-checkin";
import { localClock } from "../lib/agent/time-context";
import { elevenLabsTools } from "../lib/voice-elevenlabs";

// The safety limits every goal plan keeps, wherever it is set: the website
// form, Coach, the voice coach and the iPhone all go through planGoals.
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
const teen: BodyGoalsInput = {
  ...athlete,
  age: 16,
  heightCm: 175,
  weightKg: 70,
  targetWeightKg: 65,
};
const mother: BodyGoalsInput = {
  ...athlete,
  age: 31,
  sex: "female",
  heightCm: 168,
  weightKg: 70,
  targetWeightKg: 64,
};
const holds = (plan: GoalPlan) =>
  plan.direction === "maintain" && plan.calories >= plan.maintenanceKcal;

test("under 18: Henry's youth equation, no deficit and no body fat", () => {
  const plan = planGoals(teen, today, {
    bodyFatPercent: 15,
    targetBodyFatPercent: 10,
  });
  // (0.0651 × 70 + 1.11 × 1.75 + 1.25) MJ × 239 is 1,852 kcal, where
  // Mifflin–St Jeor gives 1,720.
  assert.equal(plan.restingKcal, 1850);
  assert.ok(holds(plan));
  assert.equal(plan.weeksToGoal, null);
  assert.equal(plan.focus, "lose_fat");
  // Body fat stays out of the sums and the goals.
  assert.equal(plan.bodyFatPercent, null);
  assert.equal(plan.leanMassKg, null);
  assert.equal(plan.targetBodyFatPercent, null);
  assert.equal(plan.weightAtTargetBodyFatKg, null);
  assert.ok(
    plan.notes.some(
      (n) =>
        n.startsWith("Under 18 the plan doesn't set a calorie deficit") &&
        n.includes("talk it through with a parent, your coach or a doctor"),
    ),
  );
  assert.ok(
    plan.notes.some((n) =>
      /doesn't use body fat readings or set a body fat goal/.test(n),
    ),
  );
  // Girls, and without a stated sex the midpoint of the two.
  const girl = {
    ...teen,
    age: 15,
    sex: "female" as const,
    heightCm: 160,
    weightKg: 55,
    targetWeightKg: 55,
  };
  assert.equal(planGoals(girl, today).restingKcal, 1380);
  assert.equal(
    planGoals({ ...girl, sex: "unspecified" }, today).restingKcal,
    1480,
  );
  // At 18 the adult equation and plan apply.
  const adult = planGoals({ ...teen, age: 18 }, today);
  assert.equal(adult.restingKcal, 1710);
  assert.equal(adult.direction, "lose");
  // Recomposition sets no deficit either; gaining stays open.
  const recomp = planGoals({ ...teen, targetWeightKg: 70 }, today, {
    focus: "recomposition",
  });
  assert.equal(recomp.calories, recomp.maintenanceKcal);
  const gain = planGoals({ ...teen, targetWeightKg: 74 }, today);
  assert.equal(gain.direction, "gain");
  assert.ok(gain.calories > gain.maintenanceKcal);
  // A reading logged anyway still flags a goal far too lean for a teenager.
  const tooLean = planGoals(
    { ...girl, age: 16, heightCm: 165, targetWeightKg: 47 },
    today,
    { bodyFatPercent: 20 },
  );
  assert.ok(holds(tooLean));
  assert.ok(
    tooLean.notes.some((n) => /very low body fat for a teenager/.test(n)),
  );
});

test("goals saved under 18 show no body fat target, and the plan's notes, everywhere", () => {
  const state = emptyJournal();
  applyGoals(state, { ...teen, targetBodyFatPercent: 10 }, today);
  assert.equal(state.nutrition.targets.goal, "maintain");
  const body = buildToday(state, 1, today, new Set()).body;
  assert.equal(body?.targetBodyFatPercent, undefined);
  assert.ok(body?.goalNotes?.some((n) => n.startsWith("Under 18")));
  const goals = coachingContext(state, today).goals;
  assert.equal(goals?.targetBodyFatPercent, undefined);
  assert.equal(goals?.plan.direction, "maintain");
  assert.ok(goals?.plan.notes.some((n) => n.startsWith("Under 18")));
  // The voice coach hears the plan with its notes.
  assert.match(
    voiceContext(state, today).goals ?? "",
    /^Hold around 70 kg\..*Under 18 the plan doesn't set a calorie deficit/,
  );
});

test("pregnancy: no weight goal and no daily targets; breastfeeding: the lactation allowance and no deficit", () => {
  const plain = planGoals(mother, today);
  assert.equal(plain.direction, "lose");
  const pregnant = planGoals(mother, today, {
    pregnancy: "pregnant",
    bodyFatPercent: 30,
    targetBodyFatPercent: 22,
  });
  assert.ok(holds(pregnant));
  assert.equal(pregnant.bodyFatPercent, null);
  assert.equal(pregnant.targetBodyFatPercent, null);
  // Needs rise by trimester, so the plan saves no daily target that would
  // turn into a deficit later on, and says so in words.
  assert.equal(pregnant.dailyTargets, false);
  assert.deepEqual(planTargets(pregnant), {
    goal: "maintain",
    calories: null,
    protein: null,
    carbs: null,
    fat: null,
  });
  assert.match(
    describePlan(mother, pregnant),
    /^No weight goal, and no daily calorie or macro targets, while you're pregnant\. 4 training sessions a week\.$/,
  );
  const note = pregnant.notes.find((n) => n.startsWith("In pregnancy"));
  assert.match(note ?? "", /energy needs rise as it goes on/);
  assert.match(note ?? "", /midwife or doctor/);
  assert.doesNotMatch(note ?? "", /deficit/);
  // A goal weight above, a target date or recomposition plan nothing either.
  for (const plan of [
    planGoals({ ...mother, targetWeightKg: 76 }, today, {
      pregnancy: "pregnant",
    }),
    planGoals({ ...mother, targetDate: "2026-09-20" }, today, {
      pregnancy: "pregnant",
    }),
    planGoals({ ...mother, targetWeightKg: 70 }, today, {
      pregnancy: "pregnant",
      focus: "recomposition",
    }),
  ]) {
    assert.ok(holds(plan));
    assert.equal(planTargets(plan).calories, null);
    assert.ok(!plan.notes.some((n) => /target date|holds your weight/.test(n)));
  }
  // Making milk takes about 500 kcal a day, and there's no deficit.
  const feeding = planGoals(mother, today, { pregnancy: "breastfeeding" });
  assert.equal(feeding.maintenanceKcal, plain.maintenanceKcal + 500);
  assert.ok(holds(feeding));
  assert.equal(feeding.calories, feeding.maintenanceKcal);
  assert.ok(
    feeding.notes.some(
      (n) => /milk supply/.test(n) && /midwife or health visitor/.test(n),
    ),
  );
});

test("goals saved in pregnancy set no daily target anywhere", () => {
  const state = emptyJournal();
  applyGoals(state, { ...mother, pregnancy: "pregnant" }, today);
  assert.deepEqual(state.nutrition.targets, {
    goal: "maintain",
    calories: null,
    protein: null,
    carbs: null,
    fat: null,
  });
  // The iPhone shows no Energy or Protein target, and the plan's note.
  const native = buildToday(state, 1, today, new Set());
  assert.equal(native.nutrition.targetCalories, undefined);
  assert.equal(native.nutrition.targetProtein, undefined);
  assert.ok(native.body?.goalNotes?.some((n) => n.startsWith("In pregnancy")));
  // Setting them still counts as a first step done.
  assert.equal(native.firstSteps?.goals, true);
  // Coach gets the plan without figures to quote as a target.
  const plan = coachingContext(state, today).goals?.plan;
  assert.equal(plan?.dailyTargets, false);
  assert.equal(plan?.calories, undefined);
  assert.equal(plan?.protein, undefined);
  assert.match(
    voiceContext(state, today).goals ?? "",
    /^No weight goal, and no daily calorie or macro targets, while you're pregnant\./,
  );
});

test("pregnancy is kept with the goals until the athlete says neither", () => {
  const prepared = prepareAction(
    emptyJournal(),
    {
      kind: "set_body_goals",
      bodyGoals: { ...mother, pregnancy: "breastfeeding" },
    },
    today,
  );
  const next = prepared.state;
  assert.equal(next.profile.goalChecks?.pregnancy, "breastfeeding");
  assert.match(prepared.detail, /milk supply/);
  assert.equal(next.nutrition.targets.goal, "maintain");
  // Kept beside profile.body, whose shape older clients check strictly.
  assert.deepEqual(
    Object.keys(next.profile.body!).sort(),
    [...Object.keys(mother), "updatedAt"].sort(),
  );
  journalSchema.parse(next);
  // The live plan follows it, so it matches the saved targets.
  assert.equal(
    planForState(next, today)?.calories,
    next.nutrition.targets.calories,
  );
  // A later change that doesn't mention it keeps it; "neither" removes it.
  applyGoals(next, { ...mother, trainingDays: 3 }, today);
  assert.equal(next.profile.goalChecks?.pregnancy, "breastfeeding");
  applyGoals(next, { ...mother, pregnancy: "neither" }, today);
  assert.equal(next.profile.goalChecks, undefined);
  assert.equal(planForState(next, today)?.direction, "lose");
});

test("BMI gates: no loss plan under 17.5; just under 18.5 only once confirmed, and slowly", () => {
  // 57 kg at 182 cm is a BMI of 17.2: no loss plan, even if confirmed.
  const low = planGoals({ ...athlete, targetWeightKg: 57 }, today, {
    lowWeightConfirmed: true,
  });
  assert.ok(holds(low));
  assert.equal(low.confirmToLose, false);
  assert.ok(
    low.notes.some(
      (n) =>
        n.startsWith("That goal weight is well below the healthy range") &&
        n.includes("doctor or dietitian"),
    ),
  );
  // A current weight that low gets the same note, also when gaining.
  const thin = planGoals(
    { ...athlete, weightKg: 56, targetWeightKg: 62 },
    today,
  );
  assert.equal(thin.direction, "gain");
  assert.ok(
    thin.notes.some((n) =>
      n.startsWith("Your weight is well below the healthy range"),
    ),
  );
  // 60 kg is a BMI of 18.1: the plan holds until the athlete confirms.
  const near = { ...athlete, targetWeightKg: 60 };
  const waiting = planGoals(near, today);
  assert.ok(holds(waiting));
  assert.ok(waiting.confirmToLose);
  assert.ok(
    waiting.notes.some((n) =>
      /confirm it and the plan will lose slowly/.test(n),
    ),
  );
  const confirmed = planGoals(near, today, { lowWeightConfirmed: true });
  assert.equal(confirmed.direction, "lose");
  assert.equal(confirmed.confirmToLose, false);
  assert.ok(confirmed.notes.some((n) => /As you've confirmed it/.test(n)));
  // Then at most 0.5 % a week, even with more fat to lose: 0.35 kg at
  // 70 kg, where a healthy goal loses 0.53 kg.
  const woman = {
    ...athlete,
    sex: "female" as const,
    age: 28,
    heightCm: 165,
    weightKg: 70,
    activity: "high" as const,
    trainingDays: 5,
    sessionMinutes: 90,
  };
  assert.equal(
    planGoals({ ...woman, targetWeightKg: 52 }, today, { bodyFatPercent: 40 })
      .weeklyChangeKg,
    0.53,
  );
  assert.equal(
    planGoals({ ...woman, targetWeightKg: 49 }, today, {
      bodyFatPercent: 40,
      lowWeightConfirmed: true,
    }).weeklyChangeKg,
    0.35,
  );
});

test("a confirmed low goal weight holds for that goal weight only", () => {
  const state = emptyJournal();
  const checks = () => state.profile.goalChecks;
  applyGoals(state, { ...athlete, targetWeightKg: 60 }, today);
  assert.equal(state.nutrition.targets.goal, "maintain");
  assert.equal(checks(), undefined);
  applyGoals(
    state,
    { ...athlete, targetWeightKg: 60, confirmLowWeight: true },
    today,
  );
  assert.equal(state.nutrition.targets.goal, "lose");
  assert.equal(checks()?.lowWeightConfirmedKg, 60);
  assert.equal(planForState(state, today)?.direction, "lose");
  // Kept when other details change…
  applyGoals(state, { ...athlete, targetWeightKg: 60, trainingDays: 3 }, today);
  assert.equal(state.nutrition.targets.goal, "lose");
  // …and asked again for a new goal weight.
  applyGoals(state, { ...athlete, targetWeightKg: 59 }, today);
  assert.equal(state.nutrition.targets.goal, "maintain");
  assert.equal(checks(), undefined);
});

test("a goal weight is checked against lean mass and the lowest healthy body fat", () => {
  // 90 kg at 20 % is 72 kg lean; at 8 %, the very lean limit for men, that
  // is 78.3 kg.
  const man = { ...athlete, weightKg: 90 };
  const belowLean = planGoals({ ...man, targetWeightKg: 70 }, today, {
    bodyFatPercent: 20,
  });
  assert.equal(belowLean.towardsKg, 78.3);
  assert.ok(belowLean.notes.some((n) => /below your lean mass/.test(n)));
  assert.match(
    describePlan({ ...man, targetWeightKg: 70 }, belowLean),
    /towards 78\.3 kg/,
  );
  // 75 kg would be about 4 %.
  const tooLean = planGoals({ ...man, targetWeightKg: 75 }, today, {
    bodyFatPercent: 20,
  });
  assert.equal(tooLean.towardsKg, 78.3);
  assert.ok(
    tooLean.notes.some((n) =>
      n.startsWith(
        "That goal weight would take your body fat below the lowest healthy level (about 5% for men), so the plan won't go below a safer weight.",
      ),
    ),
  );
  // Without a stated sex, both levels are named, and the women's level and
  // very lean limit apply, so no one heads leaner than is safe for them. A
  // woman at 60 kg and 22 % (46.8 kg lean) who leaves the default and aims
  // for 52 kg (about 10 %) goes only to 55.7 kg, as she would as a woman.
  const unstated = planGoals(
    { ...man, sex: "unspecified", targetWeightKg: 75 },
    today,
    { bodyFatPercent: 20 },
  );
  assert.ok(
    unstated.notes.some((n) => /about 5% for men, 12% for women/.test(n)),
  );
  const unsaid = {
    ...athlete,
    sex: "unspecified" as const,
    age: 28,
    heightCm: 168,
    weightKg: 60,
    targetWeightKg: 52,
  };
  for (const sex of ["unspecified", "female"] as const) {
    const plan = planGoals({ ...unsaid, sex }, today, {
      bodyFatPercent: 22,
      lowWeightConfirmed: true,
    });
    assert.equal(plan.towardsKg, 55.7, sex);
    assert.ok(plan.notes.some((n) => /below the lowest healthy level/.test(n)));
  }
  // 8 % is below the lowest level the note names for women.
  assert.ok(
    planGoals(unsaid, today, { targetBodyFatPercent: 8 }).notes.some((n) =>
      n.startsWith(
        "8% body fat is below the lowest healthy level (about 5% for men, 12% for women)",
      ),
    ),
  );
  // Under 18 the girls' level: 53 kg would be about 12 % at 60 kg and 22 %.
  assert.ok(
    planGoals({ ...unsaid, age: 16, targetWeightKg: 53 }, today, {
      bodyFatPercent: 22,
    }).notes.some((n) => /very low body fat for a teenager/.test(n)),
  );
  // Between the lowest level and very lean: planned, with the peak note.
  const veryLean = planGoals({ ...man, targetWeightKg: 77 }, today, {
    bodyFatPercent: 20,
  });
  assert.equal(veryLean.towardsKg, 77);
  assert.ok(veryLean.notes.some((n) => /short peak at most/.test(n)));
  // A woman at 64 kg and 22 % aiming for 52 kg (about 4 %) goes only to
  // 59.4 kg, the weight at 16 %; her low goal still needs confirming.
  const woman = {
    ...athlete,
    sex: "female" as const,
    age: 28,
    heightCm: 168,
    weightKg: 64,
    targetWeightKg: 52,
  };
  assert.ok(planGoals(woman, today, { bodyFatPercent: 22 }).confirmToLose);
  const her = planGoals(woman, today, {
    bodyFatPercent: 22,
    lowWeightConfirmed: true,
  });
  assert.equal(her.towardsKg, 59.4);
  assert.equal(her.direction, "lose");
  assert.ok(her.notes.some((n) => /about 12% for women/.test(n)));
  // A target body fat below the lowest level is worded the same way.
  assert.ok(
    planGoals(woman, today, { targetBodyFatPercent: 10 }).notes.some((n) =>
      n.startsWith(
        "10% body fat is below the lowest healthy level (about 12% for women)",
      ),
    ),
  );
});

test("deficits stay within 500 kcal unless body fat is high and never go below the floor; the rate and weeks follow", () => {
  // 0.5 % of 160 kg is 0.8 kg a week, 880 kcal a day: held to 500.
  const heavy = {
    ...athlete,
    weightKg: 160,
    heightCm: 190,
    targetWeightKg: 120,
  };
  const capped = planGoals({ ...heavy, activity: "high" }, today);
  assert.equal(capped.maintenanceKcal - capped.calories, 500);
  assert.equal(capped.weeklyChangeKg, 0.45);
  assert.equal(capped.weeksToGoal, 88);
  assert.ok(
    capped.notes.some(
      (n) =>
        /kept to 500 kcal a day/.test(n) && /about 0\.45 kg a week/.test(n),
    ),
  );
  // At 35 % body fat, 0.75 % a week (1,320 kcal a day) is held to 1,000.
  const higher = planGoals({ ...heavy, activity: "high" }, today, {
    bodyFatPercent: 35,
  });
  assert.equal(higher.maintenanceKcal - higher.calories, 1000);
  assert.equal(higher.weeklyChangeKg, 0.91);
  assert.equal(higher.weeksToGoal, 44);
  assert.ok(higher.notes.some((n) => /kept to 1,000 kcal a day/.test(n)));
  // A woman training 5 × 90 min: resting energy plus training is the floor,
  // and the slower rate is the one stated.
  const floored = planGoals(
    {
      ...athlete,
      sex: "female",
      age: 30,
      heightCm: 160,
      weightKg: 59,
      targetWeightKg: 55,
      activity: "low",
      trainingDays: 5,
      sessionMinutes: 90,
    },
    today,
  );
  assert.equal(floored.calories, floored.floorKcal);
  assert.equal(floored.calories, 1560);
  assert.equal(floored.weeklyChangeKg, 0.23);
  assert.equal(floored.weeksToGoal, 18);
  assert.ok(
    floored.notes.some((n) =>
      /loses more slowly: about 0\.23 kg a week/.test(n),
    ),
  );
});

test("a target date under a week away, or past, holds weight with a note", () => {
  const past = planGoals({ ...athlete, targetDate: "2026-09-20" }, today);
  assert.ok(holds(past));
  assert.ok(
    past.notes.some(
      (n) => /target date has passed/.test(n) && /Review your goals/.test(n),
    ),
  );
  for (const targetDate of [today, "2026-09-30", "2026-10-02"]) {
    const soon = planGoals({ ...athlete, targetDate }, today);
    assert.ok(holds(soon), targetDate);
    assert.ok(soon.notes.some((n) => /less than a week away/.test(n)));
  }
  // Gaining too, and recomposition makes no small cut meanwhile, also at a
  // steady weight.
  assert.ok(
    holds(
      planGoals(
        { ...athlete, targetWeightKg: 92, targetDate: "2026-09-30" },
        today,
      ),
    ),
  );
  assert.ok(
    holds(
      planGoals({ ...athlete, targetDate: "2026-09-30" }, today, {
        focus: "recomposition",
      }),
    ),
  );
  for (const targetDate of ["2026-09-01", "2026-09-30"]) {
    const steady = planGoals(
      { ...athlete, targetWeightKg: 88, targetDate },
      today,
      { focus: "recomposition" },
    );
    assert.ok(holds(steady), targetDate);
    assert.ok(
      steady.notes.some((n) => /target date (has passed|is less than)/.test(n)),
    );
  }
  // With no date, or one far enough off, it keeps its small cut.
  assert.equal(
    planGoals({ ...athlete, targetWeightKg: 88 }, today, {
      focus: "recomposition",
    }).calories,
    2690,
  );
  // A week away is enough to plan, at no more than the sustainable rate.
  const week = planGoals({ ...athlete, targetDate: "2026-10-03" }, today);
  assert.equal(week.direction, "lose");
  assert.equal(week.weeklyChangeKg, 0.44);
});

test("on a wide grid every plan keeps to the floor, the gates and the deficit cap, and states the rate its calories give", () => {
  const bmi = (kg: number, cm: number) => kg / (cm / 100) ** 2;
  let plans = 0;
  for (const age of [14, 16, 17, 18, 30, 50, 80])
    for (const sex of ["male", "female", "unspecified"] as const)
      for (const heightCm of [150, 165, 180, 200])
        for (const weightKg of [40, 55, 70, 90, 120, 160, 200])
          for (const change of [-0.2, -0.1, 0, 0.1, 0.2])
            for (const activity of ["low", "moderate", "high"] as const)
              for (let trainingDays = 0; trainingDays <= 7; trainingDays++)
                for (const sessionMinutes of [30, 75, 120, 180])
                  for (const bodyFatPercent of [null, 15, 35]) {
                    const targetWeightKg =
                      Math.round(weightKg * (1 + change) * 10) / 10;
                    const plan = planGoals(
                      {
                        ...athlete,
                        age,
                        sex,
                        heightCm,
                        weightKg,
                        targetWeightKg,
                        activity,
                        trainingDays,
                        sessionMinutes,
                      },
                      today,
                      { bodyFatPercent },
                    );
                    plans++;
                    const where = JSON.stringify({
                      age,
                      sex,
                      heightCm,
                      weightKg,
                      targetWeightKg,
                      activity,
                      trainingDays,
                      sessionMinutes,
                      bodyFatPercent,
                    });
                    const deficit = plan.maintenanceKcal - plan.calories;
                    if (plan.calories < plan.floorKcal)
                      assert.fail(`below the floor: ${where}`);
                    // No deficit under 18, or under BMI 18.5 now or at the
                    // goal (17.5 to 18.5 only once confirmed, never here).
                    if (
                      (age < 18 ||
                        bmi(weightKg, heightCm) < 18.5 ||
                        bmi(targetWeightKg, heightCm) < 18.5) &&
                      deficit > 0
                    )
                      assert.fail(`a deficit: ${where}`);
                    const higher =
                      plan.bodyFatPercent != null &&
                      plan.bodyFatPercent >= leannessLimits(sex).higher;
                    if (deficit > (higher ? 1000 : 500))
                      assert.fail(`deficit ${deficit}: ${where}`);
                    if (plan.direction === "maintain") {
                      if (plan.weeklyChangeKg !== 0 || plan.weeksToGoal != null)
                        assert.fail(`a change while holding: ${where}`);
                    } else if (
                      (plan.direction === "lose") !== deficit > 0 ||
                      Math.abs(
                        plan.weeklyChangeKg - (Math.abs(deficit) * 7) / 7700,
                      ) > 0.015 ||
                      !(plan.weeksToGoal! >= 1)
                    )
                      assert.fail(
                        `${plan.weeklyChangeKg} kg a week from ${deficit} kcal: ${where}`,
                      );
                  }
  assert.equal(plans, 7 * 3 * 4 * 7 * 5 * 3 * 8 * 4 * 3);
});

test("pregnancy and breastfeeding never plan a deficit, and pregnancy no target, across the grid", () => {
  for (const pregnancy of ["pregnant", "breastfeeding"] as const)
    for (const sex of ["female", "unspecified"] as const)
      for (const age of [16, 25, 40, 55])
        for (const heightCm of [150, 170, 190])
          for (const weightKg of [45, 70, 110, 160])
            for (const change of [-0.2, 0, 0.2])
              for (const activity of ["low", "high"] as const)
                for (const trainingDays of [0, 3, 6])
                  for (const bodyFatPercent of [null, 35]) {
                    const plan = planGoals(
                      {
                        ...mother,
                        age,
                        sex,
                        heightCm,
                        weightKg,
                        targetWeightKg:
                          Math.round(weightKg * (1 + change) * 10) / 10,
                        activity,
                        trainingDays,
                      },
                      today,
                      { pregnancy, bodyFatPercent },
                    );
                    const where = JSON.stringify({
                      sex,
                      age,
                      heightCm,
                      weightKg,
                      change,
                      activity,
                      trainingDays,
                      bodyFatPercent,
                    });
                    if (plan.calories < plan.maintenanceKcal)
                      assert.fail(`${pregnancy} deficit: ${where}`);
                    // In pregnancy no target at all, so none to fall short.
                    if (
                      pregnancy === "pregnant" &&
                      planTargets(plan).calories != null
                    )
                      assert.fail(`a pregnancy target: ${where}`);
                  }
});

test("Coach and the voice coach pass pregnancy to the same plan; a confirmation by voice waits for the plan to ask", () => {
  // Models send an empty value for an unknown status.
  const args = voiceToolArgs.set_goals.parse({
    ...mother,
    summary: "Goals",
    targetDate: "",
    pregnancy: "",
  });
  assert.equal(args.pregnancy, undefined);
  const action = voiceAction(
    "set_goals",
    { ...mother, summary: "Goals", pregnancy: "pregnant" },
    emptyJournal(),
    today,
  );
  assert.ok(
    action.kind === "set_body_goals" &&
      action.bodyGoals.pregnancy === "pregnant",
  );
  const prepared = prepareAction(emptyJournal(), action, today);
  assert.match(prepared.detail, /midwife or doctor/);
  assert.equal(prepared.state.nutrition.targets.goal, "maintain");
  // A call saves with no review, so a confirmation from the voice coach
  // counts only once the saved plan has asked for it: sent on the first
  // call, the plan still holds and its note asks.
  const lowGoal = {
    ...athlete,
    summary: "Down to 60, I'm sure",
    targetWeightKg: 60,
    confirmLowWeight: true,
  };
  const first = voiceAction("set_goals", lowGoal, emptyJournal(), today);
  assert.ok(
    first.kind === "set_body_goals" &&
      first.bodyGoals.confirmLowWeight === undefined,
  );
  const held = prepareAction(emptyJournal(), first, today);
  assert.equal(held.state.nutrition.targets.goal, "maintain");
  assert.equal(held.state.profile.goalChecks, undefined);
  assert.match(held.detail, /confirm it and the plan will lose slowly/);
  // Asked for that goal weight, the athlete's yes reaches the plan.
  const again = voiceAction("set_goals", lowGoal, held.state, today);
  const confirmed = prepareAction(held.state, again, today).state;
  assert.equal(confirmed.nutrition.targets.goal, "lose");
  assert.equal(confirmed.profile.goalChecks?.lowWeightConfirmedKg, 60);
  // Not for a different goal weight than the one asked about.
  const other = voiceAction(
    "set_goals",
    { ...lowGoal, targetWeightKg: 59 },
    held.state,
    today,
  );
  assert.ok(
    other.kind === "set_body_goals" &&
      other.bodyGoals.confirmLowWeight === undefined,
  );
  // Typed Coach's review card is the confirmation, so it takes the flag.
  assert.equal(
    prepareAction(
      emptyJournal(),
      {
        kind: "set_body_goals",
        bodyGoals: { ...athlete, targetWeightKg: 60, confirmLowWeight: true },
      },
      today,
    ).state.nutrition.targets.goal,
    "lose",
  );
  // The voice coach is told to wait for the plan's note and the athlete's
  // yes, by both providers.
  const clock = localClock(`${today}T09:00:00Z`, "UTC");
  for (const instruction of [
    voiceInstruction(voiceContext(emptyJournal(), today), clock, "Sam"),
    voiceInstruction(
      voiceContext(emptyJournal(), today),
      clock,
      "Sam",
      "checkin",
      [],
      { savedPhotos: false },
    ),
  ])
    assert.ok(
      instruction.includes(
        "If the result says the plan holds their weight until they confirm, read that note kindly, and only if they say they still want to lose weight call set_goals again with confirmLowWeight true.",
      ),
    );
  // Both voice providers offer the two fields.
  const setGoals = elevenLabsTools().find(
    (t) => t.name === "set_goals",
  ) as unknown as {
    parameters: {
      properties: Record<string, { type: string; enum?: string[] }>;
    };
  };
  assert.deepEqual(setGoals.parameters.properties.pregnancy.enum, [
    "pregnant",
    "breastfeeding",
    "neither",
  ]);
  assert.equal(setGoals.parameters.properties.confirmLowWeight.type, "boolean");
});

test("the iPhone shows the plan's notes only beside the plan's own targets", () => {
  // Never a note that contradicts the target shown with it: the plan's
  // notes come only with its goal and calories, within 100 kcal.
  const consistent = (state: ReturnType<typeof emptyJournal>, date: string) => {
    const today = buildToday(state, 1, date, new Set());
    const notes = today.body?.goalNotes ?? [];
    const plan = planForState(state, date)!;
    if (notes.join() === TARGETS_DIFFER) return notes;
    assert.deepEqual(notes, plan.notes);
    assert.equal(state.nutrition.targets.goal, plan.direction);
    assert.ok(Math.abs(today.nutrition.targetCalories! - plan.calories) <= 100);
    return notes;
  };
  // Saved with a date in December: on the day, the plan's own targets and
  // notes.
  const state = emptyJournal();
  applyGoals(state, { ...athlete, targetDate: "2026-12-01" }, today);
  assert.equal(state.nutrition.targets.calories, 2350);
  assert.match(consistent(state, today).join(), /keeps to a sustainable/);
  // Once the date has passed the plan holds at 2,830, but the saved target
  // is still 2,350, so the iPhone says they differ rather than that the
  // plan holds his weight.
  const later = "2026-12-05";
  assert.match(planForState(state, later)!.notes.join(), /date has passed/);
  const native = buildToday(state, 1, later, new Set());
  assert.equal(native.nutrition.targetCalories, 2350);
  assert.deepEqual(native.body?.goalNotes, [TARGETS_DIFFER]);
  consistent(state, later);
  // A teenager's target saved before the limits (1,730 kcal, lose) gets the
  // same line, not "Under 18 ... it holds your weight" beside a deficit.
  const teenager = emptyJournal();
  teenager.profile.body = {
    ...teen,
    sex: "female",
    heightCm: 165,
    weightKg: 60,
    targetWeightKg: 55,
    trainingDays: 3,
    updatedAt: "2026-09-01T10:00:00.000Z",
  };
  teenager.nutrition.targets = {
    goal: "lose",
    calories: 1730,
    protein: 120,
    carbs: 204,
    fat: 48,
  };
  assert.deepEqual(consistent(teenager, today), [TARGETS_DIFFER]);
  // A scale's reading the next day moves the plan by a few kcal: still its
  // notes.
  applyGoals(state, { ...athlete, bodyFatPercent: 18 }, today);
  const next = "2026-09-27";
  saveBodyFat(
    state,
    { date: next, percent: 17.4, method: "scale" },
    next,
    "apple-health",
  );
  assert.notEqual(
    planForState(state, next)!.calories,
    state.nutrition.targets.calories,
  );
  assert.notDeepEqual(consistent(state, next), [TARGETS_DIFFER]);
  // Targets set by hand, or none, get the line.
  state.nutrition.targets.calories = 2800;
  assert.deepEqual(consistent(state, next), [TARGETS_DIFFER]);
  state.nutrition.targets.calories = 0;
  assert.deepEqual(consistent(state, next), [TARGETS_DIFFER]);
});

test("old saved targets that break a hard limit follow the plan again, once; others are left alone", () => {
  // Goals saved before the limits, on 1 September, with the targets the old
  // plan gave for them.
  const saved = (
    goals: BodyGoalsInput,
    targets: ReturnType<typeof emptyJournal>["nutrition"]["targets"],
  ) => {
    const state = emptyJournal();
    state.profile.body = { ...goals, updatedAt: "2026-09-01T10:00:00.000Z" };
    state.nutrition.targets = { ...targets };
    return state;
  };
  const regated = (state: ReturnType<typeof emptyJournal>) => {
    const before = structuredClone(state.nutrition.targets);
    const changed = regateLegacyTargets(state, today, "Europe/Copenhagen");
    if (changed) {
      assert.notDeepEqual(state.nutrition.targets, before);
      assert.deepEqual(
        state.nutrition.targets,
        planTargets(planForState(state, today)!),
      );
      // Once: run again, nothing changes.
      assert.equal(
        regateLegacyTargets(state, today, "Europe/Copenhagen"),
        false,
      );
      // Now the iPhone shows the plan's notes beside them.
      assert.deepEqual(
        buildToday(state, 1, today, new Set()).body?.goalNotes,
        planForState(state, today)!.notes,
      );
    } else assert.deepEqual(state.nutrition.targets, before);
    return changed;
  };
  const girl = {
    ...teen,
    sex: "female" as const,
    heightCm: 165,
    weightKg: 60,
    targetWeightKg: 55,
    trainingDays: 3,
  };
  // Under 18: the old 1,730 kcal deficit becomes maintenance.
  const minor = saved(girl, {
    goal: "lose",
    calories: 1730,
    protein: 120,
    carbs: 204,
    fat: 48,
  });
  assert.ok(regated(minor));
  assert.equal(minor.nutrition.targets.goal, "maintain");
  assert.ok(minor.nutrition.targets.calories! > 1730);
  // Fat and carbs from the rounded calories, as saved from 4 October, too.
  assert.ok(
    regated(
      saved(girl, {
        goal: "lose",
        calories: 1730,
        protein: 120,
        carbs: 205,
        fat: 48,
      }),
    ),
  );
  // A 770 kcal deficit at 140 kg is held to 500.
  const heavy = saved(
    { ...athlete, weightKg: 140, heightCm: 190, targetWeightKg: 120 },
    { goal: "lose", calories: 3010, protein: 280, carbs: 221, fat: 112 },
  );
  assert.ok(regated(heavy));
  const heavyPlan = planForState(heavy, today)!;
  assert.equal(heavyPlan.maintenanceKcal - heavyPlan.calories, 500);
  // A goal at a BMI of 17.2 holds weight.
  const thin = saved(
    { ...athlete, targetWeightKg: 57 },
    { goal: "lose", calories: 2350, protein: 176, carbs: 253, fat: 70 },
  );
  assert.ok(regated(thin));
  assert.equal(thin.nutrition.targets.goal, "maintain");
  // Below resting energy plus training: up to the floor.
  const floored = saved(
    {
      ...athlete,
      sex: "female",
      age: 30,
      heightCm: 160,
      weightKg: 59,
      targetWeightKg: 55,
      activity: "low",
      trainingDays: 5,
      sessionMinutes: 90,
    },
    { goal: "lose", calories: 1490, protein: 118, carbs: 150, fat: 47 },
  );
  assert.ok(regated(floored));
  assert.equal(floored.nutrition.targets.calories, 1560);
  // A teenager's recomposition loses its small cut.
  const recomp = saved(
    { ...teen, targetWeightKg: 70 },
    { goal: "maintain", calories: 2460, protein: 140, carbs: 322, fat: 68 },
  );
  recomp.profile.bodyTargets = {
    focus: "recomposition",
    targetBodyFatPercent: null,
    updatedAt: "2026-09-01T10:00:00.000Z",
  };
  assert.ok(regated(recomp));
  // Within every limit: left as saved (2,350 kcal, 81 kg).
  assert.equal(
    regated(
      saved(athlete, {
        goal: "lose",
        calories: 2350,
        protein: 176,
        carbs: 253,
        fat: 70,
      }),
    ),
    false,
  );
  // Set by hand, they are the athlete's own, also under 18.
  for (const targets of [
    {
      goal: "lose" as const,
      calories: 1800,
      protein: 120,
      carbs: 204,
      fat: 48,
    },
    {
      goal: "lose" as const,
      calories: 1730,
      protein: 110,
      carbs: 204,
      fat: 48,
    },
    {
      goal: "maintain" as const,
      calories: null,
      protein: null,
      carbs: null,
      fat: null,
    },
  ])
    assert.equal(regated(saved(girl, targets)), false);
  // Goals saved with this release's checks were planned within the limits.
  const checked = saved(girl, {
    goal: "lose",
    calories: 1730,
    protein: 120,
    carbs: 204,
    fat: 48,
  });
  checked.profile.goalChecks = {
    pregnancy: null,
    lowWeightConfirmedKg: 55,
    updatedAt: "2026-09-01T10:00:00.000Z",
  };
  assert.equal(regated(checked), false);
});
