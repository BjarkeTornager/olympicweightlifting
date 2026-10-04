import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyJournal } from "../lib/domain";
import {
  applyGoals,
  goalsHeading,
  maintainBandKg,
  planForState,
  planGoals,
  planTargets,
  type BodyGoalsInput,
} from "../lib/body-goals";
import { saveBodyFat, weighIns } from "../lib/body-composition";
import { saveCardio } from "../lib/cardio";
import { bodyweightKg, cardioBurn } from "../lib/energy";
import { hydrationTargetMl } from "../lib/hydration";
import { saveCheckin } from "../lib/health";
import { applyBodyMassImport } from "../lib/health-sync";
import { prepareAction } from "../lib/agent/actions";
import { coachingContext, takeTargetsProposal } from "../lib/coaching";
import { regateLegacyTargets } from "../lib/legacy-goal-targets";
import { journalSchema } from "../lib/model";
import { buildToday, buildTrends } from "../lib/native-api";
import {
  currentWeightKg,
  recordTargets,
  TARGET_HISTORY_MAX,
  targetsInForce,
  targetsOn,
} from "../lib/target-history";
import {
  keepCurrentTargets,
  setDailyTargets,
  targetNotes,
  targetsProposal,
} from "../lib/target-proposals";
import { voiceContext } from "../lib/voice-checkin";

// One weight and one target: the plan works from the athlete's current
// weight, the saved targets are the ones shown everywhere, and the plan
// changes them only by suggesting new ones for the athlete to take or keep
// theirs over.
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
type State = ReturnType<typeof emptyJournal>;
const weigh = (state: State, weights: [string, number][]) => {
  for (const [date, bodyweight] of weights)
    saveCheckin(state, { date, bodyweight }, today);
};

test("the current weight is the last week's average of weigh-ins, the goals' weight counting until there are newer ones", () => {
  const state = emptyJournal();
  // Nothing known yet; then Settings' weight.
  assert.equal(currentWeightKg(state, today), null);
  state.profile.bodyweight = 90;
  assert.equal(currentWeightKg(state, today), 90);
  // Weigh-ins, before any goals: the 7 days up to the date.
  weigh(state, [
    ["2026-09-10", 92],
    ["2026-09-21", 89],
    ["2026-09-24", 88.4],
  ]);
  assert.equal(currentWeightKg(state, today), 88.7);
  // Without any in the week, the latest.
  assert.equal(currentWeightKg(state, "2026-10-10"), 88.4);
  // Goals saved today at 88 kg: that is today's weigh-in, and the ones
  // before it no longer count, so the plan right after saving is the one
  // the athlete saw.
  applyGoals(state, athlete, today);
  assert.equal(currentWeightKg(state, today), 88);
  assert.deepEqual(
    planTargets(planForState(state, today)!),
    planTargets(planGoals(athlete, today)),
  );
  assert.equal(targetsProposal(state, today), null);
  // Weigh-ins after it join it for a week, then take over.
  weigh(state, [["2026-09-26", 87.4]]);
  assert.equal(currentWeightKg(state, today), 87.4);
  const later = "2026-10-01";
  const s2 = structuredClone(state);
  saveCheckin(s2, { date: "2026-09-29", bodyweight: 87 }, later);
  saveCheckin(s2, { date: later, bodyweight: 86.6 }, later);
  assert.equal(currentWeightKg(s2, later), 87);
  // A slip (186 for 86) is passed over, unless the next weigh-in agrees.
  saveCheckin(s2, { date: "2026-09-30", bodyweight: 186 }, later);
  assert.equal(currentWeightKg(s2, later), 87);
  // Apple Health's first weight of the day counts too; a check-in wins on
  // its day.
  const synced = structuredClone(state);
  applyBodyMassImport(
    synced,
    { date: "2026-09-28", bodyMassKg: 86.84 },
    new Date(),
  );
  applyBodyMassImport(synced, { date: today, bodyMassKg: 99 }, new Date());
  assert.deepEqual(
    weighIns(synced, "2026-09-26", "2026-09-28").map((w) => [
      w.date,
      w.kg,
      w.source,
    ]),
    [
      [today, 87.4, "checkin"],
      ["2026-09-28", 86.8, "apple-health"],
    ],
  );
  assert.equal(currentWeightKg(synced, "2026-09-28"), 87.1);
  // An unchanged import writes nothing.
  assert.equal(
    applyBodyMassImport(
      synced,
      { date: "2026-09-28", bodyMassKg: 86.8 },
      new Date(),
    ),
    false,
  );
  journalSchema.parse(synced);
});

