import { z } from "zod";

export const foodDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      !Number.isNaN(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
    "Choose a valid meal date",
  );
export const nutrientsSchema = z.object({
  calories: z.number().finite().min(0).max(10000),
  protein: z.number().finite().min(0).max(1000),
  carbs: z.number().finite().min(0).max(2000),
  fat: z.number().finite().min(0).max(1000),
});
export const mealTypes = ["breakfast", "lunch", "dinner", "snack"] as const;
export const foodGroups = {
  meat: "Meat & poultry",
  seafood: "Fish & seafood",
  eggs: "Eggs",
  dairy: "Dairy & alternatives",
  grains: "Grains & potatoes",
  vegetables: "Vegetables",
  fruit: "Fruit",
  legumes: "Beans & lentils",
  nuts_seeds: "Nuts & seeds",
  fats_oils: "Fats & oils",
  sweets: "Sweets",
  drinks: "Drinks",
  other: "Other",
} as const;
export const foodGroupSchema = z.enum(
  Object.keys(foodGroups) as [
    keyof typeof foodGroups,
    ...(keyof typeof foodGroups)[],
  ],
);
export const ingredientEvidenceSchema = z.enum([
  "reported",
  "label",
  "visible",
  "estimated",
]);
export const ingredientEvidenceLabels = {
  reported: "Reported",
  label: "From label",
  visible: "Visible in photo",
  estimated: "Assumed ingredient",
} as const;
export const foodTagSchema = z.string().trim().toLowerCase().min(1).max(80);
export const normalizeFoodTag = (value: string) =>
  value.trim().toLowerCase().replace(/\s+/g, " ");
export const foodClassificationSchema = z
  .object({
    foodGroups: z.array(foodGroupSchema).max(13),
    ingredients: z
      .array(
        z
          .object({
            name: foodTagSchema,
            evidence: ingredientEvidenceSchema,
          })
          .strict(),
      )
      .max(40),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      new Set(value.foodGroups).size !== value.foodGroups.length ||
      new Set(value.ingredients.map((i) => normalizeFoodTag(i.name))).size !==
        value.ingredients.length
    )
      ctx.addIssue({
        code: "custom",
        message: "Use each food group and ingredient only once per food.",
      });
  });
export const foodItemSchema = nutrientsSchema
  .extend({
    name: z.string().trim().min(1).max(160),
    portion: z.string().trim().min(1).max(200),
    // Optional preserves old records and pre-release mutation hashes. Missing means unknown.
    classification: foodClassificationSchema.optional(),
  })
  .strict();
export const mealInputSchema = z
  .object({
    date: foodDate,
    name: z.string().trim().min(1).max(160),
    type: z.enum(mealTypes),
    items: z.array(foodItemSchema).min(1).max(30),
    source: z.enum(["manual", "text", "photo"]),
    estimated: z.boolean(),
    notes: z.string().max(3000).default(""),
    photoIds: z.array(z.string().uuid()).max(4).default([]),
  })
  .strict();
export const mealSchema = mealInputSchema.extend({
  id: z.string().uuid(),
  createdAt: z.string().datetime(),
});
export const dietTargetsSchema = z
  .object({
    goal: z.enum(["maintain", "lose", "gain"]).default("maintain"),
    calories: z.number().finite().min(0).max(10000).nullable().default(null),
    protein: z.number().finite().min(0).max(1000).nullable().default(null),
    carbs: z.number().finite().min(0).max(2000).nullable().default(null),
    fat: z.number().finite().min(0).max(1000).nullable().default(null),
  })
  .strict();
export const nutritionSchema = z
  .object({
    meals: z.array(mealSchema).max(10000).default([]),
    targets: dietTargetsSchema.default(() => dietTargetsSchema.parse({})),
  })
  .superRefine((value, ctx) => {
    if (new Set(value.meals.map((m) => m.id)).size !== value.meals.length)
      ctx.addIssue({ code: "custom", message: "Duplicate meal IDs" });
  });
export type Meal = z.infer<typeof mealSchema>;
export type FoodItem = z.infer<typeof foodItemSchema>;
export type FoodClassification = z.infer<typeof foodClassificationSchema>;
export type DietTargets = z.infer<typeof dietTargetsSchema>;
export type Nutrients = z.infer<typeof nutrientsSchema>;
export type FoodPhoto = {
  id: string;
  label: string;
  date: string;
  createdAt: string;
  bytes: number;
};
export function totalNutrients(items: Nutrients[]): Nutrients {
  const total = { calories: 0, protein: 0, carbs: 0, fat: 0 };
  for (const item of items)
    for (const key of Object.keys(total) as (keyof Nutrients)[])
      total[key] += item[key];
  for (const key of Object.keys(total) as (keyof Nutrients)[])
    total[key] = Math.round(total[key] * 10) / 10;
  return total;
}
export function nutritionSummary(
  nutrition: z.infer<typeof nutritionSchema>,
  from: string,
  to: string,
) {
  const meals = nutrition.meals.filter((m) => m.date >= from && m.date <= to);
  const dates = [...new Set(meals.map((m) => m.date))].sort();
  return {
    targets: nutrition.targets,
    loggedDays: dates.length,
    totals: totalNutrients(meals.flatMap((m) => m.items)),
    days: dates.map((date) => ({
      date,
      ...totalNutrients(
        meals.filter((m) => m.date === date).flatMap((m) => m.items),
      ),
    })),
  };
}

export const foodQuerySchema = z
  .object({
    from: foodDate.optional(),
    to: foodDate.optional(),
    mealType: z.enum(mealTypes).optional(),
    foodGroup: foodGroupSchema.optional(),
    ingredient: foodTagSchema.optional(),
    evidence: ingredientEvidenceSchema.optional(),
    query: z.string().trim().min(1).max(160).optional(),
    offset: z.number().int().min(0).max(10000).optional(),
  })
  .strict()
  .refine(
    (v) => !v.from || !v.to || v.from <= v.to,
    "Choose a valid date range.",
  );
