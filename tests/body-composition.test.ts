import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyJournal } from "../lib/domain";
import {
  applyGoals,
  planForState,
  planGoals,
  type BodyGoalsInput,
} from "../lib/body-goals";
import {
  bodyFatByDate,
  bodyFatTrend,
  saveBodyFat,
  weightTrend,
} from "../lib/body-composition";
import { prepareAction } from "../lib/agent/actions";
import { systemPrompt } from "../lib/agent/knowledge";
import { applyBodyFatImport } from "../lib/health-sync";
import { dayForCoach, describeDay } from "../lib/journal-summary";
import { coachingContext } from "../lib/coaching";
import { dailyHealth, saveCheckin } from "../lib/health";
import { journalSchema } from "../lib/model";
import { buildJournal, buildToday, buildTrends } from "../lib/native-api";
import { voiceAction, voiceToolArgs } from "../lib/voice-actions";

const today = "2026-09-26";
const athlete: BodyGoalsInput = {
  age: 34,
  sex: "male",
  heightCm: 182,
  weightKg: 87.6,
  targetWeightKg: 85,
  targetDate: null,
  activity: "moderate",
  trainingDays: 4,
  sessionMinutes: 75,
  experience: "developing",
};

test("with body fat known, energy and protein come from lean mass", () => {
  const plan = planGoals(athlete, today, { bodyFatPercent: 14 });
  // 87.6 kg at 14 % is 75.3 kg lean; Katch–McArdle 370 + 21.6 × 75.3.
  assert.equal(plan.leanMassKg, 75.3);
  assert.equal(plan.restingKcal, 2000);
  assert.equal(plan.focus, "lose_fat");
  // 2.5 g per kg of lean mass while losing fat.
  assert.equal(plan.protein, 188);
  assert.equal(plan.weeklyChangeKg, 0.44);
  // Without body fat the plan is the same as before.
  const plain = planGoals(athlete, today);
  assert.equal(plain.leanMassKg, null);
  assert.equal(plain.protein, 175);
});

test("rates follow body fat and experience; recomposition stays gentle", () => {
  // Already lean: slower loss, with a note.
  const lean = planGoals(athlete, today, { bodyFatPercent: 11 });
  assert.equal(lean.weeklyChangeKg, 0.35);
  assert.ok(lean.notes.some((n) => /already lean/.test(n)));
  // More to lose: up to 0.75 % a week.
  const more = planGoals({ ...athlete, targetWeightKg: 75 }, today, {
    bodyFatPercent: 28,
  });
  assert.equal(more.weeklyChangeKg, 0.66);
  // Muscle comes more slowly with experience.
  const gain = (experience: BodyGoalsInput["experience"]) =>
    planGoals({ ...athlete, targetWeightKg: 92, experience }, today)
      .weeklyChangeKg;
  assert.deepEqual(
    [gain("new"), gain("developing"), gain("experienced")],
    [0.31, 0.22, 0.13],
  );
  // Recomposition at a steady weight: a small deficit, high protein.
  const recomp = planGoals({ ...athlete, targetWeightKg: 87.6 }, today, {
    focus: "recomposition",
    bodyFatPercent: 14,
  });
  assert.equal(recomp.direction, "maintain");
  assert.equal(
    recomp.calories,
    Math.round((recomp.maintenanceKcal * 0.95) / 10) * 10,
  );
  assert.equal(recomp.protein, 188);
  // Recomposition towards a lower weight caps the loss at 0.25 % a week.
  const slow = planGoals(athlete, today, { focus: "recomposition" });
  assert.equal(slow.weeklyChangeKg, 0.22);
});

test("body fat targets are checked against lean mass and healthy limits", () => {
  const target = planGoals(athlete, today, {
    bodyFatPercent: 14,
    targetBodyFatPercent: 10,
  });
  // 75.3 kg lean at 10 % is 83.7 kg, not the 85 kg goal.
  assert.equal(target.weightAtTargetBodyFatKg, 83.7);
  assert.ok(target.notes.some((n) => /83\.7 kg, not 85 kg/.test(n)));
  const veryLean = planGoals(athlete, today, { targetBodyFatPercent: 7 });
  assert.ok(veryLean.notes.some((n) => /very lean/.test(n)));
  const unsafe = planGoals(athlete, today, { targetBodyFatPercent: 4 });
  assert.ok(unsafe.notes.some((n) => /essential fat/.test(n)));
});

