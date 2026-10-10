import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyJournal } from "../lib/domain";
import {
  applyGoals,
  ENERGY_CHECK_DAYS,
  planForState,
  type BodyGoals,
} from "../lib/body-goals";
import { prepareAction } from "../lib/agent/actions";
import { actionSchema, actionToolSchema } from "../lib/agent/action-schema";
import { skillsFor } from "../lib/agent/skills";
import {
  coachSuggestion,
  followUpGoals,
  goalsCheckDate,
  GOALS_FOLLOW_UP_DAYS,
  GOALS_FOLLOW_UP_TITLE,
  takeTargetsProposal,
  weeklyOpenings,
} from "../lib/coaching";
import { offsetDate } from "../lib/health";
import { receiptView } from "../lib/native-api";
import { keepCurrentTargets, targetsProposal } from "../lib/target-proposals";

// Typed Coach's goal setup: feet, inches and pounds, the safety notes in
// the review and on the iPhone, and the check of the weight trend about 3
// weeks on.
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

test("typed Coach passes feet, inches and pounds, and the review saves cm and kg", () => {
  const imperial = {
    age: 30,
    sex: "male" as const,
    heightFeet: 5,
    heightInches: 10,
    weightLb: 190,
    targetWeightLb: 180,
    targetDate: null,
    activity: "low" as const,
    trainingDays: 3,
  };
  // Typed Coach's review saves them in cm and kg.
  const action = actionSchema.parse({
    kind: "set_body_goals",
    bodyGoals: imperial,
  });
  assert.ok(action.kind === "set_body_goals");
  assert.equal(action.bodyGoals.heightCm, 177.8);
  const saved = prepareAction(emptyJournal(), action, today).state;
  assert.equal(saved.profile.body?.weightKg, 86.2);
  assert.equal(saved.profile.body?.targetWeightKg, 81.6);
  // The zeros a model fills in for the units it didn't use pass the tool's
  // own check too, as the app ignores them, so no round is lost to them.
  for (const bodyGoals of [
    {
      ...lifter,
      heightFeet: 0,
      heightInches: 0,
      weightLb: 0,
      targetWeightLb: 0,
    },
    { ...imperial, heightCm: 0, weightKg: 0, targetWeightKg: 0 },
  ]) {
    const tool = actionToolSchema.safeParse({
      kind: "set_body_goals",
      bodyGoals,
    });
    assert.ok(tool.success, JSON.stringify(tool.error?.issues));
    const parsed = actionSchema.parse({
      kind: "set_body_goals",
      bodyGoals: tool.data.bodyGoals,
    });
    assert.ok(parsed.kind === "set_body_goals");
    assert.ok([178, 177.8].includes(parsed.bodyGoals.heightCm));
  }
});

test("Coach's review carries the safety notes, and the iPhone receipt shows them in full", () => {
  // A 16-year-old who wants to lose weight: the plan holds it, and says
  // why. The receipt keeps the note in its detail for older builds too.
  const review = prepareAction(
    emptyJournal(),
    {
      kind: "set_body_goals",
      bodyGoals: { ...lifter, age: 16, targetWeightKg: 75 },
    },
    today,
  );
  assert.ok(review.notes?.[0]?.startsWith("Under 18 the plan doesn't set"));
  const receipt = receiptView(
    {
      id: "9c3e3f8e-2a51-4c1e-9d0b-0c1f7c1e2a25",
      title: review.title,
      detail: review.detail,
      targets: review.targets,
      targetsBefore: review.targetsBefore,
      notes: review.notes,
      expiresAt: "2026-10-05T18:00:00.000Z",
    },
    new Date(`${today}T09:00:00Z`),
  );
  assert.deepEqual(receipt.notes, review.notes);
  assert.ok(receipt.detail.includes(review.notes![0]));
});

