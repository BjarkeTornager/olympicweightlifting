import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyJournal } from "../lib/domain";
import {
  applyGoals,
  describePlan,
  planForState,
  planGoals,
  type BodyGoalsInput,
  type GoalPlan,
} from "../lib/body-goals";
import { leannessLimits } from "../lib/body-composition";
import { prepareAction } from "../lib/agent/actions";
import { coachingContext } from "../lib/coaching";
import { journalSchema } from "../lib/model";
import { buildToday } from "../lib/native-api";
import { voiceAction, voiceToolArgs } from "../lib/voice-actions";
import { voiceContext } from "../lib/voice-checkin";
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

test("pregnancy and breastfeeding: no deficit, the lactation allowance and a midwife", () => {
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
  assert.ok(pregnant.notes.some((n) => /midwife or doctor/.test(n)));
  // Gaining is no deficit, so it stays as planned.
  const gaining = planGoals({ ...mother, targetWeightKg: 76 }, today, {
    pregnancy: "pregnant",
  });
  assert.ok(gaining.calories > gaining.maintenanceKcal);
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
  // Without a stated sex, both levels are named.
  const unstated = planGoals(
    { ...man, sex: "unspecified", targetWeightKg: 75 },
    today,
    { bodyFatPercent: 20 },
  );
  assert.ok(
    unstated.notes.some((n) => /about 5% for men, 12% for women/.test(n)),
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
  // Gaining too, and recomposition makes no small cut meanwhile.
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

test("pregnancy and breastfeeding never plan a deficit, across the grid", () => {
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
                    if (plan.calories < plan.maintenanceKcal)
                      assert.fail(
                        `${pregnancy} deficit: ${JSON.stringify({ sex, age, heightCm, weightKg, change, activity, trainingDays, bodyFatPercent })}`,
                      );
                  }
});

test("Coach and the voice coach pass pregnancy and a confirmation to the same plan", () => {
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
  // A confirmation from the voice coach reaches the plan too.
  const confirm = voiceAction(
    "set_goals",
    {
      ...athlete,
      summary: "Still want 60",
      targetWeightKg: 60,
      confirmLowWeight: true,
    },
    emptyJournal(),
    today,
  );
  assert.equal(
    prepareAction(emptyJournal(), confirm, today).state.nutrition.targets.goal,
    "lose",
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