test("goals with body fat save a reading, a focus and a target beside profile.body", () => {
  const state = emptyJournal();
  const prepared = prepareAction(
    state,
    {
      kind: "set_body_goals",
      bodyGoals: {
        ...athlete,
        focus: "recomposition",
        bodyFatPercent: 14,
        targetBodyFatPercent: 11,
      },
    },
    today,
  );
  const next = prepared.state;
  // profile.body keeps its strict shape for older clients.
  assert.deepEqual(
    Object.keys(next.profile.body!).sort(),
    [...Object.keys(athlete), "updatedAt"].sort(),
  );
  assert.equal(next.profile.bodyTargets?.focus, "recomposition");
  assert.equal(next.profile.bodyTargets?.targetBodyFatPercent, 11);
  assert.deepEqual(
    next.health.bodyFat?.map((b) => [b.date, b.percent, b.source]),
    [[today, 14, "reported"]],
  );
  assert.match(
    prepared.detail,
    /14% body fat, about 75\.3 kg lean mass, towards 11%/,
  );
  assert.equal(planForState(next, today)?.leanMassKg, 75.3);
  // Journals with body fat still parse, and one reading per date and source.
  journalSchema.parse(next);
  const twice = structuredClone(next);
  twice.health.bodyFat!.push({ ...twice.health.bodyFat![0]! });
  assert.throws(() => journalSchema.parse(twice), /one body fat reading/);
  // Saving goals again without a focus keeps the one chosen.
  applyGoals(next, athlete, today);
  assert.equal(next.profile.bodyTargets?.focus, "recomposition");
});

test("body fat readings: log, replace, remove; a scale reading is kept apart", () => {
  const state = emptyJournal();
  const logged = prepareAction(
    state,
    {
      kind: "record_body_fat",
      bodyFat: { date: "2026-09-20", percent: 15.2, method: "scale" },
    },
    today,
  );
  assert.equal(logged.title, "Record body fat");
  const later = prepareAction(
    logged.state,
    { kind: "record_body_fat", bodyFat: { date: today, percent: 14 } },
    today,
  );
  assert.match(
    later.detail,
    /14% body fat on 2026-09-26\. -1\.2 points since 2026-09-20/,
  );
  refusesFutureDates(later.state);
  // The same day again replaces the reading.
  const replaced = prepareAction(
    later.state,
    { kind: "record_body_fat", bodyFat: { date: today, percent: 13.8 } },
    today,
  ).state;
  assert.deepEqual(
    replaced.health.bodyFat?.map((b) => b.percent),
    [15.2, 13.8],
  );
  // A scale reading the same day is kept, but the athlete's report wins.
  applyBodyFatImport(
    replaced,
    { date: today, bodyFatPercent: 16.04 },
    today,
    new Date(),
  );
  assert.equal(replaced.health.bodyFat?.length, 3);
  assert.equal(bodyFatByDate(replaced, today, today)[0]?.percent, 13.8);
  assert.equal(
    applyBodyFatImport(
      replaced,
      { date: today, bodyFatPercent: 16 },
      today,
      new Date(),
    ),
    false,
  );
  // Removing takes only the athlete's own reading.
  const removed = prepareAction(
    replaced,
    { kind: "delete_body_fat", date: today },
    today,
  ).state;
  assert.equal(bodyFatByDate(removed, today, today)[0]?.source, "apple-health");
  assert.throws(
    () =>
      prepareAction(removed, { kind: "delete_body_fat", date: today }, today),
    /No body fat reading you entered/,
  );
});

function refusesFutureDates(state: ReturnType<typeof emptyJournal>) {
  assert.throws(
    () => saveBodyFat(state, { date: "2026-09-27", percent: 14 }, today),
    /future/,
  );
}

