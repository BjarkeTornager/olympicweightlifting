import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { actionSchema } from "../lib/agent/action-schema";
import { requireCurrentCoach } from "../lib/agent/http";
import { createWorkout, days, emptyJournal } from "../lib/domain";
import {
  applyBodyFatImport,
  applyVitals,
  applyWorkout,
  cardioFromWorkout,
  entryDigest,
  healthSyncSchema,
  type HealthWorkout,
} from "../lib/health-sync";
import { addDrink } from "../lib/hydration";
import { offsetDate } from "../lib/health";
import { journalSchema } from "../lib/model";
import { mealSchema } from "../lib/nutrition";
import {
  actionRequest,
  buildCoach,
  buildJournal,
  buildToday,
  buildTrends,
  flattenVisual,
  nativeAction,
  receiptView,
} from "../lib/native-api";
import { nativeClient } from "../lib/native-client";
import { nativeFixtures } from "../lib/native-fixtures";
import { fixturesPath, openApiPath, openApiText } from "../lib/native-openapi";

const date = "2026-09-26";
const now = new Date("2026-09-26T18:00:00Z");
const tz = "Europe/Copenhagen";
const withClient = (value?: string, extra: Record<string, string> = {}) =>
  new Request("https://example.test/api", {
    headers: { ...(value ? { "X-Client": value } : {}), ...extra },
  });

test("the committed OpenAPI document matches the server's schemas", () => {
  assert.equal(
    readFileSync(openApiPath, "utf8"),
    openApiText(),
    "Run `npm run openapi` and commit the result.",
  );
  for (const [name, value] of Object.entries(nativeFixtures()))
    assert.deepEqual(
      JSON.parse(readFileSync(`${fixturesPath}/${name}`, "utf8")),
      value,
      `${name} is stale. Run \`npm run openapi\`.`,
    );
  const schemas = JSON.parse(openApiText()).components.schemas;
  // Field names are never mistaken for schema keywords.
  assert.ok(schemas.ActionRequest.required.includes("id"));
  assert.ok(schemas.HealthWorkout.required.includes("id"));
});

test("installed builds are recognised and gated by build number, not web headers", () => {
  assert.deepEqual(nativeClient(withClient("ios/0.1/7")), {
    platform: "ios",
    version: "0.1",
    build: 7,
  });
  assert.equal(nativeClient(withClient("ios/0.1")), null);
  assert.equal(nativeClient(withClient("android/0.1/7")), null);
  // A supported build needs none of the website's feature headers.
  assert.doesNotThrow(() => requireCurrentCoach(withClient("ios/0.1/1")));
  assert.throws(() => requireCurrentCoach(withClient()), /Refresh the website/);
  assert.doesNotThrow(() =>
    requireCurrentCoach(
      withClient(undefined, {
        "X-Coach-Journal-Version": "1",
        "X-Training-Programs-Version": "2",
      }),
    ),
  );
});

test("every action the app can send is a valid journal action", () => {
  const examples = [
    { kind: "log_drink", drink: { date, ml: 250, kind: "water" } },
    { kind: "delete_drink", drinkId: crypto.randomUUID() },
    {
      kind: "log_supplement",
      supplement: { date, name: "Vitamin D", amount: "1000 IU" },
    },
    { kind: "log_supplement", supplement: { date, name: "Creatine" } },
    { kind: "delete_supplement", supplementId: crypto.randomUUID() },
    {
      kind: "record_body_fat",
      bodyFat: { date, percent: 14, method: "scale" },
    },
    { kind: "delete_body_fat", date },
    { kind: "record_checkin", checkin: { date, energy: 4, soreness: 2 } },
    { kind: "delete_cardio", cardioId: crypto.randomUUID() },
    { kind: "start_programme", dayId: days[0].id, date },
    {
      kind: "log_sets",
      exerciseId: "snatch",
      sets: [{ weight: 60, reps: 2, result: "success" }],
    },
    { kind: "finish_workout" },
    { kind: "discard_workout" },
    {
      kind: "start_training_day",
      trainingProgramId: crypto.randomUUID(),
      dayId: crypto.randomUUID(),
      date,
    },
    {
      kind: "correct_workout_set",
      workoutId: "w",
      entryId: "e",
      setId: "s",
      setChanges: { reps: 3 },
    },
    {
      kind: "create_training_program",
      trainingProgram: {
        name: "Block",
        days: [
          {
            name: "Day 1",
            exercises: [
              { exerciseId: "snatch", sets: 3, reps: 2, weight: null },
            ],
          },
        ],
      },
    },
    {
      kind: "update_training_program",
      trainingProgramId: crypto.randomUUID(),
      programChanges: {
        name: "Block",
        days: [
          {
            name: "Day 1",
            exercises: [{ exerciseId: "snatch", sets: 3, reps: 2, weight: 60 }],
          },
        ],
      },
    },
    { kind: "delete_training_program", trainingProgramId: crypto.randomUUID() },
  ];
  // "use_programme" is the app's own action, not a Coach action.
  assert.equal(
    new Set(examples.map((e) => e.kind)).size + 1,
    nativeAction.options.length,
  );
  for (const action of examples) {
    // The app omits a missing weight; the server adds the null Coach needs.
    const sent = JSON.parse(
      JSON.stringify(action).replaceAll(',"weight":null', ""),
    );
    actionRequest.parse({
      id: crypto.randomUUID(),
      timezone: tz,
      action: sent,
    });
    assert.doesNotThrow(() => actionSchema.parse(action), action.kind);
  }
  actionRequest.parse({
    id: crypto.randomUUID(),
    timezone: tz,
    action: { kind: "use_programme", programmeId: "stability-power-base-v1" },
  });
});