test("a plan that changes weight agrees a check of the weight trend about 3 weeks on, in the same review", () => {
  const state = emptyJournal();
  const review = prepareAction(
    state,
    { kind: "set_body_goals", bodyGoals: lifter },
    today,
  );
  const due = offsetDate(today, GOALS_FOLLOW_UP_DAYS);
  assert.equal(due, "2026-10-25");
  assert.equal(review.plan?.title, GOALS_FOLLOW_UP_TITLE);
  assert.equal(review.plan?.followUpDate, due);
  assert.match(
    review.plan!.notes,
    /losing about 0\.42 kg a week at 2,720 kcal/,
  );
  assert.match(
    review.detail,
    /These numbers are a starting estimate: from 2026-10-25, about 3 weeks on, Coach can check them against your weight trend with you\.$/,
  );
  const plans = review.state.profile.coaching?.plans ?? [];
  assert.equal(plans.length, 1);
  assert.equal(plans[0].status, "active");
  // The iPhone receipt names it.
  const receipt = receiptView(
    {
      id: "9c3e3f8e-2a51-4c1e-9d0b-0c1f7c1e2a26",
      title: review.title,
      detail: review.detail,
      targets: review.targets,
      plan: review.plan,
      expiresAt: "2026-10-05T18:00:00.000Z",
    },
    new Date(`${today}T09:00:00Z`),
  );
  assert.equal(
    receipt.entries?.[0]?.footnote,
    "Coach checks your weight trend with you from 2026-10-25.",
  );
  // Saving the goals again moves the check on rather than adding one.
  const later = offsetDate(today, 10);
  const again = prepareAction(
    review.state,
    { kind: "set_body_goals", bodyGoals: { ...lifter, weightKg: 83 } },
    later,
  ).state;
  const moved = again.profile.coaching?.plans ?? [];
  assert.equal(moved.length, 1);
  assert.equal(moved[0].id, plans[0].id);
  assert.equal(moved[0].followUpDate, offsetDate(later, GOALS_FOLLOW_UP_DAYS));
  // Holding weight agrees none.
  const holding = prepareAction(
    emptyJournal(),
    { kind: "set_body_goals", bodyGoals: { ...lifter, targetWeightKg: 84 } },
    today,
  );
  assert.equal(holding.plan, undefined);
  assert.equal(holding.state.profile.coaching?.plans, undefined);
  assert.doesNotMatch(holding.detail, /starting estimate/);
  // Beside ten active plans there is no room for another, and the goals
  // still save.
  const busy = emptyJournal();
  busy.profile.coaching = {
    initiative: "gentle",
    focus: "",
    plans: Array.from({ length: 10 }, (_, i) => ({
      id: crypto.randomUUID(),
      title: `Plan ${i}`,
      notes: "",
      followUpDate: today,
      status: "active" as const,
      outcome: "",
      createdAt: `${today}T08:00:00.000Z`,
      updatedAt: `${today}T08:00:00.000Z`,
    })),
  };
  const full = prepareAction(
    busy,
    { kind: "set_body_goals", bodyGoals: lifter },
    today,
  );
  assert.equal(full.plan, undefined);
  assert.equal(full.state.profile.coaching?.plans?.length, 10);
  assert.equal(full.state.nutrition.targets.goal, "lose");
  // When it is due, Coach's opening offers it, with the goals and memory
  // skills loaded, and nothing changes unless the athlete saves it.
  const opening = coachSuggestion(review.state, due);
  assert.equal(opening.title, "Time to check your goals plan");
  assert.match(opening.invitation, /Nothing changes unless you choose/);
  const loaded = skillsFor(opening.prompt);
  assert.ok(loaded.has("goals") && loaded.has("memory"));
  assert.notEqual(
    coachSuggestion(review.state, offsetDate(due, -1)).title,
    opening.title,
  );
  // Never as advice only when asked.
  const quiet = structuredClone(review.state);
  quiet.profile.coaching!.initiative = "on-request";
  assert.notEqual(coachSuggestion(quiet, due).title, opening.title);
});

