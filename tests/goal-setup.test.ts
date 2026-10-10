import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyJournal } from "../lib/domain";
import {
  applyGoals,
  describePlan,
  ENERGY_CHECK_DAYS,
  energyQuestions,
  energyQuestionsFor,
  metricGoals,
  planForState,
  planGoals,
  type BodyGoals,
  type GoalPlan,
} from "../lib/body-goals";
import { coachingContext } from "../lib/coaching";
import { offsetDate } from "../lib/health";
import { journalSchema } from "../lib/model";

// The plan behind Coach's goal setup: the low-energy questions before a
// deficit, weight classes and their weigh-in, feet, inches and pounds, and
// safety notes kept apart from the rest (goal-setup-coach and
// goal-setup-voice cover the two coaches).
const today = "2026-10-04";
type Goals = Omit<BodyGoals, "updatedAt">;
const lifter: Goals = {
  age: 28,
  sex: "male",
  heightCm: 178,
  weightKg: 84,
  targetWeightKg: 81,
  targetDate: null,
  activity: "moderate",
  trainingDays: 5,
  sessionMinutes: 90,
  experience: "experienced",
};
const woman: Goals = {
  ...lifter,
  sex: "female",
  heightCm: 165,
  weightKg: 70,
  targetWeightKg: 64,
};
// Holding weight with no deficit; a floor above maintenance, for a very
// light athlete, can set a little more.
const holdsAtMaintenance = (plan: GoalPlan) =>
  plan.direction === "maintain" && plan.calories >= plan.maintenanceKcal;
const yesNote = (plan: GoalPlan) =>
  plan.safetyNotes.find((n) => n.startsWith("You answered yes to one of"));

test("any yes to the low-energy questions yields maintenance, across the grid", () => {
  let screened = 0;
  for (const age of [14, 17, 18, 30, 50, 80])
    for (const sex of ["male", "female", "unspecified"] as const)
      for (const heightCm of [150, 165, 180, 200])
        for (const weightKg of [40, 55, 70, 90, 120, 200])
          for (const change of [-0.2, -0.1, -0.02, 0, 0.1, 0.2])
            for (const focus of [undefined, "recomposition"] as const)
              for (const activity of ["low", "very_high"] as const)
                for (const trainingDays of [0, 4])
                  for (const bodyFatPercent of [null, 15, 35])
                    for (const targetBodyFatPercent of [null, 6]) {
                      const goals = {
                        ...lifter,
                        age,
                        sex,
                        heightCm,
                        weightKg,
                        targetWeightKg:
                          Math.round(weightKg * (1 + change) * 10) / 10,
                        activity,
                        trainingDays,
                      };
                      const given = {
                        focus,
                        bodyFatPercent,
                        targetBodyFatPercent,
                      };
                      const where = JSON.stringify({ ...goals, ...given });
                      const unasked = planGoals(goals, today, given);
                      const yes = planGoals(goals, today, {
                        ...given,
                        energySigns: true,
                      });
                      const no = planGoals(goals, today, {
                        ...given,
                        energySigns: false,
                      });
                      // Every deficit asks the questions first.
                      if (
                        unasked.calories < unasked.maintenanceKcal &&
                        !unasked.energyCheckDue
                      )
                        assert.fail(`a deficit without asking: ${where}`);
                      // A yes never leaves a deficit, and where the questions
                      // apply it holds at maintenance and says who can help.
                      if (yes.calories < yes.maintenanceKcal)
                        assert.fail(`a deficit after a yes: ${where}`);
                      if (yes.energyCheckDue || no.energyCheckDue)
                        assert.fail(`asked again once answered: ${where}`);
                      if (unasked.energyCheckDue) {
                        screened++;
                        if (!holdsAtMaintenance(yes) || !yesNote(yes))
                          assert.fail(`a yes that doesn't hold: ${where}`);
                        assert.match(
                          yesNote(yes)!,
                          /a sports doctor or sports dietitian/,
                        );
                      }
                      // Otherwise a yes changes the plan only to hold it,
                      // or only adds its note, which always points to who
                      // can help.
                      if (!yesNote(yes)) assert.fail(`a yes unsaid: ${where}`);
                      const same = (plan: GoalPlan) =>
                        JSON.stringify({ ...plan, energyCheckDue: null });
                      const unsaid = (plan: GoalPlan) => ({
                        ...plan,
                        notes: plan.notes.filter((n) => n !== yesNote(plan)),
                        safetyNotes: plan.safetyNotes.filter(
                          (n) => n !== yesNote(plan),
                        ),
                      });
                      if (
                        same(yes) !== same(unasked) &&
                        !holdsAtMaintenance(yes) &&
                        same(unsaid(yes)) !== same(unasked)
                      )
                        assert.fail(`a yes that changes more: ${where}`);
                      // No to all leaves the plan as it was.
                      if (same(no) !== same(unasked))
                        assert.fail(`a no that changes the plan: ${where}`);
                    }
  assert.ok(screened > 1000);
});