test("Today and the journal feed describe the day for the app", () => {
  const state = emptyJournal();
  addDrink(state, { date, ml: 500, kind: "water" }, now);
  state.health.vitals = [
    {
      date,
      restingHeartRate: 52,
      heartRateVariabilityMs: 61.4,
      averageHeartRate: 71,
      steps: 9120,
      activeEnergyKcal: 540,
      source: "apple-health",
      updatedAt: now.toISOString(),
    },
  ];
  const run = cardioFromWorkout(workout(), tz, now);
  state.cardio.sessions.push(run);
  state.activeWorkout = createWorkout(state, days[0], date);
  journalSchema.parse(state);
  const today = buildToday(state, 3, date, new Set([run.id]));
  assert.equal(today.hydration.totalMl, 500);
  assert.equal(today.vitals?.restingHeartRate, 52);
  assert.equal(today.activities[0].fromAppleHealth, true);
  assert.equal(today.activities[0].averageHeartRate, 148);
  assert.equal(today.activeWorkout?.title, days[0].title);
  assert.equal(today.nextSession, undefined);
  assert.equal("checkin" in today, false, "absent values are omitted");
  const feed = buildJournal(state, 3, "2026-09-27", 14, new Set([run.id]));
  assert.deepEqual(
    feed.items.map((i) => i.kind),
    ["cardio", "vitals"],
  );
  assert.match(feed.items[0].detail, /10 km · 148 bpm avg/);
  assert.equal(feed.items[0].activity, "running");
  assert.equal(feed.nextBefore, undefined);
  // Each item opens to show everything recorded.
  assert.deepEqual(
    feed.items[0].details!.lines.map((l) => l.label),
    [
      "Duration",
      "Distance",
      "Average heart rate",
      "Maximum heart rate",
      "Energy",
    ],
  );
  assert.deepEqual(
    feed.items[1].details!.lines.map((l) => l.label),
    [
      "Resting heart rate",
      "Heart rate variability",
      "Average heart rate",
      "Steps",
      "Active energy",
    ],
  );
});