test("Coach and the voice coach see body fat, weight trend and goals", () => {
  const state = emptyJournal();
  applyGoals(
    state,
    { ...athlete, focus: "lose_fat", bodyFatPercent: 14.5 },
    "2026-08-29",
  );
  for (const [date, kg] of [
    ["2026-08-29", 88.4],
    ["2026-09-12", 87.9],
    ["2026-09-26", 87.6],
  ] as const)
    saveCheckin(state, { date, bodyweight: kg }, today);
  saveBodyFat(state, { date: today, percent: 14, method: "scale" }, today);

  const day = dayForCoach(state, today);
  assert.deepEqual(day.body_fat, [
    { date: today, percent: 14, method: "scale", source: "reported" },
  ]);
  assert.match(
    describeDay(day),
    /Bodyweight: 87\.6 kg\. Body fat: 14% \(scale\)/,
  );

  const health = dailyHealth(state, today);
  assert.deepEqual(health.weightTrend, {
    weigh_ins: 3,
    first: { date: "2026-08-29", kg: 88.4 },
    latest: { date: today, kg: 87.6 },
    kg_per_week: -0.2,
  });
  assert.equal(health.bodyFat.latest?.percent, 14);
  assert.equal(health.bodyFat.trend?.change_points, -0.5);
  assert.equal(health.bodyFat.trend?.latest.lean_kg, 75.3);

  const context = coachingContext(state, today);
  assert.equal(context.goals?.focus, "lose_fat");
  assert.equal(context.goals?.plan?.bodyFatPercent, 14);
  assert.equal(context.bodyComposition?.weightTrend?.kg_per_week, -0.2);

  // Coach's instructions name the whole role and the limits.
  const prompt = systemPrompt(today, "Europe/Copenhagen");
  assert.match(
    prompt,
    /fat-loss and muscle-building coach and nutrition guide/,
  );
  assert.match(prompt, /not a registered dietitian or a doctor/);
  assert.match(prompt, /record_body_fat/);
  assert.match(prompt, /Don't judge body fat from photos/);
  assert.match(
    prompt,
    /suggest professional support instead of a stricter plan/,
  );
});

test("the voice coach logs body fat and tolerates empty optional goal values", () => {
  const state = emptyJournal();
  assert.deepEqual(
    voiceAction(
      "log_body_fat",
      { summary: "Body fat 14%", date: today, percent: 14, method: "" },
      state,
      today,
    ),
    {
      kind: "record_body_fat",
      bodyFat: { date: today, percent: 14, method: null },
    },
  );
  const goals = voiceToolArgs.set_goals.parse({
    ...athlete,
    summary: "Goals",
    targetDate: "",
    focus: "",
    bodyFatPercent: 0,
    targetBodyFatPercent: 0,
  });
  assert.equal(goals.focus, undefined);
  assert.equal(goals.bodyFatPercent, undefined);
  const action = voiceAction(
    "set_goals",
    { ...athlete, summary: "Goals", focus: "build_muscle", bodyFatPercent: 16 },
    state,
    today,
  );
  assert.equal(action.kind, "set_body_goals");
  assert.ok(
    action.kind === "set_body_goals" &&
      action.bodyGoals.focus === "build_muscle" &&
      action.bodyGoals.bodyFatPercent === 16,
  );
});

test("the iPhone app shows body composition on Today, Journal and trends", () => {
  const state = emptyJournal();
  applyGoals(
    state,
    { ...athlete, focus: "recomposition", targetBodyFatPercent: 11 },
    today,
  );
  saveCheckin(state, { date: "2026-09-19", bodyweight: 88 }, today);
  saveCheckin(state, { date: today, bodyweight: 87.6 }, today);
  applyBodyFatImport(
    state,
    { date: today, bodyFatPercent: 14 },
    today,
    new Date(),
  );

  const body = buildToday(state, 1, today, new Set()).body;
  assert.deepEqual(body, {
    bodyFatPercent: 14,
    bodyFatDate: today,
    bodyFatMethod: "scale",
    bodyFatFromAppleHealth: true,
    bodyweight: 87.6,
    bodyweightDate: today,
    weeklyWeightChangeKg: -0.4,
    leanMassKg: 75.3,
    focus: "recomposition",
    targetWeightKg: 85,
    targetBodyFatPercent: 11,
  });
  const journal = buildJournal(state, 1, "2026-09-27", 14, new Set());
  assert.deepEqual(
    journal.items
      .filter((i) => i.kind === "body")
      .map((i) => [i.title, i.detail, i.fromAppleHealth]),
    [["Body fat", "14% · scale", true]],
  );
  const trends = buildTrends(state, today, 14);
  const last = trends.days.at(-1)!;
  assert.equal(last.bodyweight, 87.6);
  assert.equal(last.bodyFatPercent, 14);
  // Nothing recorded: Today has no body summary beyond the goal.
  assert.equal(buildToday(emptyJournal(), 1, today, new Set()).body, undefined);
  assert.equal(bodyFatTrend(emptyJournal(), "2026-01-01", today), null);
  assert.equal(weightTrend(emptyJournal(), today), null);
});