test("the questions come only before a deficit or a very lean goal, and the periods one only for women and anyone who'd rather not say, never in pregnancy or while breastfeeding", () => {
  assert.equal(planGoals(lifter, today).energyCheckDue, true);
  // Holding, gaining, under 18 and in pregnancy there is no deficit.
  assert.equal(
    planGoals({ ...lifter, targetWeightKg: 84 }, today).energyCheckDue,
    false,
  );
  assert.equal(
    planGoals({ ...lifter, targetWeightKg: 88 }, today).energyCheckDue,
    false,
  );
  assert.equal(planGoals({ ...lifter, age: 16 }, today).energyCheckDue, false);
  assert.equal(
    planGoals(woman, today, { pregnancy: "pregnant" }).energyCheckDue,
    false,
  );
  // A recomposition's small cut, and a very lean target while gaining.
  assert.equal(
    planGoals({ ...lifter, targetWeightKg: 84 }, today, {
      focus: "recomposition",
    }).energyCheckDue,
    true,
  );
  const lean = planGoals({ ...lifter, targetWeightKg: 88 }, today, {
    bodyFatPercent: 14,
    targetBodyFatPercent: 6,
  });
  assert.equal(lean.energyCheckDue, true);
  assert.ok(
    holdsAtMaintenance(
      planGoals({ ...lifter, targetWeightKg: 88 }, today, {
        bodyFatPercent: 14,
        targetBodyFatPercent: 6,
        energySigns: true,
      }),
    ),
  );
  // The wording follows who was asked what.
  assert.deepEqual(energyQuestionsFor("male"), [
    energyQuestions.fracture,
    energyQuestions.eating,
  ]);
  assert.deepEqual(energyQuestionsFor("unspecified"), [
    energyQuestions.fracture,
    energyQuestions.eating,
    energyQuestions.periods,
  ]);
  assert.match(energyQuestions.periods, /hormonal contraception/);
  // Periods normally stop in pregnancy and while breastfeeding, so a yes
  // there would only hold a gentle loss for nothing.
  for (const pregnancy of ["pregnant", "breastfeeding"] as const)
    assert.deepEqual(energyQuestionsFor("female", pregnancy), [
      energyQuestions.fracture,
      energyQuestions.eating,
    ]);
  assert.match(energyQuestions.periods, /gave birth in the last few months/);
  const nursing = planGoals(woman, today, {
    pregnancy: "breastfeeding",
    weeksSinceBirth: 10,
  });
  assert.equal(nursing.energyCheckDue, true);
  assert.match(
    yesNote(
      planGoals(woman, today, {
        pregnancy: "breastfeeding",
        weeksSinceBirth: 10,
        energySigns: true,
      }),
    )!,
    /questions on stress fractures or eating, so the plan holds/,
  );
  assert.match(
    yesNote(planGoals(lifter, today, { energySigns: true }))!,
    /questions on stress fractures or eating,/,
  );
  assert.match(
    yesNote(planGoals(woman, today, { energySigns: true }))!,
    /questions on stress fractures, eating or periods,/,
  );
  // A yes kept beside a plan that doesn't cut still points to who can help,
  // holding nothing: under 18, and in pregnancy to the midwife.
  const teenYes = planGoals({ ...lifter, age: 16 }, today, {
    energySigns: true,
  });
  assert.equal(
    yesNote(teenYes),
    "You answered yes to one of the questions on stress fractures or eating. These can have many causes, and a sports doctor or sports dietitian can help you look into them.",
  );
  assert.ok(teenYes.safetyNotes.includes(yesNote(teenYes)!));
  assert.match(
    yesNote(
      planGoals(woman, today, { pregnancy: "pregnant", energySigns: true }),
    )!,
    /^You answered yes to one of the questions on stress fractures or eating\. These can have many causes, and your midwife or doctor can help you look into them\.$/,
  );
  // Never a diagnosis, nor a word for the condition.
  for (const plan of [
    planGoals(lifter, today, { energySigns: true }),
    planGoals(woman, today, { energySigns: true }),
  ])
    assert.doesNotMatch(yesNote(plan)!, /RED-?S|energy deficiency|disorder/i);
});