test("journal items carry their full details: meals item by item, sleep with its night", () => {
  const state = emptyJournal();
  state.profile.timezone = tz;
  state.nutrition.meals.push(
    mealSchema.parse({
      id: crypto.randomUUID(),
      createdAt: now.toISOString(),
      date,
      type: "lunch",
      name: "Chicken and rice",
      items: [
        {
          name: "Chicken breast",
          portion: "180 g",
          calories: 297,
          protein: 56,
          carbs: 0,
          fat: 6,
        },
        {
          name: "Rice",
          portion: "250 g cooked",
          calories: 325,
          protein: 6,
          carbs: 70,
          fat: 1,
        },
      ],
      source: "text",
      estimated: true,
    }),
  );
  state.health.checkins.push({
    date,
    sleepHours: 7.25,
    energy: 4,
    soreness: 2,
    waterMl: null,
    bodyweight: null,
    notes: "Legs heavy",
    updatedAt: now.toISOString(),
    sleepImport: {
      provider: "apple-health",
      digest: "a".repeat(64),
      start: "2026-09-25T21:40:00Z",
      end: "2026-09-26T05:10:00Z",
      importedAt: now.toISOString(),
    },
  });
  const feed = buildJournal(state, 1, "2026-09-27", 14, new Set());
  const byKind = (kind: string) => feed.items.find((i) => i.kind === kind)!;
  const meal = byKind("meal").details!;
  assert.equal(meal.title, "Lunch: Chicken and rice");
  assert.deepEqual(meal.lines[1], {
    label: "Rice",
    note: "250 g cooked",
    value: "325 kcal · 6 g protein",
  });
  const sleep = byKind("sleep").details!;
  assert.deepEqual(sleep.lines, [
    { label: "Asleep", value: "7 h 15 min" },
    { label: "Night", value: "23:40 to 07:10" },
  ]);
  assert.equal(sleep.footnote, "From Apple Health");
  state.health.checkins[0].sleepImport!.source = "Apple Watch";
  assert.equal(
    buildJournal(state, 1, "2026-09-27", 14, new Set()).items.find(
      (i) => i.kind === "sleep",
    )!.details!.footnote,
    "From Apple Health, Apple Watch",
  );
  const checkin = byKind("checkin").details!;
  assert.deepEqual(
    checkin.lines.map((l) => l.label),
    ["Energy", "Soreness"],
    "sleep has its own item",
  );
  assert.equal(checkin.footnote, "Legs heavy");
});

test("Coach history shows voice turns and each save's state", () => {
  const view = buildCoach(
    [
      {
        id: "a",
        question: "[voice] Logged my run",
        photoIds: [],
        createdAt: now.toISOString(),
        status: "done",
        reply: "Saved.",
        proposals: [
          {
            id: "p1",
            title: "Run",
            detail: "10 km",
            status: "saved",
            expiresAt: now.toISOString(),
          },
          {
            id: "p2",
            title: "Meal",
            detail: "Oats",
            expiresAt: "2026-09-25T00:00:00Z",
          },
        ],
      },
    ],
    now,
  );
  assert.equal(view.turns[0].question, "Logged my run");
  assert.equal(view.turns[0].fromVoice, true);
  assert.deepEqual(
    view.turns[0].receipts.map((r) => r.state),
    ["saved", "expired"],
  );
});

test("a recipe card reaches the app whole, also from a voice call", () => {
  const pictureId = crypto.randomUUID();
  const recipe = {
    kind: "recipe" as const,
    title: "Salmon rice bowl",
    servings: 2,
    minutes: 25,
    ingredients: [
      { item: "Salmon fillet", amount: "250 g" },
      { item: "Sesame seeds" },
    ],
    steps: ["Cook the rice.", "Roast the salmon."],
    nutrition: { kcal: 625, protein: 37 },
    pictureId,
  };
  assert.deepEqual(flattenVisual({ id: "v", content: recipe }), {
    id: "v",
    ...recipe,
  });
  // A card shown in a call is its own turn, with no written reply.
  const view = buildCoach(
    [
      {
        id: "a",
        question: "[voice] A high-protein dinner with salmon",
        photoIds: [],
        createdAt: now.toISOString(),
        status: "done",
        reply: "",
        proposals: [],
        visuals: [{ id: crypto.randomUUID(), content: recipe }],
      },
    ],
    now,
  );
  const [turn] = view.turns;
  assert.equal(turn.fromVoice, true);
  assert.equal(turn.question, "A high-protein dinner with salmon");
  assert.equal(turn.reply, "");
  assert.deepEqual(turn.receipts, []);
  const visual = turn.visuals?.[0];
  assert.equal(visual?.kind, "recipe");
  assert.deepEqual(visual?.ingredients, recipe.ingredients);
  assert.deepEqual(visual?.nutrition, { kcal: 625, protein: 37 });
  assert.equal(visual?.servings, 2);
  assert.equal(visual?.pictureId, pictureId);
});

