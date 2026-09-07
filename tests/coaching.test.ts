import { test } from "node:test";
import assert from "node:assert/strict";
import { backup, emptyJournal, parseLegacyBackup } from "../lib/domain";
import { journalSchema } from "../lib/model";
import { coachSuggestion, coachingContext } from "../lib/coaching";
import { offsetDate, saveCheckin } from "../lib/health";
import { prepareAction } from "../lib/agent/actions";
import { mealSchema } from "../lib/nutrition";

const date = "2026-09-06";

test("dinner ideas use the meal tag and date without assuming intake, ingredients or preferences", () => {
  const state = emptyJournal();
  const meal = (type: string, day: string) =>
    mealSchema.parse({
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      date: day,
      name: "A logged meal",
      type,
      source: "text",
      estimated: true,
      notes: "",
      items: [
        {
          name: "Rice and vegetables",
          portion: "One bowl",
          calories: 400,
          protein: 8,
          carbs: 80,
          fat: 5,
        },
      ],
      photoIds: [],
    });
  state.nutrition.meals = [
    meal("dinner", date),
    meal("lunch", date),
    meal("dinner", offsetDate(date, -7)),
    meal("dinner", offsetDate(date, 1)),
  ];
  assert.equal(coachSuggestion(state, date).id, "get-to-know-you");
  state.nutrition.meals.push(meal("dinner", offsetDate(date, -6)));
  const suggestion = coachSuggestion(state, date);
  assert.equal(suggestion.id, "dinner-ideas");
  assert.match(suggestion.observation, /2 dinners/);
  assert.doesNotMatch(
    suggestion.observation,
    /calories|enjoyed|rice|vegetarian/i,
  );
});

test("opening coaching never invents a gap, target or current recovery state", () => {
  const state = emptyJournal();
  const original = structuredClone(state);
  assert.equal(coachSuggestion(state, date).id, "get-to-know-you");
  assert.deepEqual(state, original);
  saveCheckin(
    state,
    { date: offsetDate(date, -1), energy: 1, soreness: 5 },
    date,
  );
  assert.equal(coachSuggestion(state, date).id, "get-to-know-you");
  saveCheckin(state, { date, energy: 2 }, date);
  const suggestion = coachSuggestion(state, date);
  assert.equal(suggestion.id, "recovery");
  assert.match(suggestion.observation, /energy at 2\/5 today/);
  assert.doesNotMatch(suggestion.observation, /soreness/);
});

test("sleep observations require three consecutive recent nights and a separate logged baseline", () => {
  const state = emptyJournal();
  for (const offset of [-9, -8, -6, -3])
    saveCheckin(state, { date: offsetDate(date, offset), sleepHours: 8 }, date);
  for (const offset of [-2, 0])
    saveCheckin(
      state,
      { date: offsetDate(date, offset), sleepHours: 6.5 },
      date,
    );
  assert.equal(
    coachSuggestion(state, date).id,
    "get-to-know-you",
    "missing night is not zero",
  );
  saveCheckin(state, { date: offsetDate(date, -1), sleepHours: 6.5 }, date);
  const suggestion = coachSuggestion(state, date);
  assert.equal(suggestion.id, "sleep-change");
  assert.match(suggestion.observation, /6 h 30 min/);
  assert.match(suggestion.observation, /across 4 logged nights/);
  assert.equal(
    coachSuggestion(state, offsetDate(date, 1)).id,
    "get-to-know-you",
    "stale nights cannot become a fresh trend",
  );
  saveCheckin(state, { date, energy: 1 }, date);
  assert.equal(
    coachSuggestion(state, date).id,
    "recovery",
    "current self-report takes precedence",
  );
});

test("training follow-up includes cardio, uses the latest date and expires", () => {
  const prepared = prepareAction(
    emptyJournal(),
    {
      kind: "record_cardio",
      cardio: { activity: "running", date, durationSeconds: 1800 },
    },
    date,
  );
  const state = prepared.state;
  assert.equal(coachSuggestion(state, date).id, "training-follow-up");
  assert.match(coachSuggestion(state, date).observation, /today/);
  assert.match(
    coachSuggestion(state, offsetDate(date, 1)).observation,
    /2026-09-06/,
  );
  assert.equal(
    coachSuggestion(state, offsetDate(date, 3)).id,
    "get-to-know-you",
  );
  assert.equal(
    coachSuggestion(state, offsetDate(date, -1)).id,
    "get-to-know-you",
    "future records are not completed today",
  );
});

test("coaching preferences survive backups without changing legacy journals and gate unsolicited context", () => {
  const state = emptyJournal();
  assert.equal(
    Object.hasOwn(journalSchema.parse(state).profile, "coaching"),
    false,
  );
  state.profile.coaching = {
    initiative: "on-request",
    focus: "More energy for family life",
  };
  saveCheckin(state, { date, energy: 1 }, date);
  const restored = parseLegacyBackup(backup(state));
  assert.deepEqual(restored.profile.coaching, state.profile.coaching);
  assert.deepEqual(coachingContext(restored, date), {
    preferences: state.profile.coaching,
    approvedMemories: [],
    agreedPlans: [],
    startingPoint: null,
  });
  state.profile.coaching = {
    initiative: "gentle",
    focus: "Keep evenings relaxed",
  };
  assert.match(
    coachingContext(state, date).startingPoint!.observation,
    /energy at 1\/5/,
  );
  for (const coaching of [
    { initiative: "always", focus: "" },
    { initiative: "gentle", focus: "x".repeat(301) },
  ]) {
    assert.equal(
      journalSchema.safeParse({
        ...state,
        profile: { ...state.profile, coaching },
      }).success,
      false,
    );
  }
});