test("the answers are kept only as a day and a yes or no: a no for 3 months, a yes until answered again", () => {
  const state = emptyJournal();
  const answered = applyGoals(state, { ...woman, energySigns: false }, today);
  assert.deepEqual(state.profile.energyCheck, { date: today, signs: false });
  assert.deepEqual(answered.changes, [
    "Saves that you answered no to the questions on stress fractures, eating and periods.",
  ]);
  assert.equal(answered.direction, "lose");
  assert.equal(answered.energyCheckDue, false);
  // Saving again with the same answer keeps its day, and says nothing.
  const later = offsetDate(today, 30);
  const again = applyGoals(state, { ...woman, energySigns: false }, later);
  assert.equal(state.profile.energyCheck?.date, today);
  assert.deepEqual(again.changes, []);
  // About 3 months on, a deficit still running asks again.
  assert.equal(
    planForState(state, offsetDate(today, ENERGY_CHECK_DAYS - 1))
      ?.energyCheckDue,
    false,
  );
  const due = planForState(state, offsetDate(today, ENERGY_CHECK_DAYS))!;
  assert.equal(due.energyCheckDue, true);
  assert.equal(due.direction, "lose");
  // Coach sees it, without a second copy of the notes.
  const context = coachingContext(state, offsetDate(today, ENERGY_CHECK_DAYS));
  assert.equal(context.goals?.plan.energyCheckDue, true);
  assert.equal(context.goals?.plan.safetyNotes, undefined);
  // A yes holds at maintenance, however long ago it was given.
  applyGoals(state, { ...woman, energySigns: true }, today);
  assert.deepEqual(state.profile.energyCheck, { date: today, signs: true });
  assert.ok(holdsAtMaintenance(planForState(state, today)!));
  assert.ok(holdsAtMaintenance(planForState(state, offsetDate(today, 400))!));
  assert.equal(state.nutrition.targets.goal, "maintain");
  // Answered no again, the deficit comes back; null removes the answers.
  applyGoals(state, { ...woman, energySigns: false }, later);
  assert.equal(planForState(state, later)?.direction, "lose");
  const removed = applyGoals(state, { ...woman, energySigns: null }, later);
  assert.equal(state.profile.energyCheck, undefined);
  assert.deepEqual(removed.changes, [
    "Removes your answers to the questions on stress fractures, eating and periods.",
  ]);
  // Only the day and the yes or no are kept.
  assert.ok(
    journalSchema.safeParse({
      ...state,
      profile: {
        ...state.profile,
        energyCheck: { date: today, signs: true, fracture: true },
      },
    }).error,
  );
});

