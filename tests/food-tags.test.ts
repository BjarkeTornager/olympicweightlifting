import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import {
  emptyJournal,
  backup,
  mergeImport,
  parseLegacyBackup,
} from "../lib/domain";
import {
  mealSchema,
  foodClassificationSchema,
  foodQuerySchema,
  queryFoodJournal,
  retainFoodClassifications,
} from "../lib/nutrition";
import { actionToolSchema, prepareAction } from "../lib/agent/actions";
const meal = (date = "2026-09-06", type = "dinner") =>
  mealSchema.parse({
    id: crypto.randomUUID(),
    createdAt: "2026-09-06T16:00:00Z",
    date,
    type,
    name: "Chicken bowl",
    source: "text",
    estimated: true,
    items: [
      {
        name: "Chicken with rice",
        portion: "1 bowl",
        calories: 500,
        protein: 35,
        carbs: 50,
        fat: 10,
        classification: {
          foodGroups: ["meat", "grains"],
          ingredients: [
            { name: " Chicken ", evidence: "reported" },
            { name: "rice", evidence: "reported" },
            { name: "olive oil", evidence: "estimated" },
          ],
        },
      },
      {
        name: "Salad",
        portion: "1 side",
        calories: 50,
        protein: 1,
        carbs: 5,
        fat: 2,
        classification: {
          foodGroups: ["vegetables"],
          ingredients: [{ name: "tomato", evidence: "visible" }],
        },
      },
    ],
  });
test("food taxonomy validates evidence and bounds, normalizes names, exports/imports without invented legacy tags", () => {
  const dinner = meal();
  assert.equal(dinner.items[0].classification!.ingredients[0].name, "chicken");
  for (const classification of [
    { foodGroups: ["medical"], ingredients: [] },
    { foodGroups: ["meat", "meat"], ingredients: [] },
    { foodGroups: [], ingredients: [{ name: "oil", evidence: "certain" }] },
    {
      foodGroups: [],
      ingredients: [
        { name: "oil", evidence: "reported" },
        { name: " OIL ", evidence: "estimated" },
      ],
    },
    {
      foodGroups: [],
      ingredients: [{ name: "x".repeat(81), evidence: "reported" }],
    },
  ])
    assert.equal(
      foodClassificationSchema.safeParse(classification).success,
      false,
    );
  const state = emptyJournal();
  state.nutrition.meals = [dinner];
  assert.deepEqual(
    mergeImport(emptyJournal(), parseLegacyBackup(backup(state))).nutrition,
    state.nutrition,
  );
  delete dinner.items[0].classification;
  assert.equal(mealSchema.parse(dinner).items[0].classification, undefined);
  assert.doesNotThrow(() => z.toJSONSchema(actionToolSchema));
  assert.doesNotThrow(() => z.toJSONSchema(foodQuerySchema));
});
test("food queries combine date, occasion and SAME-item ingredient/group; distinguish assumptions and legacy coverage", () => {
  const nutrition = emptyJournal().nutrition;
  const dinner = meal();
  const breakfast = meal("2026-09-06", "breakfast");
  const legacy = meal("2026-09-05");
  legacy.items.forEach((i) => delete i.classification);
  nutrition.meals = [dinner, breakfast, legacy];
  const query = {
    from: "2026-09-05",
    to: "2026-09-06",
    mealType: "dinner" as const,
    ingredient: "CHICKEN",
  };
  const result = queryFoodJournal(nutrition, query, "2026-09-06");
  assert.equal(result.totalMeals, 1);
  assert.equal(result.totals.calories, 550);
  assert.equal(result.matchingItemTotals.calories, 500);
  assert.deepEqual(result.coverage, {
    rangeMeals: 3,
    foodItems: 6,
    itemsWithIngredients: 4,
    itemsWithFoodGroups: 4,
  });
  assert.equal(
    queryFoodJournal(
      nutrition,
      { ...query, foodGroup: "vegetables" },
      "2026-09-06",
    ).totalMeals,
    0,
  );
  assert.equal(
    queryFoodJournal(
      nutrition,
      { ...query, ingredient: "olive oil", evidence: "reported" },
      "2026-09-06",
    ).totalMeals,
    0,
  );
  assert.equal(
    queryFoodJournal(
      nutrition,
      { ...query, ingredient: " olive oil ", evidence: "estimated" },
      "2026-09-06",
    ).totalMeals,
    1,
  );
  assert.equal(
    queryFoodJournal(
      nutrition,
      { from: "2026-09-05", to: "2026-09-05", query: "chicken" },
      "2026-09-06",
    ).totalMeals,
    1,
  );
  assert.equal(
    queryFoodJournal(
      nutrition,
      { from: "2026-09-04", to: "2026-09-04" },
      "2026-09-06",
    ).loggedDays,
    0,
  );
  assert.throws(
    () => queryFoodJournal(nutrition, { from: "2026-09-07" }, "2026-09-06"),
    /date range/,
  );
  assert.equal(
    foodQuerySchema.safeParse({ from: "2026-02-30" }).success,
    false,
  );
});
test("food pagination and frequency include all matches and count each meal once per ingredient", () => {
  const nutrition = emptyJournal().nutrition;
  nutrition.meals = Array.from({ length: 25 }, () => meal());
  nutrition.meals[0].items[1].classification!.ingredients.push({
    name: "chicken",
    evidence: "estimated",
  });
  const first = queryFoodJournal(
    nutrition,
    { ingredient: "chicken" },
    "2026-09-06",
  );
  const next = queryFoodJournal(
    nutrition,
    { ingredient: "chicken", offset: 20 },
    "2026-09-06",
  );
  assert.equal(first.totalMeals, 25);
  assert.equal(first.meals.length, 20);
  assert.equal(first.nextOffset, 20);
  assert.equal(first.totals.calories, 13750);
  assert.equal(
    first.ingredientFrequency.find((i) => i.name === "chicken")!.meals,
    25,
  );
  assert.equal(next.meals.length, 5);
  assert.equal(next.nextOffset, null);
  assert.equal(
    new Set([...first.meals, ...next.meals].map((m) => m.id)).size,
    25,
  );
});
test("meal corrections retain omitted tags across portion changes but permit explicit clearing", () => {
  const dinner = meal(),
    state = emptyJournal();
  state.nutrition.meals = [dinner];
  const { id, createdAt: _, ...input } = structuredClone(dinner);
  void _;
  delete input.items[0].classification;
  input.items[0].portion = "Half a bowl";
  const updated = prepareAction(
    state,
    { kind: "update_meal", mealId: id, meal: input },
    "2026-09-06",
  );
  assert.deepEqual(
    updated.meal!.items[0].classification,
    dinner.items[0].classification,
  );
  input.items[0].classification = { foodGroups: [], ingredients: [] };
  assert.deepEqual(
    prepareAction(
      state,
      { kind: "update_meal", mealId: id, meal: input },
      "2026-09-06",
    ).meal!.items[0].classification,
    input.items[0].classification,
  );
  const ambiguous = { ...dinner.items[0] };
  delete ambiguous.classification;
  assert.throws(
    () =>
      retainFoodClassifications(
        [ambiguous],
        [dinner.items[0], dinner.items[0]],
      ),
    /ambiguous/,
  );
});