test("a receipt opens to show what was saved, item by item", () => {
  const meal = mealSchema.parse({
    id: crypto.randomUUID(),
    createdAt: now.toISOString(),
    date,
    type: "breakfast",
    name: "Oats with banana",
    items: [
      {
        name: "Oats",
        portion: "60 g",
        calories: 228,
        protein: 8.1,
        carbs: 40,
        fat: 4,
      },
      {
        name: "Banana",
        portion: "1 medium",
        calories: 105,
        protein: 1.3,
        carbs: 27,
        fat: 0.4,
      },
    ],
    source: "photo",
    estimated: true,
  });
  const single = receiptView(
    {
      id: "m",
      title: "Log your meal",
      detail: "333 kcal",
      workout: null,
      meal,
      status: "saved",
      expiresAt: now.toISOString(),
    },
    now,
  );
  assert.equal(single.entries?.length, 1);
  const entry = single.entries![0];
  assert.equal(entry.title, "Breakfast: Oats with banana");
  assert.match(
    entry.summary!,
    /^333 kcal · 9 g protein · 67 g carbs · 4 g fat$/,
  );
  assert.deepEqual(entry.lines[0], {
    label: "Oats",
    note: "60 g",
    value: "228 kcal · 8 g protein",
  });
  assert.equal(entry.footnote, "Estimated nutrition");

  // A saved batch says what it holds rather than asking to review it.
  const batch = receiptView(
    {
      id: "b",
      title: "Review 2 entries",
      detail: "Check each entry below. Nothing is saved until you confirm.",
      workout: null,
      status: "saved",
      expiresAt: now.toISOString(),
      entries: [
        {
          title: "Log a drink",
          detail: "250 ml coconut water. 1.2 L of about 2.5 L on 2026-09-26.",
          workout: null,
          drink: {
            name: "coconut water",
            ml: 250,
            date,
            dayTotalMl: 1200,
            dayTargetMl: 2500,
          },
        },
        { title: "Log your meal", detail: "", workout: null, meal },
        // Stored before drinks carried their details: shown as written.
        { title: "Log a drink", detail: "330 ml cola.", workout: null },
      ],
    },
    now,
  );
  assert.equal(batch.title, "3 entries saved");
  assert.equal(
    batch.detail,
    "250 ml coconut water, Oats with banana, 330 ml cola",
  );
  assert.deepEqual(
    batch.entries!.map((e) => e.title),
    ["Drink", "Breakfast: Oats with banana", "Log a drink"],
  );
  assert.deepEqual(batch.entries![0].lines, [
    { label: "Coconut water", value: "250 ml" },
  ]);
  assert.match(batch.entries![0].footnote!, /of about 2.5 L that day/);
  assert.equal(batch.entries![2].summary, "330 ml cola.");

  // Targets show the goal label and every target, with what changed.
  const targets = receiptView(
    {
      id: "t",
      title: "Update your daily nutrition targets",
      detail: "These are your chosen daily targets.",
      workout: null,
      expiresAt: now.toISOString(),
      targets: {
        goal: "lose",
        calories: 2400,
        protein: 176,
        carbs: null,
        fat: 70,
      },
      targetsBefore: {
        goal: "maintain",
        calories: 2350,
        protein: 176,
        carbs: 253,
        fat: 70,
      },
    },
    now,
  );
  assert.equal(targets.state, "pending");
  assert.deepEqual(targets.entries![0].lines, [
    { label: "Goal", note: "Was maintain weight", value: "Lose weight" },
    { label: "Energy", note: "Was 2350 kcal", value: "2400 kcal" },
    { label: "Protein", value: "176 g" },
    { label: "Carbs", note: "Was 253 g", value: "No target" },
    { label: "Fat", value: "70 g" },
  ]);
  // One stored before the old values were kept still lists every target.
  const older = receiptView(
    {
      id: "o",
      title: "Update your daily nutrition targets",
      detail: "",
      workout: null,
      status: "saved",
      expiresAt: now.toISOString(),
      targets: {
        goal: "maintain",
        calories: 2200,
        protein: null,
        carbs: null,
        fat: null,
      },
    },
    now,
  );
  assert.deepEqual(
    older.entries![0].lines.map((line) => `${line.label}: ${line.value}`),
    [
      "Goal: Maintain weight",
      "Energy: 2200 kcal",
      "Protein: No target",
      "Carbs: No target",
      "Fat: No target",
    ],
  );

  // A plain note has nothing more to show.
  const plain = receiptView(
    {
      id: "n",
      title: "Note",
      detail: "Hi",
      workout: null,
      expiresAt: now.toISOString(),
    },
    now,
  );
  assert.equal(plain.entries, undefined);
});