export type FoodQuery = z.infer<typeof foodQuerySchema>;

/** Exact ingredient/group filters refer to the SAME food item. Text search also covers legacy names. */
export function matchingFoodItems(meal: Meal, filter: FoodQuery): FoodItem[] {
  return meal.items.filter((item) => {
    const tags = item.classification;
    if (filter.foodGroup && !tags?.foodGroups.includes(filter.foodGroup))
      return false;
    if (
      (filter.ingredient || filter.evidence) &&
      !tags?.ingredients.some(
        (i) =>
          (!filter.ingredient ||
            normalizeFoodTag(i.name) === normalizeFoodTag(filter.ingredient)) &&
          (!filter.evidence || i.evidence === filter.evidence),
      )
    )
      return false;
    const q = filter.query && normalizeFoodTag(filter.query);
    return (
      !q ||
      [
        meal.name,
        item.name,
        ...(tags?.ingredients.map((i) => i.name) ?? []),
      ].some((value) => normalizeFoodTag(value).includes(q))
    );
  });
}
export function findMeals(meals: Meal[], filter: FoodQuery) {
  return meals
    .filter(
      (meal) =>
        (!filter.from || meal.date >= filter.from) &&
        (!filter.to || meal.date <= filter.to) &&
        (!filter.mealType || meal.type === filter.mealType) &&
        matchingFoodItems(meal, filter).length > 0,
    )
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date) ||
        b.createdAt.localeCompare(a.createdAt) ||
        a.id.localeCompare(b.id),
    );
}
export function queryFoodJournal(
  nutrition: z.infer<typeof nutritionSchema>,
  input: FoodQuery,
  currentDate: string,
) {
  const filter = foodQuerySchema.parse(input);
  const from = filter.from ?? currentDate,
    to = filter.to ?? currentDate;
  if (from > to) throw Error("Choose a valid date range.");
  const meals = findMeals(nutrition.meals, { ...filter, from, to });
  const rangeMeals = nutrition.meals.filter(
    (m) => m.date >= from && m.date <= to,
  );
  const items = meals.flatMap((m) => matchingFoodItems(m, filter));
  const ingredients = new Map<
    string,
    { meals: Set<string>; evidence: Set<string> }
  >();
  for (const meal of meals)
    for (const item of matchingFoodItems(meal, filter))
      for (const ingredient of item.classification?.ingredients ?? []) {
        const name = normalizeFoodTag(ingredient.name);
        const entry = ingredients.get(name) ?? {
          meals: new Set<string>(),
          evidence: new Set<string>(),
        };
        entry.meals.add(meal.id);
        entry.evidence.add(ingredient.evidence);
        ingredients.set(name, entry);
      }
  const offset = filter.offset ?? 0;
  return {
    from,
    to,
    filters: filter,
    targets: nutrition.targets,
    totalMeals: meals.length,
    loggedDays: new Set(meals.map((m) => m.date)).size,
    // Keep full-meal and matched-item nutrients explicit; ingredient calories are not measured.
    totals: totalNutrients(meals.flatMap((m) => m.items)),
    matchingItemTotals: totalNutrients(items),
    days: nutritionSummary({ ...nutrition, meals }, from, to).days,
    byMealType: mealTypes.map((type) => ({
      type,
      meals: meals.filter((m) => m.type === type).length,
      ...totalNutrients(
        meals.filter((m) => m.type === type).flatMap((m) => m.items),
      ),
    })),
    ingredientFrequency: [...ingredients]
      .map(([name, entry]) => ({
        name,
        meals: entry.meals.size,
        evidence: [...entry.evidence].sort(),
      }))
      .sort((a, b) => b.meals - a.meals || a.name.localeCompare(b.name))
      .slice(0, 40),
    distinctIngredients: ingredients.size,
    coverage: {
      rangeMeals: rangeMeals.length,
      foodItems: rangeMeals.flatMap((m) => m.items).length,
      itemsWithIngredients: rangeMeals
        .flatMap((m) => m.items)
        .filter((i) => i.classification?.ingredients.length).length,
      itemsWithFoodGroups: rangeMeals
        .flatMap((m) => m.items)
        .filter((i) => i.classification?.foodGroups.length).length,
    },
    interpretation:
      "Totals cover complete matching meals; matchingItemTotals cover matching foods, never isolated ingredients. Ingredient frequency counts distinct matching meals and may include estimates. Missing tags or days are unknown, not absence. Frequency is capped at 40 ingredients; totalMeals and totals include every match, not just this page.",
    meals: meals.slice(offset, offset + 20),
    nextOffset: offset + 20 < meals.length ? offset + 20 : null,
  };
}

/** Cached clients and partial Coach corrections must not erase known tags. Explicit empty arrays clear them. */
export function retainFoodClassifications(
  items: FoodItem[],
  previous: FoodItem[],
): FoodItem[] {
  return items.map((item) => {
    if (item.classification !== undefined) return item;
    const named = previous.filter(
      (old) => normalizeFoodTag(old.name) === normalizeFoodTag(item.name),
    );
    const exact = named.filter((old) => old.portion === item.portion);
    const candidates = exact.length ? exact : named;
    if (candidates.length === 1 && candidates[0].classification)
      return {
        ...item,
        classification: structuredClone(candidates[0].classification),
      };
    if (candidates.some((old) => old.classification))
      throw Error(
        "Food tags are ambiguous. Reload and review each food's ingredients before saving.",
      );
    return item;
  });
}