test("the goals check follows the plan: closed once it no longer changes weight, never offered in pregnancy or after a yes, and moved on with new calories", () => {
  const woman = {
    ...lifter,
    sex: "female" as const,
    heightCm: 165,
    weightKg: 70,
    targetWeightKg: 64,
  };
  const loss = prepareAction(
    emptyJournal(),
    { kind: "set_body_goals", bodyGoals: { ...woman, energySigns: false } },
    today,
  );
  const due = offsetDate(today, GOALS_FOLLOW_UP_DAYS);
  assert.equal(loss.plan?.followUpDate, due);
  assert.equal(
    coachSuggestion(loss.state, due).title,
    "Time to check your goals plan",
  );
  // Ten days on she reports a pregnancy: the same review closes the check,
  // and says so.
  const later = offsetDate(today, 10);
  const pregnant = prepareAction(
    loss.state,
    { kind: "set_body_goals", bodyGoals: { ...woman, pregnancy: "pregnant" } },
    later,
  );
  const [closed] = pregnant.state.profile.coaching?.plans ?? [];
  assert.equal(closed.status, "dismissed");
  assert.match(closed.outcome, /no calorie change to check/);
  assert.equal(pregnant.plan, undefined);
  assert.match(
    pregnant.detail,
    /The check of your weight trend agreed for 2026-10-25 is closed, as this plan has no calorie change to check\.$/,
  );
  assert.doesNotMatch(pregnant.detail, /starting estimate/);
  assert.doesNotMatch(coachSuggestion(pregnant.state, due).id, /^plan-/);
  // A yes to the low-energy questions, or holding the weight, closes it
  // too.
  for (const bodyGoals of [
    { ...woman, energySigns: true },
    { ...woman, targetWeightKg: 70 },
  ]) {
    const held = prepareAction(
      loss.state,
      { kind: "set_body_goals", bodyGoals },
      later,
    );
    assert.equal(held.state.profile.coaching?.plans?.[0]?.status, "dismissed");
  }
  // A check left active by a change made elsewhere isn't offered once it
  // no longer stands, nor as "How did your plan feel?".
  const expecting = structuredClone(loss.state);
  expecting.profile.goalChecks = {
    pregnancy: "pregnant",
    lowWeightConfirmedKg: null,
    updatedAt: new Date().toISOString(),
  };
  const answeredYes = structuredClone(loss.state);
  answeredYes.profile.energyCheck = { date: later, signs: true };
  for (const state of [expecting, answeredYes])
    assert.doesNotMatch(coachSuggestion(state, due).id, /^plan-/);
  // At the check, new calories move it 3 weeks on, so it isn't offered
  // again the next day; before it is due they leave it as it was.
  const moved = prepareAction(
    loss.state,
    { kind: "set_diet_targets", targets: { calories: 1900 } },
    due,
  );
  const next = offsetDate(due, GOALS_FOLLOW_UP_DAYS);
  assert.equal(moved.plan?.followUpDate, next);
  assert.equal(moved.state.profile.coaching?.plans?.length, 1);
  assert.match(
    moved.plan!.notes,
    /Calories set to 1,900 kcal a day on 2026-10-25/,
  );
  assert.match(moved.detail, new RegExp(`from ${next}, about 3 weeks on\\.$`));
  assert.doesNotMatch(
    coachSuggestion(moved.state, offsetDate(due, 1)).id,
    /^plan-/,
  );
  const early = prepareAction(
    loss.state,
    { kind: "set_diet_targets", targets: { calories: 1900 } },
    later,
  );
  assert.equal(early.plan, undefined);
  assert.equal(early.state.profile.coaching?.plans?.[0]?.followUpDate, due);
});

