import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptyJournal,
  backup,
  parseLegacyBackup,
  mergeImport,
} from "../lib/domain";
import { prepareAction, actionSchema } from "../lib/agent/actions";
import {
  coachingContext,
  coachSettings,
  coachSuggestion,
} from "../lib/coaching";
import {
  foodSnapshotForClient,
  coachStateForUndo,
} from "../lib/food-compatibility";
import { mealSchema, favouriteFromMeal } from "../lib/nutrition";
import { saveCheckin, offsetDate } from "../lib/health";
import { weeklyReview } from "../lib/weekly-review";

const date = "2026-09-07";
const meal = (day = date, calories = 500) =>
  mealSchema.parse({
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    date: day,
    name: "Rice bowl",
    type: "lunch",
    source: "manual",
    estimated: true,
    items: [
      {
        name: "Rice",
        portion: "One bowl",
        calories,
        protein: 10,
        carbs: 80,
        fat: 4,
        classification: {
          foodGroups: ["grains"],
          ingredients: [{ name: "rice", evidence: "reported" }],
        },
      },
    ],
  });

test("a bundle is one review, preserves omitted health fields and never partially changes its input", () => {
  const state = emptyJournal();
  saveCheckin(state, { date, waterMl: 1500, notes: "Existing note" }, date);
  const original = structuredClone(state);
  const m = meal();
  const { id, createdAt, ...input } = m;
  void id;
  void createdAt;
  const entries = [
    { kind: "record_checkin", checkin: { date, sleepHours: 7.5 } },
    { kind: "record_meal", meal: input },
    {
      kind: "record_cardio",
      cardio: { date, activity: "running", durationSeconds: 1800 },
    },
  ];
  const prepared = prepareAction(
    state,
    { kind: "record_bundle", entries },
    date,
  );
  assert.equal(prepared.entries?.length, 3);
  assert.equal(prepared.state.health.checkins[0].waterMl, 1500);
  assert.equal(prepared.state.health.checkins[0].notes, "Existing note");
  assert.equal(prepared.state.nutrition.meals.length, 1);
  assert.equal(prepared.state.cardio.sessions.length, 1);
  assert.deepEqual(state, original);
  assert.throws(
    () =>
      prepareAction(
        state,
        {
          kind: "record_bundle",
          entries: [
            ...entries,
            { kind: "repeat_meal", date, mealId: crypto.randomUUID() },
          ],
        },
        date,
      ),
    /not in your journal/,
  );
  assert.deepEqual(state, original);
  assert.throws(
    () =>
      prepareAction(
        state,
        { kind: "record_bundle", entries: [entries[0], entries[0]] },
        date,
      ),
    /Combine fields/,
  );
  assert.equal(
    actionSchema.safeParse({
      kind: "record_bundle",
      entries: [{ kind: "record_bundle", entries }, entries[0]],
    }).success,
    false,
  );
});

test("repeated favourites retain exact tags and estimates, omit old photos, and reopen complete food days", () => {
  const state = emptyJournal();
  const source = meal(offsetDate(date, -1));
  source.photoIds = [crypto.randomUUID()];
  state.nutrition.meals.push(source);
  const favourite = favouriteFromMeal(source);
  state.nutrition.favourites = [favourite];
  state.nutrition.completeDays = [date];
  for (const mealId of [source.id, favourite.id]) {
    const prepared = prepareAction(
      state,
      { kind: "repeat_meal", mealId, date },
      date,
    );
    assert.deepEqual(prepared.meal?.items, source.items);
    assert.deepEqual(prepared.meal?.photoIds, []);
    assert.equal(prepared.meal?.date, date);
    assert.equal(prepared.meal?.estimated, true);
    assert.notEqual(prepared.meal?.id, source.id);
    assert.deepEqual(prepared.state.nutrition.completeDays, []);
  }
  assert.throws(
    () =>
      prepareAction(
        state,
        {
          kind: "repeat_meal",
          mealId: favourite.id,
          date: offsetDate(date, 1),
        },
        date,
      ),
    /future/,
  );
});