function workout(overrides: Partial<HealthWorkout> = {}): HealthWorkout {
  return {
    id: "6f0a3f8e-2a51-4c1e-9d0b-0c1f7c1e2a10",
    kind: "running",
    name: "Outdoor Run",
    start: "2026-09-26T06:30:00+02:00",
    end: "2026-09-26T07:20:00+02:00",
    durationSeconds: 3000,
    distanceKm: 10.0004,
    caloriesKcal: 612.4,
    averageHeartRate: 148,
    maxHeartRate: 171,
    ...overrides,
  };
}

test("Apple Health workouts import once, update until edited, and respect deletion", () => {
  const state = emptyJournal();
  const imported = new Set<string>();
  const first = applyWorkout(state, workout(), undefined, imported, tz, now);
  assert.equal(first.result, "imported");
  assert.equal(state.cardio.sessions.length, 1);
  const entry = state.cardio.sessions[0];
  assert.equal(entry.id, workout().id);
  assert.equal(entry.distanceKm, 10);
  assert.equal(entry.caloriesKcal, 612);
  assert.equal(entry.date, date);
  const receipt = { userId: "u", ...first.receipt! };
  // The same workout again changes nothing.
  assert.equal(
    applyWorkout(state, workout(), receipt, imported, tz, now).result,
    "unchanged",
  );
  // A corrected workout replaces an untouched import.
  const corrected = applyWorkout(
    state,
    workout({ distanceKm: 10.2 }),
    receipt,
    imported,
    tz,
    now,
  );
  assert.equal(corrected.result, "updated");
  assert.equal(state.cardio.sessions[0].distanceKm, 10.2);
  // Once the athlete edits it, their version wins.
  const edited = { userId: "u", ...corrected.receipt! };
  state.cardio.sessions[0] = { ...state.cardio.sessions[0], title: "Easy run" };
  assert.equal(
    applyWorkout(
      state,
      workout({ distanceKm: 10.3 }),
      edited,
      imported,
      tz,
      now,
    ).result,
    "preserved",
  );
  assert.equal(state.cardio.sessions[0].title, "Easy run");
  // Deleted from the journal: a later delivery does not bring it back.
  state.cardio.sessions = [];
  assert.equal(
    applyWorkout(
      state,
      workout({ distanceKm: 10.4 }),
      edited,
      imported,
      tz,
      now,
    ).result,
    "preserved",
  );
  assert.equal(state.cardio.sessions.length, 0);
  assert.equal(entryDigest(cardioFromWorkout(workout(), tz, now)).length, 64);
});

test("a workout already logged by hand is enriched rather than duplicated", () => {
  const state = emptyJournal();
  const manual = cardioFromWorkout(
    workout({
      id: crypto.randomUUID(),
      durationSeconds: 3120,
      averageHeartRate: undefined,
      maxHeartRate: undefined,
      caloriesKcal: undefined,
    }),
    tz,
    now,
  );
  manual.title = "Morning run";
  state.cardio.sessions.push(manual);
  const outcome = applyWorkout(state, workout(), undefined, new Set(), tz, now);
  assert.equal(outcome.result, "matched");
  assert.equal(state.cardio.sessions.length, 1);
  assert.equal(state.cardio.sessions[0].title, "Morning run");
  assert.equal(state.cardio.sessions[0].averageHeartRate, 148);
  assert.equal(state.cardio.sessions[0].caloriesKcal, 612);
});

test("strength workouts on a logged lifting day are skipped; future workouts wait", () => {
  const state = emptyJournal();
  state.sessions.push({ ...createWorkout(state, days[0], date) });
  const strength = workout({
    id: crypto.randomUUID(),
    kind: "strength",
    name: "Traditional Strength Training",
    distanceKm: undefined,
  });
  assert.equal(
    applyWorkout(state, strength, undefined, new Set(), tz, now).result,
    "skipped",
  );
  const tomorrow = workout({
    id: crypto.randomUUID(),
    start: "2026-09-27T06:30:00+02:00",
    end: "2026-09-27T07:20:00+02:00",
  });
  const later = applyWorkout(state, tomorrow, undefined, new Set(), tz, now);
  assert.equal(later.result, "skipped");
  assert.equal(later.receipt, undefined, "retried on the next sync");
  assert.equal(state.cardio.sessions.length, 0);
});

