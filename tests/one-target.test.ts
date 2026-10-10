import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyJournal } from "../lib/domain";
import {
  applyGoals,
  goalsHeading,
  liveGoals,
  maintainBandKg,
  planBodyFat,
  planForState,
  planGoals,
  planTargets,
  type BodyGoalsInput,
} from "../lib/body-goals";
import { saveBodyFat, weighIns } from "../lib/body-composition";
import { saveCardio } from "../lib/cardio";
import { bodyweightKg, cardioBurn } from "../lib/energy";
import { hydrationTargetMl } from "../lib/hydration";
import { offsetDate, saveCheckin } from "../lib/health";
import { applyBodyMassImport } from "../lib/health-sync";
import { prepareAction } from "../lib/agent/actions";
import {
  coachingContext,
  followUpGoals,
  takeTargetsProposal,
} from "../lib/coaching";
import { regateLegacyTargets } from "../lib/legacy-goal-targets";
import { journalSchema } from "../lib/model";
import { buildToday, buildTrends } from "../lib/native-api";
import {
  currentWeightKg,
  recordTargets,
  setSettingsWeight,
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
import { trendAgainstPlan } from "../lib/weight-trend";

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
    "Your goals plan suggests new daily targets, about 2,280 kcal a day: take them, or keep yours, on Today. If you don't see them there, update the app.",
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

test("a recomposition's small cut ending at its target date suggests holding the weight, and says why", () => {
  const state = emptyJournal();
  const saved = applyGoals(
    state,
    {
      ...athlete,
      sex: "female",
      age: 30,
      heightCm: 168,
      weightKg: 64,
      targetWeightKg: 64,
      targetDate: "2026-11-01",
      focus: "recomposition",
      energySigns: false,
    },
    "2026-09-01",
  );
  assert.equal(saved.direction, "maintain");
  assert.ok(saved.calories < saved.maintenanceKcal);
  const proposal = targetsProposal(state, "2026-11-05")!;
  assert.equal(proposal.maintain, true);
  assert.equal(proposal.targets.goal, "maintain");
  assert.equal(proposal.targets.calories, saved.maintenanceKcal);
  assert.deepEqual(proposal.reasons, [
    "Your target date, 2026-11-01, has passed.",
  ]);
  assert.equal(
    buildToday(state, 1, "2026-11-05", new Set()).targetsProposal?.title,
    "Hold your weight from here",
  );
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
  // Still a deficit, with no answers to the low-energy questions: they
  // come first. Taking it with a no records the old targets as they were,
  // then the plan's.
  assert.ok(proposal.energyCheck);
  takeTargetsProposal(state, today, proposal.targets, false);
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
  // Saved earlier, so today's weigh-ins count however fast the test runs.
  applyGoals(state, athlete, "2026-09-01");
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

// A woman of 30 who saved goals to hold 62 kg on 1 September.
const holder: BodyGoalsInput = {
  age: 30,
  sex: "female",
  heightCm: 168,
  weightKg: 62,
  targetWeightKg: 62,
  targetDate: null,
  activity: "moderate",
  trainingDays: 4,
  sessionMinutes: 75,
  experience: "developing",
};

test("a suggestion that sets a deficit says why, and asks the low-energy questions before it can be taken", () => {
  const state = emptyJournal();
  applyGoals(state, holder, "2026-09-01");
  assert.equal(state.nutrition.targets.calories, 2280);
  // Her weight has moved off it by more than day-to-day swings.
  weigh(state, [
    ["2026-09-21", 63],
    ["2026-09-24", 63.2],
    ["2026-09-26", 63.1],
  ]);
  const proposal = targetsProposal(state, today)!;
  assert.equal(proposal.targets.goal, "lose");
  assert.equal(proposal.targets.calories, 1960);
  assert.deepEqual(proposal.reasons, [
    "Your weight is about 63.1 kg now, above the 62 kg you aim to hold.",
  ]);
  // A deficit with no answers in force: the questions come first, on the
  // website and the iPhone, with what a yes saves instead.
  assert.equal(proposal.plan.energyCheckDue, true);
  assert.equal(proposal.energyCheck?.questions.length, 3);
  assert.deepEqual(proposal.energyCheck?.ifYes, {
    goal: "maintain",
    calories: 2300,
    protein: 115,
    carbs: 315,
    fat: 65,
  });
  const native = buildToday(state, 1, today, new Set()).targetsProposal!;
  assert.equal(
    native.energyCheck?.title,
    "Before a deficit: a few health questions",
  );
  assert.match(native.energyCheck!.note, /about 2,300 kcal a day/);
  // With a yes the iPhone shows the notes of the plan that holds the
  // weight, which say why and who can help, in place of the deficit's.
  const heldPlan = planForState(state, today, undefined, true)!;
  assert.deepEqual(native.energyCheck?.ifYesNotes, heldPlan.notes);
  assert.ok(
    heldPlan.notes.some(
      (n) =>
        n.startsWith("You answered yes to one of the questions") &&
        /sports doctor or sports dietitian/.test(n),
    ),
  );
  assert.ok(!heldPlan.notes.some((n) => proposal.plan.notes.includes(n)));
  // Without an answer, nothing is taken.
  assert.throws(
    () => takeTargetsProposal(structuredClone(state), today, proposal.targets),
    /a few health questions come first/,
  );
  // Rather not say: the suggestion is taken, with its goals check, and
  // nothing is kept about the questions.
  const unsaid = structuredClone(state);
  const taken = takeTargetsProposal(unsaid, today, proposal.targets, null);
  assert.equal(unsaid.nutrition.targets.calories, 1960);
  assert.equal(unsaid.profile.energyCheck, undefined);
  assert.equal(taken.agreed?.followUpDate, "2026-10-17");
  // No to all: kept with the date.
  const no = structuredClone(state);
  takeTargetsProposal(no, today, proposal.targets, false);
  assert.equal(no.nutrition.targets.calories, 1960);
  assert.deepEqual(no.profile.energyCheck, { date: today, signs: false });
  // Any yes: kept, and the plan holds her weight instead, with no check of
  // a loss.
  const yes = structuredClone(state);
  const held = takeTargetsProposal(yes, today, proposal.targets, true);
  assert.deepEqual(yes.profile.energyCheck, { date: today, signs: true });
  assert.deepEqual(yes.nutrition.targets, proposal.energyCheck!.ifYes);
  assert.equal(held.agreed, undefined);
  assert.equal(targetsInForce(yes).source, "plan");
  journalSchema.parse(yes);
  // Kept over with an answer, the answer is kept too, so a yes is never
  // lost; the suggestion kept over is then the one that holds the weight.
  const keptYes = structuredClone(state);
  assert.equal(
    keepCurrentTargets(keptYes, today, proposal.targets, true).held,
    true,
  );
  assert.deepEqual(keptYes.profile.energyCheck, { date: today, signs: true });
  assert.deepEqual(keptYes.nutrition.targets, state.nutrition.targets);
  assert.equal(planForState(keptYes, today)!.energyCheckDue, false);
  assert.equal(targetsProposal(keptYes, today), null);
  const keptNo = structuredClone(state);
  keepCurrentTargets(keptNo, today, proposal.targets, false);
  assert.deepEqual(keptNo.profile.energyCheck, { date: today, signs: false });
  assert.equal(targetsProposal(keptNo, today), null);
  for (const signs of [null, undefined]) {
    const kept = structuredClone(state);
    keepCurrentTargets(kept, today, proposal.targets, signs);
    assert.equal(kept.profile.energyCheck, undefined);
  }
  // A maintenance suggestion asks nothing.
  const reached = emptyJournal();
  applyGoals(reached, athlete, "2026-08-01");
  weigh(reached, [
    ["2026-09-24", 81.2],
    ["2026-09-26", 81.4],
  ]);
  assert.equal(targetsProposal(reached, today)?.energyCheck, undefined);
});

test("while breastfeeding, the baby reaching 6 weeks is named as why the plan can now lose", () => {
  const state = emptyJournal();
  applyGoals(
    state,
    {
      ...holder,
      age: 31,
      weightKg: 75,
      targetWeightKg: 68,
      trainingDays: 3,
      sessionMinutes: 60,
      pregnancy: "breastfeeding",
      weeksSinceBirth: 3,
    },
    "2026-09-01",
  );
  assert.equal(state.nutrition.targets.goal, "maintain");
  const proposal = targetsProposal(state, today)!;
  assert.equal(proposal.targets.goal, "lose");
  assert.deepEqual(proposal.reasons, [
    "Your baby is now 6 weeks old, so your goals plan can include a gentle loss.",
  ]);
  // Periods aren't asked about while breastfeeding.
  assert.equal(proposal.energyCheck?.questions.length, 2);
  // At 6 months the plan counts less for making milk, and says so.
  const older = emptyJournal();
  applyGoals(
    older,
    {
      ...holder,
      age: 31,
      weightKg: 68,
      targetWeightKg: 68,
      trainingDays: 3,
      sessionMinutes: 60,
      pregnancy: "breastfeeding",
      weeksSinceBirth: 20,
    },
    "2026-09-01",
  );
  const sixMonths = offsetDate("2026-09-01", 7 * 6);
  const lower = targetsProposal(older, sixMonths)!;
  assert.equal(
    lower.plan.maintenanceKcal,
    planForState(older, "2026-09-01")!.maintenanceKcal - 100,
  );
  assert.deepEqual(lower.reasons, [
    "Your baby is now 26 weeks old, so your goals plan counts about 400 kcal a day for making milk rather than 500.",
  ]);
});

test("slow loss towards a target date never suggests cutting further; the goals check looks at it", () => {
  // 88 to 82 kg by September 2027: about 0.1 kg a week at 3,000 kcal.
  const far = emptyJournal();
  applyGoals(
    far,
    { ...athlete, targetWeightKg: 82, targetDate: "2027-09-01" },
    "2026-09-01",
  );
  assert.equal(far.nutrition.targets.calories, 3000);
  const june = "2027-06-15";
  for (const [date, bodyweight] of [
    ["2027-06-10", 87.6],
    ["2027-06-13", 87.4],
    ["2027-06-15", 87.5],
  ] as const)
    saveCheckin(far, { date, bodyweight }, june);
  // The plan now loses 0.44 kg a week, 370 kcal lower: not suggested.
  assert.ok(planForState(far, june)!.calories <= 2640);
  assert.equal(targetsProposal(far, june), null);
  // Nor with the date 13 weeks out, nor at any weight within 2.5 % on any
  // day before the date: a suggestion never cuts below the saved target.
  for (const [target, due] of [
    [84, "2026-12-01"],
    [80, "2027-03-01"],
    [82, "2027-09-01"],
  ] as const) {
    const state = emptyJournal();
    applyGoals(
      state,
      { ...athlete, targetWeightKg: target, targetDate: due },
      "2026-09-01",
    );
    const saved = state.nutrition.targets.calories!;
    for (let day = "2026-09-08"; day < due; day = offsetDate(day, 14))
      for (const kg of [86.3, 87, 87.5, 88, 89, 90]) {
        const s = structuredClone(state);
        for (const back of [0, 2, 4])
          saveCheckin(s, { date: offsetDate(day, -back), bodyweight: kg }, day);
        const proposal = targetsProposal(s, day);
        if (proposal?.targets.goal === "lose")
          assert.ok(
            proposal.targets.calories! >= saved,
            `${target} by ${due}, ${kg} kg on ${day}`,
          );
      }
  }
  // Losing faster than the date needs: the plan eases off, and says why.
  const ahead = emptyJournal();
  applyGoals(
    ahead,
    { ...athlete, targetWeightKg: 84, targetDate: "2026-11-15" },
    "2026-09-01",
  );
  const sept = "2026-09-08";
  for (const back of [0, 2, 4])
    saveCheckin(ahead, { date: offsetDate(sept, -back), bodyweight: 86 }, sept);
  const easier = targetsProposal(ahead, sept)!;
  assert.ok(easier.targets.calories! > ahead.nutrition.targets.calories!);
  assert.deepEqual(easier.reasons, [
    "You're about 2 kg from your goal, with about 10 weeks to go to 2026-11-15, so the plan loses about 0.21 kg a week.",
  ]);
});

test("saving the targets unchanged keeps them the plan's, and its later suggestions", () => {
  const state = emptyJournal();
  applyGoals(state, athlete, "2026-09-01");
  weigh(state, [
    ["2026-09-24", 87.1],
    ["2026-09-26", 87.1],
  ]);
  const history = state.profile.targetHistory!.length;
  // Food's form saved without a change, and Coach restating a target.
  setDailyTargets(state, { ...state.nutrition.targets }, today);
  const coach = prepareAction(
    state,
    { kind: "set_diet_targets", targets: { calories: 2640 } },
    today,
  ).state;
  for (const s of [state, coach]) {
    assert.equal(targetsInForce(s).source, "plan");
    assert.equal(s.profile.targetHistory!.length, history);
    // A DEXA reading still suggests new targets.
    saveBodyFat(s, { date: today, percent: 27, method: "dexa" }, today);
    assert.ok(targetsProposal(s, today));
  }
});

test("targets saved before records count as the plan's only when they are what it gave", () => {
  const legacy = (targets: State["nutrition"]["targets"]) => {
    const state = emptyJournal();
    state.profile.body = {
      ...athlete,
      activity: "moderate",
      updatedAt: "2026-09-01T10:00:00.000Z",
    };
    state.nutrition.targets = targets;
    return state;
  };
  // Set by hand with Coach: the athlete's own, with no maintenance reason
  // and no suggestion as the weight moves, only at the goal.
  const own = legacy({
    goal: "lose",
    calories: 2500,
    protein: 180,
    carbs: 250,
    fat: 70,
  });
  assert.equal(targetsInForce(own).source, "manual");
  assert.deepEqual(coachingContext(own, today).goals?.targetsSet, {
    source: "manual",
    from: null,
    weightKg: null,
  });
  assert.equal(targetsProposal(own, today), null);
  assert.deepEqual(targetNotes(own, today), [
    "These are your own daily targets; your goals plan's estimate is about 2,640 kcal a day.",
  ]);
  weigh(own, [
    ["2026-09-24", 85.5],
    ["2026-09-26", 85.5],
  ]);
  assert.equal(targetsProposal(own, today), null);
  const there = legacy(own.nutrition.targets);
  weigh(there, [
    ["2026-09-24", 81.4],
    ["2026-09-26", 81.2],
  ]);
  assert.equal(targetsProposal(there, today)?.maintain, true);
  // The old plan's own targets (2,350 kcal) are its, as are those the plan
  // gave from 4 October with its safety limits, here holding his weight:
  // fat a quarter of the calories, carbohydrate the rest.
  for (const targets of [
    { goal: "lose", calories: 2350, protein: 176, carbs: 253, fat: 70 },
    { goal: "maintain", calories: 2830, protein: 158, carbs: 372, fat: 79 },
  ] as const)
    assert.equal(targetsInForce(legacy({ ...targets })).source, "plan");
  // In pregnancy that plan saved none.
  assert.equal(
    targetsInForce(
      legacy({
        goal: "maintain",
        calories: null,
        protein: null,
        carbs: null,
        fat: null,
      }),
    ).source,
    "plan",
  );
});

test("keeping the targets, then the weight coming back, suggests nothing close to them", () => {
  const state = emptyJournal();
  applyGoals(state, holder, "2026-09-01");
  weigh(state, [
    ["2026-09-21", 63],
    ["2026-09-24", 63.2],
    ["2026-09-26", 63.1],
  ]);
  keepCurrentTargets(state, today, targetsProposal(state, today)!.targets);
  // Back to 62.3 kg: the plan holds at 2,290 kcal beside her 2,280.
  const later = "2026-10-10";
  for (const date of ["2026-10-05", "2026-10-08", later])
    saveCheckin(state, { date, bodyweight: 62.3 }, later);
  assert.equal(planForState(state, later)!.calories, 2290);
  assert.equal(targetsProposal(state, later), null);
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

test("a body fat reading keeps the lean mass it measured as the weight falls, so the safer weight stays and is reached", () => {
  // 90 kg at 17 % by DEXA, aiming for 74 kg, below the 74.7 kg lean mass:
  // the plan heads for 81.2 kg instead.
  const start = "2026-09-01";
  const lean = { ...athlete, heightCm: 180, weightKg: 90, targetWeightKg: 74 };
  const state = emptyJournal();
  applyGoals(state, { ...lean, bodyFatPercent: 17, energySigns: false }, start);
  assert.equal(planForState(state, start)!.towardsKg, 81.2);
  assert.equal(planForState(state, start)!.leanMassKg, 74.7);
  assert.equal(planBodyFat(state, start, 90), 17);
  // Weekly weigh-ins, 0.8 kg lower each week, and no new reading. At 84.4
  // kg the goals are saved again at the weight the form fills in, without
  // the reading, which is unchanged.
  for (let week = 1; week <= 11; week++) {
    const date = offsetDate(start, week * 7);
    const kg = Math.round((90 - 0.8 * week) * 10) / 10;
    saveCheckin(state, { date, bodyweight: kg }, date);
    if (week === 7) {
      assert.equal(currentWeightKg(state, date), 84.4);
      applyGoals(state, { ...lean, weightKg: 84.4 }, date);
    }
    const plan = planForState(state, date)!;
    assert.equal(plan.leanMassKg, 74.7, `week ${week}`);
    assert.equal(plan.towardsKg, Math.min(kg, 81.2), `week ${week}`);
    assert.ok(
      plan.safetyNotes.some((n) => /below your lean mass/.test(n)),
      `week ${week}`,
    );
    // No new reading, so no reason about the lean mass.
    assert.ok(
      !(targetsProposal(state, date)?.reasons ?? []).some((r) =>
        /lean mass/.test(r),
      ),
      `week ${week}`,
    );
    // Reached within day-to-day swings of it (maintainBandKg).
    assert.equal(
      plan.reachedGoal,
      kg - 81.2 < maintainBandKg(kg),
      `week ${week}`,
    );
  }
  // Goals saved before records were kept, with a reading given with them
  // and no weigh-ins since, saved again at a new weight: the form's
  // preview, the saved plan and the plan the next day keep the lean mass
  // the reading measured at the weight given then.
  const legacy = emptyJournal();
  legacy.profile.body = {
    ...lean,
    activity: "moderate",
    sessionMinutes: 75,
    experience: "developing",
    updatedAt: "2026-08-20T09:00:00.000Z",
  };
  legacy.health.bodyFat = [
    {
      date: "2026-08-20",
      percent: 17,
      method: null,
      source: "reported",
      updatedAt: "2026-08-20T09:00:00.000Z",
    },
  ];
  const resave = "2026-10-12";
  const preview = planBodyFat(legacy, resave, 87, 87);
  const resaved = applyGoals(legacy, { ...lean, weightKg: 87 }, resave);
  assert.equal(resaved.leanMassKg, 74.7);
  assert.equal(resaved.bodyFatPercent, preview);
  assert.equal(resaved.towardsKg, 81.2);
  assert.equal(planForState(legacy, offsetDate(resave, 1))!.leanMassKg, 74.7);
  // A new reading moves the lean mass. While the weight comes down faster
  // than the plan (0.8 kg a week against its 0.3), the lower target it
  // gives waits (weight-trend.ts); once the weight holds, it is suggested,
  // and says why.
  const later = offsetDate(start, 80);
  saveBodyFat(state, { date: later, percent: 12, method: "dexa" }, later);
  assert.equal(planForState(state, later)!.leanMassKg, 71.5);
  assert.equal(trendAgainstPlan(state, later)?.state, "faster");
  assert.equal(targetsProposal(state, later), null);
  const held = offsetDate(start, 98);
  for (const day of [84, 91, 98])
    saveCheckin(
      state,
      { date: offsetDate(start, day), bodyweight: 81.2 },
      offsetDate(start, day),
    );
  assert.notEqual(trendAgainstPlan(state, held)?.state, "faster");
  assert.equal(planForState(state, held)!.leanMassKg, 71.5);
  assert.match(
    targetsProposal(state, held)!.reasons.join(" "),
    /Your body fat reading of 12% on 2026-11-20 puts your lean mass at about 71\.5 kg, from 74\.7 kg/,
  );
});

test("Coach taking the plan's suggestion leaves the same journal as Today, with its reasons and goals check", () => {
  // Kept to what both paths decide: the targets, where they came from, and
  // the goals check.
  const outcome = (state: State) => ({
    targets: state.nutrition.targets,
    records: state.profile.targetHistory!.map(
      ({ source, from, weightKgAtSet, calories }) => ({
        source,
        from,
        weightKgAtSet,
        calories,
      }),
    ),
    checks: (state.profile.coaching?.plans ?? []).map(
      ({ title, status, followUpDate, outcome }) => ({
        title,
        status,
        followUpDate,
        outcome,
      }),
    ),
  });
  const both = (state: State) => {
    const proposal = targetsProposal(state, today)!;
    const onToday = structuredClone(state);
    takeTargetsProposal(onToday, today, proposal.targets);
    const reviewed = prepareAction(
      state,
      { kind: "set_diet_targets", targets: proposal.targets },
      today,
    );
    assert.deepEqual(outcome(reviewed.state), outcome(onToday));
    return { proposal, reviewed };
  };
  // A DEXA reading that cuts deeper, with a no to the low-energy questions
  // in force: the goals check is agreed, as on Today.
  const answered = emptyJournal();
  applyGoals(answered, { ...athlete, energySigns: false }, "2026-09-01");
  saveBodyFat(answered, { date: today, percent: 26, method: "dexa" }, today);
  const deeper = both(answered);
  assert.equal(
    deeper.reviewed.title,
    "Take your goals plan's suggested targets",
  );
  assert.ok(
    deeper.reviewed.detail.startsWith(
      `Your goals plan's suggested targets, a starting estimate. ${deeper.proposal.reasons[0]}`,
    ),
  );
  assert.match(deeper.reviewed.detail, /from 2026-10-17, about 3 weeks on/);
  assert.equal(deeper.reviewed.plan?.followUpDate, "2026-10-17");
  // At the goal: holding the weight closes the check agreed with the loss.
  const reached = emptyJournal();
  applyGoals(reached, athlete, "2026-08-01");
  followUpGoals(reached, planForState(reached, "2026-08-01")!, "2026-08-01");
  weigh(reached, [
    ["2026-09-24", 81.2],
    ["2026-09-26", 81.4],
  ]);
  const held = both(reached);
  assert.equal(held.proposal.maintain, true);
  assert.match(held.reviewed.detail, /is closed/);
  // A deficit's suggestion with no answers in force waits for them.
  const unanswered = emptyJournal();
  applyGoals(unanswered, athlete, "2026-09-01");
  saveBodyFat(unanswered, { date: today, percent: 26, method: "dexa" }, today);
  assert.throws(
    () =>
      prepareAction(
        unanswered,
        {
          kind: "set_diet_targets",
          targets: targetsProposal(unanswered, today)!.targets,
        },
        today,
      ),
    /Ask them first, then prepare set_body_goals/,
  );
});

test("a weight given in Settings after the goals counts from then, for the plan, the drinks target and burn estimates", () => {
  const state = emptyJournal();
  applyGoals(state, { ...athlete, weightKg: 90 }, "2026-09-01");
  const stamp = "2026-09-01T08:00:00.000Z";
  state.profile.body!.updatedAt = stamp;
  state.profile.targetHistory!.at(-1)!.setAt = stamp;
  const day = "2026-10-10";
  const drinks = hydrationTargetMl(state, day);
  assert.equal(bodyweightKg(state, day), 90);
  // Corrected in Settings on 1 October, with no weigh-ins.
  setSettingsWeight(state, 70, "2026-10-01T08:00:00.000Z");
  assert.equal(state.profile.bodyweight, 70);
  assert.equal(bodyweightKg(state, day), 70);
  assert.equal(currentWeightKg(state, day), 70);
  assert.equal(liveGoals(state, day)!.weightKg, 70);
  assert.ok(hydrationTargetMl(state, day).targetMl < drinks.targetMl);
  // Weigh-ins after it count as usual.
  saveCheckin(state, { date: "2026-10-05", bodyweight: 71 }, "2026-10-05");
  assert.equal(currentWeightKg(state, day), 71);
  // Saving the same weight again keeps when it was given; 0 removes it.
  setSettingsWeight(state, 70, "2026-10-09T08:00:00.000Z");
  assert.equal(state.profile.bodyweightSetAt, "2026-10-01T08:00:00.000Z");
  setSettingsWeight(state, 0);
  assert.equal(state.profile.bodyweightSetAt, undefined);
  assert.equal(currentWeightKg(state, "2026-10-04"), 90);
  // Goals saved again later are the latest word.
  const resaved = structuredClone(state);
  setSettingsWeight(resaved, 70, "2026-10-01T08:00:00.000Z");
  applyGoals(resaved, { ...athlete, weightKg: 84 }, "2026-10-08");
  assert.equal(currentWeightKg(resaved, "2026-10-08"), 84);
  journalSchema.parse(resaved);
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