test("a weight class is cut to its limit by the weigh-in, or the plan says what else to consider; never a last-minute cut", () => {
  const weighIn = offsetDate(today, 84);
  const plan = planGoals({ ...lifter, targetDate: weighIn }, today, {
    weightClass: true,
  });
  assert.equal(plan.direction, "lose");
  assert.equal(plan.towardsKg, 81);
  assert.ok(
    describePlan({ ...lifter, targetDate: weighIn }, plan).startsWith(
      `Lose about 0.25 kg a week to make the 81 kg class by the weigh-in on ${weighIn} (about 12 weeks).`,
    ),
  );
  assert.deepEqual(plan.safetyNotes, []);
  assert.equal(plan.makesClass, true);
  // Its weeks never run past the weigh-in: 17.1 weeks away is about 17.
  const later = offsetDate(today, 120);
  assert.match(
    describePlan(
      { ...lifter, targetDate: later },
      planGoals({ ...lifter, targetDate: later }, today, { weightClass: true }),
    ),
    new RegExp(
      `to make the 81 kg class by the weigh-in on ${later} \\(about 17 weeks\\)\\.`,
    ),
  );
  // Just above the class is still a cut, to the limit, where an ordinary
  // goal weight that close holds.
  const close = { ...lifter, weightKg: 81.3 };
  assert.equal(
    planGoals(close, today, { weightClass: true }).direction,
    "lose",
  );
  assert.equal(planGoals(close, today).direction, "maintain");
  assert.match(
    describePlan(close, planGoals(close, today, { weightClass: true })),
    /\(about 1 week\)\./,
  );
  // Too fast to make safely: what the plan reaches, the options, and the
  // acute part left to a coach or sports dietitian.
  const soon = offsetDate(today, 21);
  const fast = planGoals({ ...lifter, targetDate: soon }, today, {
    weightClass: true,
  });
  const classNote = `Making the 81 kg class by the weigh-in on ${soon} would need about 1.00 kg a week; at a sustainable 0.42 kg a week you'd weigh about 82.7 kg then. Consider a later meet or the next class up, and talk it through with your coach or a sports dietitian. The plan never includes a last-minute cut of water or food; leave any such cut to them.`;
  assert.deepEqual(fast.safetyNotes, [classNote]);
  assert.ok(!fast.notes.some((n) => n.startsWith("Reaching ")));
  // Its line heads towards the class rather than promising it, at the same
  // rate as the note.
  assert.equal(fast.makesClass, false);
  assert.ok(
    describePlan({ ...lifter, targetDate: soon }, fast).startsWith(
      "Lose about 0.42 kg a week towards the 81 kg class (about 8 weeks).",
    ),
  );
  const heavier = { ...lifter, weightKg: 85, targetDate: soon };
  const behind = planGoals(heavier, today, { weightClass: true });
  assert.ok(
    describePlan(heavier, behind).startsWith(
      `Lose about ${behind.weeklyChangeKg} kg a week towards the 81 kg class`,
    ),
  );
  assert.match(
    behind.safetyNotes[0],
    new RegExp(
      `at a sustainable ${behind.weeklyChangeKg.toFixed(2)} kg a week`,
    ),
  );
  // Without a class, the ordinary note.
  assert.ok(
    planGoals({ ...lifter, targetDate: soon }, today).notes.some((n) =>
      n.startsWith("Reaching 81 kg by"),
    ),
  );
  // A weigh-in under a week away holds the weight.
  const days = planGoals(
    { ...lifter, targetDate: offsetDate(today, 5) },
    today,
    { weightClass: true },
  );
  assert.ok(holdsAtMaintenance(days));
  assert.deepEqual(days.safetyNotes, [
    "Your weigh-in is less than a week away, too close to plan a safe cut, so the plan holds your weight.",
    "Consider a later meet or the next class up, and talk it through with your coach or a sports dietitian. The plan never includes a last-minute cut of water or food; leave any such cut to them.",
  ]);
  // Under 18 there is no deficit to make a class either, and no cut left to
  // anyone: making weight isn't advised while growing (ACSM).
  const teen = planGoals(
    { ...lifter, age: 16, weightKg: 85, targetDate: weighIn },
    today,
    { weightClass: true },
  );
  assert.ok(holdsAtMaintenance(teen));
  assert.ok(
    teen.safetyNotes.includes(
      `This plan holds your weight up to the weigh-in on ${weighIn}, above the 81 kg class. Consider a later meet or the next class up. Cutting weight to make a class isn't advised while you're growing; talk it through with a parent, your coach or a doctor.`,
    ),
  );
  assert.ok(!teen.notes.some((n) => /leave any such cut/.test(n)));
  // In pregnancy there is no class to make, and no word of a cut.
  const expecting = planGoals(
    { ...woman, weightKg: 66, targetWeightKg: 64, targetDate: weighIn },
    today,
    { weightClass: true, pregnancy: "pregnant" },
  );
  assert.equal(expecting.weightClass, false);
  assert.equal(expecting.dailyTargets, false);
  assert.ok(!expecting.notes.some((n) => /class|cut/.test(n)));
  // Below the class, nothing to make. With no weigh-in date the plan may
  // fill the class over time; with one ahead it holds the weight, so
  // day-to-day swings never leave a cut on the day.
  assert.deepEqual(
    planGoals({ ...lifter, targetWeightKg: 89 }, today, { weightClass: true })
      .safetyNotes,
    [],
  );
  const within = planGoals(
    { ...lifter, targetWeightKg: 89, targetDate: weighIn },
    today,
    { weightClass: true },
  );
  assert.ok(holdsAtMaintenance(within));
  assert.deepEqual(within.safetyNotes, []);
  assert.ok(
    within.notes.includes(
      `You're within the 89 kg class, so the plan holds your weight up to the weigh-in on ${weighIn}.`,
    ),
  );
  // As at a goals check with the class nearly made: no surplus up to it.
  const made = planGoals(
    { ...lifter, weightKg: 80.2, targetDate: weighIn },
    today,
    { weightClass: true },
  );
  assert.ok(holdsAtMaintenance(made));
  assert.ok(!made.notes.some((n) => n.startsWith("Reaching ")));
  // A weigh-in already past has its own note.
  const past = planGoals(
    { ...lifter, targetDate: offsetDate(today, -1) },
    today,
    { weightClass: true },
  );
  assert.equal(past.safetyNotes.length, 1);
  assert.match(past.safetyNotes[0], /^Your target date has passed/);
});