test("goals saved on the website agree the same check, and a deficit asks the low-energy questions again about every 3 months on every surface", () => {
  // The goals form saves with applyGoals and then followUpGoals, as
  // Coach's review does, and its preview names the same date.
  const state = emptyJournal();
  const plan = applyGoals(state, { ...lifter, energySigns: false }, today);
  // Saved on the test's day, whatever the clock says.
  const stamp = `${today}T09:00:00.000Z`;
  state.profile.body!.updatedAt = stamp;
  const due = offsetDate(today, GOALS_FOLLOW_UP_DAYS);
  assert.equal(goalsCheckDate(state, plan, today), due);
  const { agreed } = followUpGoals(state, plan, today);
  assert.equal(agreed?.followUpDate, due);
  assert.equal(agreed?.title, GOALS_FOLLOW_UP_TITLE);
  assert.equal(state.profile.coaching?.plans?.length, 1);
  // With the check done and the no 3 months old, the deficit still saved,
  // Coach offers the questions again: gently, optional, loading the goals
  // skill, and hidden for a week at a time.
  state.profile.coaching!.plans![0].status = "completed";
  const expired = offsetDate(today, ENERGY_CHECK_DAYS);
  const opening = coachSuggestion(state, expired);
  assert.equal(opening.id, "goals-questions");
  assert.match(opening.invitation, /optional/);
  assert.ok(skillsFor(opening.prompt).has("goals"));
  assert.notEqual(
    coachSuggestion(state, offsetDate(expired, -1)).id,
    "goals-questions",
  );
  assert.ok(weeklyOpenings.includes("goals-questions"));
  assert.notEqual(
    coachSuggestion(state, expired, ["goals-questions"]).id,
    "goals-questions",
  );
  const quiet = structuredClone(state);
  quiet.profile.coaching!.initiative = "on-request";
  assert.notEqual(coachSuggestion(quiet, expired).id, "goals-questions");
  // Goals saved without answers, as before the questions existed or with
  // "rather not say", are asked 3 months after they were saved, not at
  // once; at maintenance, or under 18, never.
  const unanswered = emptyJournal();
  applyGoals(unanswered, lifter, today);
  unanswered.profile.body!.updatedAt = stamp;
  assert.equal(planForState(unanswered, today)?.energyCheckDue, true);
  assert.notEqual(coachSuggestion(unanswered, today).id, "goals-questions");
  assert.equal(coachSuggestion(unanswered, expired).id, "goals-questions");
  unanswered.nutrition.targets.calories = planForState(
    unanswered,
    expired,
  )!.maintenanceKcal;
  assert.notEqual(coachSuggestion(unanswered, expired).id, "goals-questions");
  const teen = emptyJournal();
  applyGoals(teen, { ...lifter, age: 16 }, today);
  teen.profile.body!.updatedAt = stamp;
  assert.notEqual(coachSuggestion(teen, expired).id, "goals-questions");
});

test("Coach leaves the low-energy questions to Today's suggestion while it asks them, and taking or keeping it quietens them for 3 months", () => {
  // Goals saved in June with the old plan's deficit (2,350 kcal); on the
  // release day the plan suggests new targets and asks the questions.
  const release = "2026-10-12";
  const legacy = () => {
    const state = emptyJournal();
    state.profile.body = {
      ...lifter,
      age: 34,
      heightCm: 182,
      weightKg: 88,
      trainingDays: 4,
      sessionMinutes: 75,
      experience: "developing",
      updatedAt: "2026-06-01T08:00:00.000Z",
    };
    state.nutrition.targets = {
      goal: "lose",
      calories: 2350,
      protein: 176,
      carbs: 254,
      fat: 70,
    };
    return state;
  };
  const state = legacy();
  const proposal = targetsProposal(state, release)!;
  assert.ok(proposal.energyCheck);
  assert.notEqual(coachSuggestion(state, release).id, "goals-questions");
  // Taken with "rather not say": not asked again the same day, but 3
  // months on, when the copy says the calories are under maintenance.
  takeTargetsProposal(state, release, proposal.targets, null);
  assert.equal(state.profile.energyCheck, undefined);
  // The goals check it agreed comes first, then is done.
  state.profile.coaching!.plans![0].status = "completed";
  assert.equal(planForState(state, release)!.energyCheckDue, true);
  assert.notEqual(coachSuggestion(state, release).id, "goals-questions");
  const later = offsetDate(release, ENERGY_CHECK_DAYS);
  assert.notEqual(
    coachSuggestion(state, offsetDate(later, -1)).id,
    "goals-questions",
  );
  const opening = coachSuggestion(state, later);
  assert.equal(opening.id, "goals-questions");
  assert.match(
    opening.observation,
    /^Your daily calories are set under maintenance/,
  );
  // Kept over, likewise.
  const kept = legacy();
  keepCurrentTargets(kept, release, proposal.targets);
  assert.equal(targetsProposal(kept, release), null);
  assert.notEqual(coachSuggestion(kept, release).id, "goals-questions");
  assert.equal(coachSuggestion(kept, later).id, "goals-questions");
});
