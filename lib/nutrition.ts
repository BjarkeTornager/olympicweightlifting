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
export const foodItemSchema = nutrientsSchema
  .extend({
    name: z.string().trim().min(1).max(160),
    portion: z.string().trim().min(1).max(200),
  })
  .strict();
export const mealInputSchema = z
  .object({
    date: foodDate,
    name: z.string().trim().min(1).max(160),
    type: z.enum(["breakfast", "lunch", "dinner", "snack"]),
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
