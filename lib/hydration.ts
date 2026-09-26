import { z } from "zod";
import { foodDate } from "./nutrition";
import type { JournalState } from "./model";

// Drinks through the day, each added on rather than overwriting a total.
export const drinkKinds = [
  "water",
  "sparkling water",
  "coffee",
  "tea",
  "energy drink",
  "sports drink",
  "milk",
  "juice",
  "soft drink",
  "protein shake",
  "other",
] as const;
export const drinkInputSchema = z
  .object({
    date: foodDate,
    ml: z.number().int().min(10).max(5000),
    kind: z.enum(drinkKinds),
    name: z.string().trim().max(120).default(""),
  })
  .strict();
export const drinkSchema = drinkInputSchema.extend({
  id: z.string().uuid(),
  at: z.iso.datetime(),
});
export type Drink = z.infer<typeof drinkSchema>;
export type DrinkInput = z.input<typeof drinkInputSchema>;

export function addDrink(
  state: JournalState,
  input: DrinkInput,
  at = new Date(),
) {
  const drink = drinkSchema.parse({
    ...drinkInputSchema.parse(input),
    id: crypto.randomUUID(),
    at: at.toISOString(),
  });
  state.health.drinks = [...(state.health.drinks ?? []), drink];
  return drink;
}

export function removeDrink(state: JournalState, id: string) {
  const drink = (state.health.drinks ?? []).find((d) => d.id === id);
  if (!drink) throw Error("That drink is not in your journal.");
  state.health.drinks = (state.health.drinks ?? []).filter((d) => d.id !== id);
  return drink;
}

// Everyday fluid need: about 35 ml per kg, plus roughly 0.6 L for each hour
// of training done that day. A guide for planning, not a medical target.
export function hydrationTargetMl(state: JournalState, date: string) {
  const body = state.profile.body;
  const weight =
    body?.weightKg ||
    state.profile.bodyweight ||
    [...state.health.checkins]
      .filter((c) => c.date <= date && c.bodyweight != null)
      .sort((a, b) => b.date.localeCompare(a.date))[0]?.bodyweight ||
    null;
  const trained =
    state.sessions.some((s) => s.date === date) ||
    state.activeWorkout?.date === date;
  const trainingMl = trained ? ((body?.sessionMinutes ?? 75) / 60) * 600 : 0;
  const base = weight ? weight * 35 : 2500;
  return {
    targetMl: Math.round((base + trainingMl) / 50) * 50,
    estimated: !weight,
  };
}

// The day's hydration. Drink entries count; on a day without any, an older
// check-in water total still counts so earlier records are not lost.
export function hydrationForDay(state: JournalState, date: string) {
  const drinks = (state.health.drinks ?? [])
    .filter((d) => d.date === date)
    .sort((a, b) => a.at.localeCompare(b.at));
  const checkinMl =
    state.health.checkins.find((c) => c.date === date)?.waterMl ?? null;
  const totalMl = drinks.length
    ? drinks.reduce((sum, d) => sum + d.ml, 0)
    : (checkinMl ?? 0);
  return {
    drinks,
    totalMl,
    ...hydrationTargetMl(state, date),
    recorded: drinks.length > 0 || checkinMl != null,
  };
}

export const formatLitres = (ml: number) =>
  `${(ml / 1000).toLocaleString("en-GB", { maximumFractionDigits: 1 })} L`;