test("daily heart-rate summaries replace the day's previous summary", () => {
  const state = emptyJournal();
  assert.equal(applyVitals(state, { date, restingHeartRate: 54 }, now), true);
  assert.equal(applyVitals(state, { date, restingHeartRate: 54 }, now), false);
  assert.equal(
    applyVitals(state, { date, restingHeartRate: 53, steps: 8000 }, now),
    true,
  );
  assert.equal(applyVitals(state, { date: "2026-09-25" }, now), false);
  assert.equal(state.health.vitals?.length, 1);
  assert.equal(state.health.vitals?.[0].restingHeartRate, 53);
  journalSchema.parse(state);
  assert.throws(() =>
    healthSyncSchema.parse({ timezone: tz, days: [{ date, extra: 1 }] }),
  );
});

test("trends give one row per day, oldest first, with gaps left empty", () => {
  const state = emptyJournal();
  applyVitals(state, { date, restingHeartRate: 51, steps: 9000 }, now);
  addDrink(state, { date: "2026-09-25", ml: 750, kind: "water" }, now);
  state.cardio.sessions.push(cardioFromWorkout(workout(), tz, now));
  const trends = buildTrends(state, date, 3);
  assert.deepEqual(
    trends.days.map((d) => d.date),
    ["2026-09-24", "2026-09-25", "2026-09-26"],
  );
  assert.equal(trends.days[0].restingHeartRate, undefined);
  assert.equal(trends.days[1].waterMl, 750);
  assert.equal(trends.days[2].restingHeartRate, 51);
  assert.equal(trends.days[2].cardioMinutes, 50);
  assert.equal(trends.days[2].waterMl, undefined, "no drinks is not 0 ml");
});

test("Coach's view of the day includes Apple Health heart rate and workout details", async () => {
  const { dayForCoach, describeDay } = await import("../lib/journal-summary");
  const { dailyHealth } = await import("../lib/health");
  const state = emptyJournal();
  applyVitals(
    state,
    { date, restingHeartRate: 52, heartRateVariabilityMs: 61.4, steps: 9120 },
    now,
  );
  state.cardio.sessions.push(cardioFromWorkout(workout(), tz, now));
  const day = dayForCoach(state, date);
  assert.equal(day.heart_and_movement[0].resting_heart_rate, 52);
  assert.equal(day.heart_and_movement[0].source, "Apple Health");
  assert.equal(day.activities[0].average_heart_rate, 148);
  assert.equal(day.activities[0].title, "Outdoor Run");
  const sentence = describeDay(day);
  assert.match(sentence, /Outdoor Run, 50 min, 10 km, 148 bpm average/);
  assert.match(
    sentence,
    /From Apple Health: resting heart rate 52 bpm, HRV 61 ms, 9,120 steps/,
  );
  assert.equal(dailyHealth(state, date).vitals?.restingHeartRate, 52);
});

test("Train shows each main lift's best made set and eight weeks of work", async () => {
  const { personalBests, trainingWeeks } =
    await import("../lib/native-training");
  const state = emptyJournal();
  const session = (on: string, sets: [string, number, number, string][]) => {
    const w = createWorkout(state, undefined, on);
    w.exercises = sets.map(([exerciseId, weight, reps, result], i) => ({
      id: `e${on}${i}`,
      exerciseId,
      athleteNotes: "",
      sets: [{ id: `s${on}${i}`, weight, reps, result }],
    })) as unknown as typeof w.exercises;
    state.sessions.push(w);
  };
  session("2026-09-01", [
    ["snatch", 70, 2, "success"],
    ["back_squat", 140, 5, "success"],
  ]);
  session("2026-09-15", [
    ["snatch", 72, 1, "success"],
    ["snatch", 75, 1, "miss"],
  ]);
  session("2026-09-22", [["snatch", 72, 1, "success"]]);
  state.prs.clean_and_jerk = 100;

  const bests = personalBests(state);
  assert.deepEqual(
    bests.map((b) => [b.exerciseId, b.weight, b.date]),
    [
      ["snatch", 72, "2026-09-15"],
      ["clean_and_jerk", 100, undefined],
      ["back_squat", 140, "2026-09-01"],
    ],
    "a missed set isn't a best, a tie keeps the first date, a best entered by hand counts",
  );

  const weeks = trainingWeeks(state, date);
  assert.equal(weeks.length, 8);
  assert.equal(weeks[7].start, "2026-09-21", "weeks start on Monday");
  assert.deepEqual(
    weeks.slice(4).map((w) => [w.sessions, w.sets, w.tonnageKg]),
    [
      [1, 2, 840],
      [0, 0, 0],
      [1, 2, 72],
      [1, 1, 72],
    ],
  );
});