test("approved memories and plans survive backups, edits, dismissal and legacy response adaptation", () => {
  const original = emptyJournal();
  const memory = prepareAction(
    original,
    {
      kind: "save_memory",
      memory: { category: "food", text: "I prefer vegetarian lunches." },
    },
    date,
  );
  assert.equal(original.profile.coaching, undefined);
  assert.equal(
    coachingContext(memory.state, date).approvedMemories[0].text,
    "I prefer vegetarian lunches.",
  );
  const next = prepareAction(
    memory.state,
    {
      kind: "save_plan",
      plan: {
        title: "Prepare lunch in the evening",
        notes: "Try once",
        followUpDate: offsetDate(date, 1),
        status: "active",
        outcome: "",
      },
    },
    date,
  );
  assert.notEqual(
    coachSuggestion(next.state, date).id,
    `plan-${next.plan!.id}-${next.plan!.updatedAt}`,
  );
  assert.match(coachSuggestion(next.state, offsetDate(date, 1)).id, /^plan-/);
  const changed = prepareAction(
    next.state,
    {
      kind: "save_memory",
      memoryId: memory.memory!.id,
      memory: { category: "food", text: "Quick vegetarian lunches." },
    },
    date,
  );
  assert.equal(changed.state.profile.coaching!.memories!.length, 1);
  const restored = parseLegacyBackup(backup(changed.state));
  const imported = mergeImport(
    emptyJournal(),
    parseLegacyBackup(backup(changed.state)),
  );
  assert.deepEqual(imported.profile.coaching, changed.state.profile.coaching);
  const dismissed = prepareAction(
    changed.state,
    { kind: "dismiss_plan", planId: next.plan!.id },
    date,
  );
  assert.equal(dismissed.plan?.status, "dismissed");
  assert.equal(dismissed.state.profile.coaching?.plans?.length, 1);
  assert.deepEqual(restored.profile.coaching, changed.state.profile.coaching);
  const rawSnapshot = { state: restored, revision: 3 };
  const legacy = foodSnapshotForClient(
    new Request("https://example.test", {
      headers: { "X-Food-Tags-Version": "1" },
    }),
    rawSnapshot,
  );
  assert.equal(legacy.state.profile.coaching?.memories, undefined);
  assert.ok(rawSnapshot.state.profile.coaching?.memories?.length);
  const modern = foodSnapshotForClient(
    new Request("https://example.test", {
      headers: { "X-Coach-Journal-Version": "1", "X-Food-Tags-Version": "1" },
    }),
    rawSnapshot,
  );
  assert.deepEqual(modern, rawSnapshot);
  const settings = coachSettings(restored);
  settings.initiative = "on-request";
  assert.equal(
    coachingContext(restored, offsetDate(date, 1)).startingPoint,
    null,
  );
  assert.doesNotMatch(
    coachSuggestion(restored, offsetDate(date, 1)).id,
    /^plan-/,
  );
  settings.initiative = "gentle";
  settings.plans![0].status = "dismissed";
  assert.doesNotMatch(
    coachSuggestion(restored, offsetDate(date, 1)).id,
    /^plan-/,
  );
  const forgotten = prepareAction(
    restored,
    { kind: "forget_memory", memoryId: memory.memory!.id },
    date,
  );
  assert.deepEqual(forgotten.state.profile.coaching?.memories, []);
  assert.throws(
    () =>
      prepareAction(
        original,
        { kind: "forget_memory", memoryId: memory.memory!.id },
        date,
      ),
    /not in your journal/,
  );
  assert.throws(
    () =>
      prepareAction(
        original,
        {
          kind: "save_plan",
          planId: next.plan!.id,
          plan: {
            title: "Other",
            notes: "",
            status: "active",
            followUpDate: date,
            outcome: "",
          },
        },
        date,
      ),
    /not in your journal/,
  );
});

test("weekly evidence uses complete food days, observed sleep including zero, and stable calendar windows", () => {
  const state = emptyJournal();
  state.nutrition.meals = [
    meal(date, 500),
    meal(offsetDate(date, -1), 2100),
    meal(offsetDate(date, -8), 1900),
  ];
  state.nutrition.completeDays = [offsetDate(date, -1), offsetDate(date, -8)];
  saveCheckin(state, { date, sleepHours: 0 }, date);
  saveCheckin(state, { date: offsetDate(date, -1), sleepHours: 8 }, date);
  saveCheckin(state, { date: offsetDate(date, -8), sleepHours: 7 }, date);
  const report = weeklyReview(state, date);
  assert.equal(report.current.averageCalories, 2100);
  assert.equal(report.current.foodLoggedDays, 2);
  assert.equal(report.current.completeFoodDays, 1);
  assert.equal(report.changes.calories, 200);
  assert.equal(report.current.averageSleepHours, 4);
  assert.equal(report.current.sleepNights, 2);
  assert.equal(
    report.current.days.at(-1)?.meals[0].id,
    state.nutrition.meals[0].id,
  );
  assert.equal(report.current.days[0].checkin, null);
  assert.equal(report.current.estimatedCompleteDays, 1);
  const unknown = weeklyReview(emptyJournal(), "2026-03-30");
  assert.equal(unknown.current.from, "2026-03-24");
  assert.equal(unknown.previous.to, "2026-03-23");
  assert.equal(unknown.current.averageCalories, null);
  assert.equal(unknown.current.averageSleepHours, null);
  assert.equal(unknown.changes.sleepHours, null);
});

test("merging backups retains approved collections and reopens completion when additional meals arrive", () => {
  const a = emptyJournal(),
    b = emptyJournal();
  const m = meal();
  a.nutrition.meals = [m];
  a.nutrition.completeDays = [date];
  a.nutrition.favourites = [favouriteFromMeal(m)];
  b.nutrition.meals = [meal(date)];
  const merged = mergeImport(a, b);
  assert.equal(merged.nutrition.meals.length, 2);
  assert.deepEqual(merged.nutrition.completeDays, []);
  assert.deepEqual(merged.nutrition.favourites, a.nutrition.favourites);
  const fresh = mergeImport(emptyJournal(), parseLegacyBackup(backup(a)));
  assert.deepEqual(fresh.nutrition.favourites, a.nutrition.favourites);
  assert.deepEqual(fresh.nutrition.completeDays, [date]);
  const conflicting = structuredClone(a);
  conflicting.nutrition.favourites![0].name = "Different recipe";
  assert.throws(() => mergeImport(a, conflicting), /different favourite meal/);
});

test("current manual undo explicitly clears additive Coach fields without changing its source", () => {
  const before = emptyJournal();
  const restored = coachStateForUndo(before);
  assert.deepEqual(restored.profile.coaching?.memories, []);
  assert.deepEqual(restored.profile.coaching?.plans, []);
  assert.deepEqual(restored.nutrition.favourites, []);
  assert.deepEqual(restored.nutrition.completeDays, []);
  assert.equal(before.profile.coaching, undefined);
});
