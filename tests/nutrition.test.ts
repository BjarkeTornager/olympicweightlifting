import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptyJournal,
  backup,
  mergeImport,
  parseLegacyBackup,
  today,
} from "../lib/domain";
import { journalSchema } from "../lib/model";
import {
  mealSchema,
  nutritionSummary,
  targetProgress,
  totalNutrients,
} from "../lib/nutrition";
import { prepareAction } from "../lib/agent/actions";
import { normalizeFoodPhoto } from "../lib/food-photos";
import sharp from "sharp";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FoodView } from "../components/views/food";

export const sampleMeal = () =>
  mealSchema.parse({
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    date: "2026-09-06",
    name: "Eggs and toast",
    type: "breakfast",
    source: "text",
    estimated: true,
    notes: "Two eggs and one slice; no butter.",
    items: [
      {
        name: "Eggs",
        portion: "2 large",
        calories: 144,
        protein: 12.6,
        carbs: 0.8,
        fat: 9.6,
      },
      {
        name: "Toast",
        portion: "1 slice",
        calories: 80,
        protein: 3,
        carbs: 15,
        fat: 1,
      },
    ],
    photoIds: [],
  });
test("food totals preserve units and report only logged days; backup imports preserve nutrition", () => {
  const state = emptyJournal(),
    meal = sampleMeal();
  state.nutrition.meals = [meal];
  state.nutrition.targets.calories = 2300;
  assert.deepEqual(totalNutrients(meal.items), {
    calories: 224,
    protein: 15.6,
    carbs: 15.8,
    fat: 10.6,
  });
  const summary = nutritionSummary(state.nutrition, "2026-08-31", "2026-09-06");
  assert.equal(summary.loggedDays, 1);
  assert.equal(summary.days.length, 1);
  const imported = mergeImport(
    emptyJournal(),
    parseLegacyBackup(backup(state)),
  );
  assert.deepEqual(imported.nutrition, state.nutrition);
  assert.equal(mergeImport(imported, imported).nutrition.meals.length, 1);
  const conflicting = structuredClone(imported);
  conflicting.nutrition.meals[0].items[0].calories = 200;
  assert.throws(
    () => mergeImport(imported, conflicting),
    /different version of meal/,
  );
  const legacy = { ...state, nutrition: undefined };
  assert.equal(journalSchema.parse(legacy).nutrition.meals.length, 0);
});
test("meal validation rejects negative/non-finite values, duplicate IDs and invalid dates", () => {
  const meal = sampleMeal();
  for (const calories of [-10, NaN, Infinity, 10001])
    assert.throws(() =>
      mealSchema.parse({ ...meal, items: [{ ...meal.items[0], calories }] }),
    );
  for (const date of ["2026-02-30", "2026-15-01", "not-a-date"])
    assert.throws(() => mealSchema.parse({ ...meal, date }));
  assert.throws(
    () =>
      journalSchema.parse({
        ...emptyJournal(),
        nutrition: { meals: [meal, meal] },
      }),
    /Duplicate meal/,
  );
});
test("agent meal proposals preserve training and update owned meals only", () => {
  const state = emptyJournal(),
    { id: _id, createdAt: _createdAt, ...meal } = sampleMeal();
  void _id;
  void _createdAt;
  const prepared = prepareAction(
    state,
    { kind: "record_meal", meal },
    "2026-09-06",
  );
  assert.equal(state.nutrition.meals.length, 0);
  assert.equal(prepared.meal?.name, meal.name);
  assert.deepEqual(prepared.state.sessions, state.sessions);
  assert.throws(
    () =>
      prepareAction(
        state,
        { kind: "update_meal", mealId: crypto.randomUUID(), meal },
        "2026-09-06",
      ),
    /not in your food/,
  );
  assert.throws(
    () => prepareAction(state, { kind: "record_meal", meal }, "2026-09-05"),
    /future/,
  );
  const updated = prepareAction(
    prepared.state,
    {
      kind: "update_meal",
      mealId: prepared.meal!.id,
      meal: { ...meal, name: "Corrected breakfast" },
    },
    "2026-09-06",
  );
  assert.equal(updated.state.nutrition.meals.length, 1);
  assert.equal(updated.meal?.id, prepared.meal?.id);
});
test("a Coach target update changes only the targets it names", () => {
  const state = emptyJournal();
  state.nutrition.targets = {
    goal: "lose",
    calories: 2350,
    protein: 176,
    carbs: 253,
    fat: 70,
  };
  // Calories only: protein, carbs, fat and the goal label are kept.
  const calories = prepareAction(
    state,
    { kind: "set_diet_targets", targets: { calories: 2400 } },
    "2026-09-06",
  );
  assert.deepEqual(calories.state.nutrition.targets, {
    goal: "lose",
    calories: 2400,
    protein: 176,
    carbs: 253,
    fat: 70,
  });
  assert.deepEqual(calories.targets, calories.state.nutrition.targets);
  assert.deepEqual(calories.targetsBefore, state.nutrition.targets);
  // An explicit null clears that target alone.
  const cleared = prepareAction(
    state,
    { kind: "set_diet_targets", targets: { carbs: null } },
    "2026-09-06",
  );
  assert.deepEqual(cleared.state.nutrition.targets, {
    ...state.nutrition.targets,
    carbs: null,
  });
  // The goal label changes only when given.
  const goal = prepareAction(
    state,
    { kind: "set_diet_targets", targets: { goal: "maintain" } },
    "2026-09-06",
  );
  assert.deepEqual(goal.state.nutrition.targets, {
    ...state.nutrition.targets,
    goal: "maintain",
  });
  // A complete set still replaces them all, and an empty one is refused.
  const full = {
    goal: "gain",
    calories: 3000,
    protein: 180,
    carbs: 380,
    fat: 90,
  };
  assert.deepEqual(
    prepareAction(
      state,
      { kind: "set_diet_targets", targets: full },
      "2026-09-06",
    ).state.nutrition.targets,
    full,
  );
  assert.throws(
    () =>
      prepareAction(
        state,
        { kind: "set_diet_targets", targets: {} },
        "2026-09-06",
      ),
    /Name the targets/,
  );
  // The journal itself is untouched until the change is saved.
  assert.equal(state.nutrition.targets.calories, 2350);
});
test("a daily target of 0 is no target: the Food page says so", () => {
  assert.equal(targetProgress(980, 0, "kcal"), "No daily target");
  assert.equal(targetProgress(980, null, "kcal"), "No daily target");
  assert.equal(targetProgress(980, 1900, "kcal"), "920\u00a0kcal remaining");
  assert.equal(targetProgress(140, 130, "g"), "10\u00a0g above target");
  const state = emptyJournal(),
    meal = sampleMeal();
  meal.date = today();
  state.nutrition.meals = [meal];
  state.nutrition.targets = {
    goal: "maintain",
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
  };
  const page = () =>
    renderToStaticMarkup(
      createElement(FoodView, {
        journal: { state, update: async () => {} } as never,
        go: () => {},
      }),
    );
  const html = page();
  assert.match(html, /kcal · no daily target/);
  assert.equal(html.match(/No daily target/g)?.length, 3);
  assert.doesNotMatch(html, /of 0|<progress|above target|remaining/);
  state.nutrition.targets.calories = 2300;
  state.nutrition.targets.protein = 150;
  assert.match(page(), /of 2,300\u00a0kcal/);
  assert.match(page(), /134\u00a0g remaining/);
});
test("photo processing rejects spoofed files, bounds size and removes metadata", async () => {
  await assert.rejects(
    normalizeFoodPhoto(
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
    ),
    /valid JPEG/,
  );
  await assert.rejects(
    normalizeFoodPhoto(Buffer.alloc(2 * 1024 * 1024 + 1)),
    /smaller/,
  );
  const image = await sharp({
    create: { width: 1500, height: 500, channels: 3, background: "#ac7650" },
  })
    .jpeg()
    .withExif({ IFD0: { Artist: "Private metadata" } })
    .toBuffer();
  const output = await normalizeFoodPhoto(image),
    meta = await sharp(output).metadata();
  assert.equal(meta.width, 1280);
  assert.equal(meta.format, "jpeg");
  assert.equal(meta.exif, undefined);
});