test("the live plan uses the current weight, and holds it once the goal is reached or passed", () => {
  const state = emptyJournal();
  applyGoals(state, athlete, "2026-08-01");
  weigh(state, [
    ["2026-09-21", 84.4],
    ["2026-09-24", 84],
  ]);
  const plan = planForState(state, today)!;
  // 0.5 % of 84.2 kg a week, from a maintenance at 84.2 kg.
  assert.equal(plan.weeklyChangeKg, 0.42);
  assert.equal(plan.direction, "lose");
  assert.equal(plan.reachedGoal, false);
  // Within 1 kg of the goal (or 1 % of bodyweight, when more) is at it.
  assert.equal(maintainBandKg(81.5), 1);
  assert.equal(maintainBandKg(130), 1.3);
  weigh(state, [["2026-09-26", 81.8]]);
  weigh(state, [
    ["2026-09-21", 81.9],
    ["2026-09-24", 81.7],
  ]);
  const reached = planForState(state, today)!;
  assert.equal(reached.direction, "maintain");
  assert.equal(reached.reachedGoal, true);
  assert.match(reached.notes.join(" "), /You've reached your goal weight/);
  // Past the goal it holds there rather than turning round to gain.
  weigh(state, [
    ["2026-09-21", 79],
    ["2026-09-24", 78.8],
    ["2026-09-26", 78.6],
  ]);
  assert.equal(planForState(state, today)!.direction, "maintain");
  // At setup, a goal past the current weight is simply the other way.
  assert.equal(
    planGoals({ ...athlete, weightKg: 78.8 }, today).direction,
    "gain",
  );
});

test("a new body fat reading doesn't change the targets shown; the plan suggests new ones", () => {
  const state = emptyJournal();
  applyGoals(state, athlete, today);
  const saved = structuredClone(state.nutrition.targets);
  assert.equal(saved.calories, 2640);
  // Coach records a DEXA scan of 26 %: lean mass of 65 kg puts him in the
  // plan's higher-body-fat tier.
  const reviewed = prepareAction(
    state,
    {
      kind: "record_body_fat",
      bodyFat: { date: today, percent: 26, method: "dexa" },
    },
    today,
  );
  assert.match(
    reviewed.detail,
    /Your daily targets stay as they are; your goals plan now suggests new ones, which you can take or leave on Today\./,
  );
  const next = reviewed.state;
  assert.deepEqual(next.nutrition.targets, saved);
  const native = buildToday(next, 1, today, new Set());
  assert.equal(native.nutrition.targetCalories, 2640);
  assert.equal(native.targetsProposal?.title, "New daily targets suggested");
  assert.equal(native.targetsProposal?.current.calories, 2640);
  assert.equal(native.targetsProposal?.suggested.calories, 2280);
  assert.equal(native.targetsProposal?.maintain, false);
  assert.deepEqual(native.targetsProposal?.reasons, [
    "Your body fat reading of 26% on 2026-09-26 puts your lean mass at about 65.1 kg, and the plan works out your energy and protein from it.",
  ]);
  assert.deepEqual(native.body?.goalNotes, [
    "Your goals plan suggests new daily targets, about 2,280 kcal a day. Look at them on Today.",
  ]);
  // Coach and the voice coach see the targets, the plan and the suggestion,
  // and quote the targets.
  const goals = coachingContext(next, today).goals!;
  assert.equal(goals.currentWeightKg, 88);
  assert.equal(goals.proposal?.targets.calories, 2280);
  assert.deepEqual(goals.targetsSet, {
    source: "plan",
    from: today,
    weightKg: 88,
  });
  assert.match(
    voiceContext(next, today).goals!,
    /Suggested new targets, for the athlete to take or keep theirs on Today: 2,280 kcal, 165 g protein, 260 g carbs and 65 g fat a day, to lose weight\. Your body fat reading of 26%/,
  );
  // A reading that moves lean mass by less than 2 kg suggests nothing.
  const small = structuredClone(state);
  applyGoals(small, { ...athlete, bodyFatPercent: 18 }, today);
  saveBodyFat(
    small,
    { date: today, percent: 19, method: "scale" },
    today,
    "apple-health",
  );
  assert.equal(targetsProposal(small, today), null);
});

test("the weight moving 2.5 % since the targets were set suggests new ones", () => {
  const state = emptyJournal();
  applyGoals(state, athlete, "2026-09-01");
  weigh(state, [
    ["2026-09-21", 86.4],
    ["2026-09-24", 86.2],
  ]);
  // 86.3 kg is 1.9 % down: nothing yet.
  assert.equal(targetsProposal(state, today), null);
  weigh(state, [["2026-09-26", 84.4]]);
  const proposal = targetsProposal(state, today)!;
  assert.deepEqual(proposal.reasons, [
    "Your weight is about 85.7 kg now, from 88 kg when your targets were set.",
  ]);
  assert.equal(proposal.targets.goal, "lose");
  assert.ok(proposal.targets.calories! < 2640);
});

test("reaching the goal suggests maintenance; taking it saves the plan's targets, and keeping is remembered", () => {
  const state = emptyJournal();
  applyGoals(state, athlete, "2026-08-01");
  weigh(state, [
    ["2026-09-20", 81.6],
    ["2026-09-22", 81.3],
    ["2026-09-24", 81.4],
    ["2026-09-26", 81.1],
  ]);
  const proposal = targetsProposal(state, today)!;
  assert.equal(proposal.maintain, true);
  assert.deepEqual(proposal.targets, {
    goal: "maintain",
    calories: 3000,
    protein: 145,
    carbs: 415,
    fat: 85,
  });
  assert.deepEqual(proposal.reasons, [
    "Your weight is about 81.4 kg now: you've reached your goal of 81 kg.",
  ]);
  assert.equal(
    buildToday(state, 1, today, new Set()).targetsProposal?.title,
    "Hold your weight from here",
  );
  // Nothing changed yet: the targets shown are still the loss plan's.
  assert.equal(state.nutrition.targets.goal, "lose");
  // Keeping the current targets: not suggested again until the plan moves
  // on from it.
  const kept = structuredClone(state);
  keepCurrentTargets(kept, today, proposal.targets);
  assert.equal(kept.nutrition.targets.goal, "lose");
  assert.equal(targetsProposal(kept, today), null);
  journalSchema.parse(kept);
  // A suggestion that has changed since it was shown is refused.
  assert.throws(
    () =>
      takeTargetsProposal(structuredClone(state), today, {
        ...proposal.targets,
        calories: 2900,
      }),
    /Your goals plan has changed since these targets were suggested/,
  );
  // Taking it saves the plan's targets, as the plan's, at the current
  // weight; there's then nothing to suggest.
  const taken = takeTargetsProposal(state, today, proposal.targets);
  assert.deepEqual(state.nutrition.targets, proposal.targets);
  assert.equal(taken.agreed, undefined);
  assert.deepEqual(
    (({ source, from, weightKgAtSet }) => ({ source, from, weightKgAtSet }))(
      targetsInForce(state),
    ),
    { source: "plan", from: today, weightKgAtSet: 81.4 },
  );
  assert.equal(targetsProposal(state, today), null);
  journalSchema.parse(state);
});

test("in pregnancy, when the plan sets no daily targets, it suggests none", () => {
  const state = emptyJournal();
  applyGoals(
    state,
    {
      ...athlete,
      sex: "female",
      heightCm: 168,
      weightKg: 70,
      targetWeightKg: 64,
      targetDate: "2026-12-01",
      pregnancy: "pregnant",
    },
    today,
  );
  assert.equal(state.nutrition.targets.calories, null);
  // Her own calories, and the date passed: still nothing to suggest.
  setDailyTargets(state, { ...state.nutrition.targets, calories: 2300 }, today);
  assert.equal(targetsProposal(state, "2026-12-05"), null);
});

test("passing the target date suggests maintenance", () => {
  const state = emptyJournal();
  applyGoals(state, { ...athlete, targetDate: "2026-12-01" }, today);
  const later = "2026-12-05";
  const proposal = targetsProposal(state, later)!;
  assert.equal(proposal.maintain, true);
  assert.equal(proposal.targets.goal, "maintain");
  assert.deepEqual(proposal.reasons, [
    "Your target date, 2026-12-01, has passed.",
  ]);
});

test("targets saved by the old plan, whose maintenance was lower, get a suggestion rather than being rewritten", () => {
  // Goals and the targets the old plan gave for them (2,350 kcal), within
  // every limit, so the release check leaves them alone.
  const state = emptyJournal();
  state.profile.body = {
    ...athlete,
    activity: "moderate",
    updatedAt: "2026-09-01T10:00:00.000Z",
  };
  state.nutrition.targets = {
    goal: "lose",
    calories: 2350,
    protein: 176,
    carbs: 253,
    fat: 70,
  };
  const saved = structuredClone(state.nutrition.targets);
  assert.equal(regateLegacyTargets(state, today, "Europe/Copenhagen"), false);
  assert.deepEqual(state.nutrition.targets, saved);
  const proposal = targetsProposal(state, today)!;
  assert.deepEqual(proposal.targets, planTargets(planForState(state, today)!));
  assert.equal(proposal.targets.calories, 2640);
  assert.deepEqual(proposal.reasons, [
    "The plan now counts your everyday movement and training more fully, so your maintenance is about 3,120 kcal a day rather than 2,830.",
  ]);
  assert.equal(
    buildToday(state, 1, today, new Set()).nutrition.targetCalories,
    2350,
  );
  // Taking it records the old targets as they were, then the plan's.
  takeTargetsProposal(state, today, proposal.targets);
  assert.deepEqual(
    state.profile.targetHistory?.map((r) => [r.source, r.from, r.calories]),
    [
      [null, null, 2350],
      ["plan", today, 2640],
    ],
  );
  // Trends draw the old target before today, the new one from today.
  assert.equal(targetsOn(state, "2026-09-25", today)?.calories, 2350);
  assert.equal(targetsOn(state, today, today)?.calories, 2640);
});

test("targets the athlete sets themselves stay theirs: no suggestion until the goal or its date, and the plan's estimate beside them", () => {
  const state = emptyJournal();
  applyGoals(state, athlete, today);
  // Set on Food (or with Coach) to the plan's own: still the plan's.
  setDailyTargets(state, { ...state.nutrition.targets }, today);
  assert.equal(targetsInForce(state).source, "plan");
  setDailyTargets(state, { ...state.nutrition.targets, calories: 2400 }, today);
  assert.equal(targetsInForce(state).source, "manual");
  assert.deepEqual(targetNotes(state, today), [
    "These are your own daily targets; your goals plan's estimate is about 2,640 kcal a day.",
  ]);
  // A body fat reading that would move the plan suggests nothing to them.
  saveBodyFat(state, { date: today, percent: 26, method: "dexa" }, today);
  assert.equal(targetsProposal(state, today), null);
  // Coach's set_diet_targets records them the same way.
  const coach = prepareAction(
    state,
    { kind: "set_diet_targets", targets: { calories: 2500 } },
    today,
  ).state;
  assert.equal(targetsInForce(coach).source, "manual");
  assert.equal(coach.profile.targetHistory?.at(-1)?.calories, 2500);
  // At the goal they're offered maintenance all the same.
  weigh(state, [
    ["2026-09-26", 81.2],
    ["2026-09-25", 81.4],
  ]);
  assert.equal(targetsProposal(state, today)?.maintain, true);
});

test("Trends rows carry the targets in force that day", () => {
  const state = emptyJournal();
  // Before any target, rows have none.
  assert.equal(buildTrends(state, today, 3).days[0].targetCalories, undefined);
  applyGoals(state, athlete, "2026-09-22");
  setDailyTargets(
    state,
    { ...state.nutrition.targets, calories: 2500, protein: 180 },
    "2026-09-24",
  );
  const rows = buildTrends(state, today, 6).days.map((d) => [
    d.date,
    d.targetCalories,
    d.targetProtein,
  ]);
  assert.deepEqual(rows, [
    ["2026-09-21", undefined, undefined],
    ["2026-09-22", 2640, 175],
    ["2026-09-23", 2640, 175],
    ["2026-09-24", 2500, 180],
    ["2026-09-25", 2500, 180],
    ["2026-09-26", 2500, 180],
  ]);
  // Today's targets stay at the top for older builds.
  assert.equal(buildTrends(state, today, 6).targetCalories, 2500);
  // Targets changed by an older version of the app, with no record, count
  // from the day after the last record.
  state.nutrition.targets = { ...state.nutrition.targets, calories: 2450 };
  assert.deepEqual(
    buildTrends(state, today, 3).days.map((d) => d.targetCalories),
    [2500, 2450, 2450],
  );
  // A journal from before records draws today's targets on every day, as
  // before.
  const old = emptyJournal();
  old.nutrition.targets = { ...old.nutrition.targets, calories: 2200 };
  assert.deepEqual(
    buildTrends(old, today, 2).days.map((d) => d.targetCalories),
    [2200, 2200],
  );
});

test("the history keeps where each target came from, and its length", () => {
  const state = emptyJournal();
  applyGoals(state, athlete, today);
  const [record] = state.profile.targetHistory!;
  assert.equal(record.source, "plan");
  assert.equal(record.weightKgAtSet, 88);
  assert.equal(record.setAt, state.profile.body!.updatedAt);
  assert.equal(record.leanMassKgAtSet, undefined);
  for (let i = 0; i < TARGET_HISTORY_MAX + 5; i++)
    recordTargets(
      state,
      { ...state.nutrition.targets, calories: 2000 + i },
      today,
      { source: "manual", weightKg: 88 },
    );
  assert.equal(state.profile.targetHistory?.length, TARGET_HISTORY_MAX);
  assert.equal(
    state.profile.targetHistory?.at(-1)?.calories,
    2000 + TARGET_HISTORY_MAX + 4,
  );
  journalSchema.parse(state);
});

test("a goal below a lean athlete's safer weight isn't reached as it is set", () => {
  // 80 kg at 7 % body fat aiming for 74 kg: the plan holds at 80 kg, and
  // the lean mass note says why; nothing is reached.
  const lean = { ...athlete, heightCm: 180, weightKg: 80, targetWeightKg: 74 };
  const state = emptyJournal();
  const saved = applyGoals(state, { ...lean, bodyFatPercent: 7 }, today);
  assert.equal(saved.direction, "maintain");
  assert.equal(saved.reachedGoal, false);
  assert.ok(!saved.notes.some((n) => /You've reached/.test(n)));
  assert.ok(saved.notes.some((n) => /won't go below a safer weight/.test(n)));
  // The form's preview, heading the way the saved goals will, says the
  // same.
  assert.deepEqual(
    planGoals(lean, today, {
      bodyFatPercent: 7,
      heading: goalsHeading(lean, false),
    }).notes,
    saved.notes,
  );
  // From 90 kg at 17 % the safer weight, 81.2 kg, is somewhere to head,
  // and reaching it is: at 81 kg and 8.5 %, it is 80.6 kg.
  const heavier = emptyJournal();
  applyGoals(heavier, { ...lean, weightKg: 90, bodyFatPercent: 17 }, today);
  assert.equal(planForState(heavier, today)!.towardsKg, 81.2);
  const later = "2027-03-01";
  saveCheckin(heavier, { date: later, bodyweight: 81 }, later);
  saveBodyFat(heavier, { date: later, percent: 8.5, method: "dexa" }, later);
  const reached = planForState(heavier, later)!;
  assert.equal(reached.towardsKg, 80.6);
  assert.equal(reached.reachedGoal, true);
  assert.match(reached.notes.join(" "), /You've reached the 80\.6 kg/);
});

test("the drinks target and burn estimates use the current weight, as the plan does", () => {
  // Goals saved at 88 kg, and a week of weigh-ins around 81 kg since.
  const state = emptyJournal();
  applyGoals(state, athlete, "2026-09-01");
  const heavier = cardioBurn(
    state,
    saveCardio(
      structuredClone(state),
      { date: today, activity: "rowing", durationSeconds: 1800 },
      today,
    ),
  )!.kcal;
  weigh(state, [
    ["2026-09-22", 81.2],
    ["2026-09-24", 80.8],
    ["2026-09-26", 81],
  ]);
  assert.equal(bodyweightKg(state, today), 81);
  // The same as goals saved at 81 kg.
  const lighter = emptyJournal();
  applyGoals(lighter, { ...athlete, weightKg: 81 }, "2026-09-01");
  assert.deepEqual(
    hydrationTargetMl(state, today),
    hydrationTargetMl(lighter, today),
  );
  const row = {
    date: today,
    activity: "rowing",
    durationSeconds: 1800,
  } as const;
  const burn = cardioBurn(state, saveCardio(state, row, today))!.kcal;
  assert.equal(
    burn,
    cardioBurn(lighter, saveCardio(lighter, row, today))!.kcal,
  );
  assert.ok(burn < heavier);
});
