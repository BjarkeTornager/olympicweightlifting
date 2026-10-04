import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyJournal } from "../lib/domain";
import { type BodyGoals } from "../lib/body-goals";
import { prepareAction } from "../lib/agent/actions";
import { actionSchema } from "../lib/agent/action-schema";
import { skillsFor } from "../lib/agent/skills";
import {
  coachSuggestion,
  GOALS_FOLLOW_UP_DAYS,
  GOALS_FOLLOW_UP_TITLE,
} from "../lib/coaching";
import { offsetDate } from "../lib/health";
import { receiptView } from "../lib/native-api";

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