test("Today suggests a programme session only to someone who follows one", () => {
  const date = "2026-09-20";
  const state = emptyJournal();
  assert.equal(buildToday(state, 1, date, new Set()).nextSession, undefined);
  // The first day of the built-in plan, trained and logged.
  const first = days.find((d) => d.weekday !== null)!;
  const session = createWorkout(state, first, "2026-09-15");
  session.exercises[0].sets[0] = {
    ...session.exercises[0].sets[0],
    weight: 40,
    reps: 3,
    logged: true,
    result: "success",
  };
  state.sessions.push(session);
  assert.equal(buildToday(state, 2, date, new Set()).nextSession?.position, 2);
});

test("Today names the day the journal began, which the issue number counts from", () => {
  const state = emptyJournal();
  // Created at half past midnight on 3 October, Copenhagen time.
  state.createdAt = "2026-10-02T22:30:00.000Z";
  const date = "2026-10-03";
  const imported = new Set<string>();
  const start = (timezone?: string) =>
    buildToday(state, 1, date, imported, new Map(), timezone).journalStartDate;
  // An empty journal began the day it was created, on the athlete's clock.
  assert.equal(start("Europe/Copenhagen"), date);
  assert.equal(start("America/New_York"), "2026-10-02");
  // Without a time zone from the iPhone, the profile's, then Copenhagen's.
  assert.equal(start(), date);
  assert.equal(start("Somewhere/Else"), date);
  state.profile.timezone = "America/New_York";
  assert.equal(start(), "2026-10-02");
  state.profile.timezone = undefined;
  // Apple Health's first sync fills in the steps, sleep and body fat of the
  // two weeks before, and the workouts of the two months before; none of it
  // is when the journal began.
  assert.equal(
    applyVitals(state, { date: "2026-09-20", steps: 4200 }, now),
    true,
  );
  const run = cardioFromWorkout(
    workout({
      start: "2026-08-04T06:30:00+02:00",
      end: "2026-08-04T07:20:00+02:00",
    }),
    tz,
    now,
  );
  state.cardio.sessions.push(run);
  imported.add(run.id);
  state.health.checkins.push({
    date: "2026-09-30",
    sleepHours: 7.5,
    energy: null,
    soreness: null,
    waterMl: null,
    bodyweight: null,
    notes: "",
    updatedAt: now.toISOString(),
    sleepImport: {
      provider: "apple-health",
      digest: "0".repeat(64),
      start: "2026-09-29T21:10:00.000Z",
      end: "2026-09-30T04:40:00.000Z",
      importedAt: now.toISOString(),
    },
  });
  assert.equal(
    applyBodyFatImport(
      state,
      { date: "2026-09-25", bodyFatPercent: 18.2 },
      date,
      now,
    ),
    true,
  );
  assert.equal(start(), date);
  // A later record changes nothing; one logged by hand for an earlier day,
  // from a backup brought in, say, is where the journal began.
  addDrink(state, { date: "2026-10-04", ml: 250, kind: "water" }, now);
  assert.equal(start(), date);
  state.sessions.push(createWorkout(state, days[0], "2026-09-12"));
  assert.equal(start(), "2026-09-12");
  // A date that can't be read is left out rather than failing Today.
  state.health.checkins.push({
    date: "someday",
    sleepHours: null,
    energy: 4,
    soreness: null,
    waterMl: null,
    bodyweight: null,
    notes: "",
    updatedAt: now.toISOString(),
  });
  assert.equal(start(), "2026-09-12");
});