test("the weigh-in is kept while the goal weight is the class", () => {
  const state = emptyJournal();
  const weighIn = offsetDate(today, 84);
  applyGoals(
    state,
    { ...lifter, targetDate: weighIn, weightClass: true },
    today,
  );
  assert.equal(state.profile.weighIn?.classKg, 81);
  assert.equal(state.profile.weighIn?.date, weighIn);
  assert.equal(planForState(state, today)?.weightClass, true);
  assert.ok(journalSchema.safeParse(state).success);
  // Saved again without saying, it stays, with the date moved.
  const moved = offsetDate(today, 98);
  applyGoals(state, { ...lifter, targetDate: moved }, today);
  assert.equal(state.profile.weighIn?.date, moved);
  // A new goal weight is no longer the class, and the save says so first.
  const plan = applyGoals(state, { ...lifter, targetWeightKg: 80 }, today);
  assert.equal(state.profile.weighIn, undefined);
  assert.deepEqual(plan.changes, [
    "Removes your weigh-in for the 81 kg class.",
  ]);
  applyGoals(state, { ...lifter, weightClass: true }, today);
  applyGoals(state, { ...lifter, weightClass: false }, today);
  assert.equal(state.profile.weighIn, undefined);
  // Pregnancy reported later keeps the weigh-in for afterwards, but the
  // plan makes no class of it and says nothing of a cut.
  const later = emptyJournal();
  const athlete = { ...woman, weightKg: 66, targetWeightKg: 64 };
  applyGoals(
    later,
    { ...athlete, targetDate: weighIn, weightClass: true },
    today,
  );
  const pregnant = applyGoals(
    later,
    { ...athlete, targetDate: weighIn, pregnancy: "pregnant" },
    today,
  );
  assert.equal(later.profile.weighIn?.classKg, 64);
  assert.equal(pregnant.weightClass, false);
  assert.ok(!pregnant.notes.some((n) => /class|cut/.test(n)));
});

test("feet, inches and pounds are converted to cm and kg by the app, not the model", () => {
  assert.deepEqual(
    metricGoals({
      heightFeet: 5,
      heightInches: 10,
      weightLb: 190,
      targetWeightLb: 180,
    }),
    { heightCm: 177.8, weightKg: 86.2, targetWeightKg: 81.6 },
  );
  // Inches alone are the whole height; 5 ft 0 in is 5 ft.
  assert.deepEqual(metricGoals({ heightInches: 70 }), { heightCm: 177.8 });
  assert.deepEqual(metricGoals({ heightFeet: 5, heightInches: 0 }), {
    heightCm: 152.4,
  });
  // The zeros a model fills in are no value, and cm and kg stay.
  assert.deepEqual(
    metricGoals({
      heightCm: 180,
      weightKg: 88,
      heightFeet: 0,
      heightInches: 0,
      weightLb: 0,
      targetWeightLb: "",
    }),
    { heightCm: 180, weightKg: 88 },
  );
});

test("safety notes are kept apart for the read-back and the iPhone, and stay among the notes, apart from advice", () => {
  for (const plan of [
    planGoals(lifter, today, { energySigns: true }),
    planGoals({ ...lifter, age: 16 }, today),
    planGoals(woman, today, { pregnancy: "pregnant" }),
    planGoals({ ...lifter, targetWeightKg: 55 }, today),
    planGoals(lifter, today, { limitProtein: true }),
  ]) {
    assert.ok(plan.safetyNotes.length > 0);
    for (const note of plan.safetyNotes) assert.ok(plan.notes.includes(note));
  }
  // A note on training days is advice, not safety.
  const days = planGoals({ ...lifter, trainingDays: 7 }, today);
  assert.ok(days.notes.some((n) => n.includes("sessions a week is plenty")));
  assert.ok(!days.safetyNotes.some((n) => n.includes("is plenty")));
});