test("Today carries Coach's note on short sleep, from five nights, unless advice is only on request", () => {
  const state = emptyJournal();
  const night = (offset: number, sleepHours: number) =>
    state.health.checkins.push({
      date: offsetDate(date, -offset),
      sleepHours,
      energy: null,
      soreness: null,
      waterMl: null,
      bodyweight: null,
      notes: "",
      updatedAt: now.toISOString(),
    });
  for (const offset of [0, 1, 2, 3]) night(offset, 6.25);
  let today = buildToday(state, 1, date, new Set());
  assert.equal(today.sleepNote, undefined);
  assert.equal(today.sleep.averageHours, undefined, "four nights");
  assert.equal(today.sleep.nights, 4);
  night(5, 6.25);
  today = buildToday(state, 2, date, new Set());
  assert.equal(today.sleep.averageHours, 6.25);
  assert.equal(today.sleepNote?.id, "sleep-short");
  assert.match(today.sleepNote!.observation, /average 6 h 15 min/);
  assert.match(today.sleepNote!.prompt, /more time asleep/);
  state.profile.coaching = { initiative: "on-request", focus: "" };
  assert.equal(buildToday(state, 3, date, new Set()).sleepNote, undefined);
  state.profile.coaching.initiative = "gentle";
  for (const c of state.health.checkins) c.sleepHours = 8;
  assert.equal(buildToday(state, 4, date, new Set()).sleepNote, undefined);
});

test("A new journal's first steps show until all are done, for two weeks", () => {
  const state = emptyJournal();
  state.createdAt = "2026-10-01T09:00:00.000Z";
  const date = "2026-10-02";
  assert.deepEqual(buildToday(state, 1, date, new Set()).firstSteps, {
    appleHealth: false,
    meal: false,
    goals: false,
  });
  state.health.vitals = [
    {
      date,
      restingHeartRate: null,
      heartRateVariabilityMs: null,
      averageHeartRate: null,
      steps: 4200,
      activeEnergyKcal: null,
      source: "apple-health",
      updatedAt: `${date}T08:00:00.000Z`,
    },
  ];
  state.nutrition.meals.push(
    mealSchema.parse({
      id: crypto.randomUUID(),
      date,
      type: "breakfast",
      name: "Porridge",
      items: [
        {
          name: "Oats",
          portion: "60 g",
          calories: 230,
          protein: 8,
          carbs: 40,
          fat: 4,
        },
      ],
      source: "photo",
      estimated: true,
      createdAt: `${date}T07:00:00.000Z`,
    }),
  );
  assert.deepEqual(buildToday(state, 2, date, new Set()).firstSteps, {
    appleHealth: true,
    meal: true,
    goals: false,
  });
  // Older journals don't get them.
  assert.equal(
    buildToday(state, 2, "2026-10-15", new Set()).firstSteps,
    undefined,
  );
  // A target of 0 is no target, so goals are still to set.
  state.nutrition.targets.calories = 0;
  assert.equal(buildToday(state, 3, date, new Set()).firstSteps?.goals, false);
  state.nutrition.targets.calories = 2200;
  assert.equal(buildToday(state, 3, date, new Set()).firstSteps, undefined);
});

test("a target of 0 reaches the app as no target, for Today, Account and Trends", () => {
  const state = emptyJournal();
  const date = "2026-09-26";
  state.nutrition.targets = {
    goal: "maintain",
    calories: 0,
    protein: 0,
    carbs: null,
    fat: null,
  };
  const today = buildToday(state, 1, date, new Set());
  assert.equal(today.nutrition.targetCalories, undefined);
  assert.equal(today.nutrition.targetProtein, undefined);
  const trends = buildTrends(state, date, 3);
  assert.equal(trends.targetCalories, undefined);
  assert.equal(trends.targetProtein, undefined);
  state.nutrition.targets.calories = 1900;
  assert.equal(
    buildToday(state, 2, date, new Set()).nutrition.targetCalories,
    1900,
  );
  assert.equal(buildTrends(state, date, 3).targetCalories, 1900);
  // A receipt shows a 0 target as no target, and clearing one to 0 changes
  // nothing it shows.
  const receipt = receiptView(
    {
      id: "z",
      title: "Update your daily nutrition targets",
      detail: "",
      workout: null,
      expiresAt: "2026-09-27T18:00:00.000Z",
      targets: { ...state.nutrition.targets, protein: 0 },
      targetsBefore: { ...state.nutrition.targets, protein: null },
    },
    new Date("2026-09-26T18:00:00Z"),
  );
  assert.deepEqual(receipt.entries![0].lines[2], {
    label: "Protein",
    value: "No target",
  });
});
