import { bodyweightKg, workoutMinutes } from "./energy";
import { z } from "zod";
import { foodDate } from "./nutrition";
import type { CardioEntry } from "./cardio";
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
  "beer",
  "wine",
  "spirits",
  "other",
] as const;
export type DrinkKind = (typeof drinkKinds)[number];
// Alcohol counts towards the day's drinks like any drink, but its energy
// (7 kcal a gram) belongs in Food too, and it is never a way to rehydrate.
export const alcoholKinds: readonly DrinkKind[] = ["beer", "wine", "spirits"];
export const drinkInputSchema = z
  .object({
    date: foodDate,
    ml: z.number().int().min(10).max(5000),
    kind: z.enum(drinkKinds),
    name: z.string().trim().max(120).default(""),
    // A usual size (a glass, a bottle, a can) used because the volume
    // wasn't given.
    estimated: z.boolean().optional(),
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
  const { estimated, ...drink } = drinkInputSchema.parse(input);
  const saved = drinkSchema.parse({
    ...drink,
    // Only an estimate is marked; an exact volume carries no flag.
    ...(estimated ? { estimated } : {}),
    id: crypto.randomUUID(),
    at: at.toISOString(),
  });
  state.health.drinks = [...(state.health.drinks ?? []), saved];
  return saved;
}

export function removeDrink(state: JournalState, id: string) {
  const drink = (state.health.drinks ?? []).find((d) => d.id === id);
  if (!drink) throw Error("That drink is not in your journal.");
  state.health.drinks = (state.health.drinks ?? []).filter((d) => d.id !== id);
  return drink;
}

// A cached app from before alcohol and estimated volumes rejects both, so it
// is sent alcohol as a named "other" drink and no estimate flags; when it
// saves those drinks back unchanged, the stored kind and flag are kept.
export function drinksForOlderApps(drinks: Drink[]): Drink[] {
  return drinks.map(({ estimated, ...d }) => {
    void estimated;
    return alcoholKinds.includes(d.kind)
      ? {
          ...d,
          kind: "other",
          name: d.name || d.kind[0].toUpperCase() + d.kind.slice(1),
        }
      : d;
  });
}
export function retainDrinkDetails(drinks: Drink[], stored: Drink[]) {
  const before = new Map(stored.map((d) => [d.id, d]));
  return drinks.map((d) => {
    const b = before.get(d.id);
    if (!b || b.date !== d.date || b.ml !== d.ml) return d;
    return {
      ...d,
      ...(d.kind === "other" && alcoholKinds.includes(b.kind)
        ? { kind: b.kind, name: b.name }
        : {}),
      ...(d.estimated === undefined && b.estimated
        ? { estimated: b.estimated }
        : {}),
    };
  });
}

// The check-in's old "Water today" total, from before drinks were logged one
// at a time, moves once into a "From check-in" drink so a day's drinks are
// its one record. On a day that already had drinks, they were the record and
// the check-in total was never counted, so it is only cleared. The drink's id
// comes from the date: moving an older copy of the journal again gives the
// same drink, not a second one.
const checkinDrinkPrefix = "00000000-0000-4000-8000-";
function checkinDrinks(date: string, ml: number, at: string): Drink[] {
  if (ml < 10) return [];
  // A drink holds at most 5 L, so a larger total is split evenly.
  const parts = Math.ceil(ml / 5000);
  return Array.from({ length: parts }, (_, i) =>
    drinkSchema.parse({
      id: `${checkinDrinkPrefix}${i}000${date.replaceAll("-", "")}`,
      date,
      ml: Math.floor(ml / parts) + (i < ml % parts ? 1 : 0),
      kind: "water",
      name: "From check-in",
      at,
    }),
  );
}
export function moveCheckinWater(state: JournalState): JournalState {
  const legacy = state.health.checkins.filter((c) => c.waterMl != null);
  if (!legacy.length) return state;
  let drinks = state.health.drinks ?? [];
  for (const c of legacy) {
    const moved = (d: Drink) =>
      d.date === c.date && d.id.startsWith(checkinDrinkPrefix);
    if (drinks.some((d) => d.date === c.date && !moved(d))) continue;
    drinks = [
      ...drinks.filter((d) => !moved(d)),
      ...checkinDrinks(c.date, c.waterMl!, c.updatedAt),
    ];
  }
  const dates = new Set(legacy.map((c) => c.date));
  const checkins = state.health.checkins
    .map((c) => (dates.has(c.date) ? { ...c, waterMl: null } : c))
    // A check-in that held only water has nothing left to keep.
    .filter(
      (c) =>
        !dates.has(c.date) ||
        [c.sleepHours, c.energy, c.soreness, c.bodyweight].some(
          (v) => v != null,
        ) ||
        c.notes.length > 0,
    );
  return { ...state, health: { ...state.health, checkins, drinks } };
}

// The day's target is for drinks, not total water: food brings roughly a
// fifth more. A design choice calibrated against EFSA and NNR adequate
// intakes (2.0 L for women and 2.5 L for men, in total), NASEM's beverage
// intakes and measured water turnover, which rises only about 14 ml per kg
// of bodyweight, so a heavy lifter is not asked for 35 ml a kg. The base is
// bounded whatever weight is entered; training then adds about 0.6 L an
// hour, up to 2 L. A guide for planning, not a minimum or a medical target.
const baseMl = 1200;
const mlPerKg = 9.5;
const sexMl = { male: 240, unspecified: 120, female: 0 };
// Without a known weight, the base of a 70 kg adult.
const referenceKg = 70;
const drinksBoundsMl = { min: 1500, max: 4500 };
const trainingMlPerHour = 600;
const trainingMaxMl = 2000;
const quarterLitres = (ml: number) => Math.round(ml / 250) * 250;

function drinksBaseMl(state: JournalState, date: string) {
  const weight = bodyweightKg(state, date);
  const sex = state.profile.body?.sex ?? "unspecified";
  const ml = baseMl + sexMl[sex] + mlPerKg * (weight || referenceKg);
  return {
    ml: Math.min(drinksBoundsMl.max, Math.max(drinksBoundsMl.min, ml)),
    estimated: !weight,
  };
}

// Apple Health strength workouts arrive as "other" activities with these
// titles (HealthSync.swift).
const importedStrengthTitles = [
  "strength training",
  "functional strength training",
  "core training",
];
const importedStrength = (c: CardioEntry) =>
  c.activity === "other" &&
  importedStrengthTitles.includes(c.title.trim().toLowerCase());

// Minutes trained that day: timed lifting sessions and every activity,
// which includes strength workouts imported from Apple Health. A session
// without usable start and finish times counts as the athlete's usual
// session length. On a day with logged lifting, an imported strength
// workout is that same session, as health-sync.ts treats one that arrives
// after it (a watch stopped before Finish, or a session told to Coach in
// the evening, imports first): the longer of the two counts, not both.
export function trainingMinutes(state: JournalState, date: string) {
  const usual = state.profile.body?.sessionMinutes ?? 75;
  const minutes = (entries: CardioEntry[]) =>
    entries.reduce((sum, c) => sum + c.durationSeconds / 60, 0);
  const lifting = state.sessions
    .filter((s) => s.date === date)
    .reduce((sum, s) => sum + (workoutMinutes(s) ?? usual), 0);
  const activities = state.cardio.sessions.filter((c) => c.date === date);
  return (
    Math.max(lifting, minutes(activities.filter(importedStrength))) +
    minutes(activities.filter((c) => !importedStrength(c)))
  );
}

const trainingMl = (minutes: number) =>
  Math.min(trainingMaxMl, (minutes / 60) * trainingMlPerHour);

// About half a litre either side of the target, never below 1.5 L.
const drinksRangeMl = (targetMl: number) => ({
  lowMl: Math.max(drinksBoundsMl.min, targetMl - 500),
  highMl: targetMl + 500,
});

export function hydrationTargetMl(state: JournalState, date: string) {
  const base = drinksBaseMl(state, date);
  const minutes = trainingMinutes(state, date);
  const targetMl = quarterLitres(base.ml + trainingMl(minutes));
  return {
    targetMl,
    ...drinksRangeMl(targetMl),
    trainingMinutes: Math.round(minutes),
    // Without a weight the base is a general one.
    estimated: base.estimated,
    // The athlete chose not to see a drinks target.
    hidden: Boolean(state.preferences.hideHydrationTarget),
  };
}

// A rest day's target and a lifting day's with the usual session length,
// for the targets listed in Account.
export function usualHydrationTargets(state: JournalState, date: string) {
  const base = drinksBaseMl(state, date);
  return {
    restDayMl: quarterLitres(base.ml),
    liftingDayMl: quarterLitres(
      base.ml + trainingMl(state.profile.body?.sessionMinutes ?? 75),
    ),
  };
}

// A line beside the target: what it rests on, and the everyday signs that
// matter more than any number. Thirst is a weaker guide after about 50.
export function hydrationNote(state: JournalState, date: string) {
  const { estimated } = hydrationTargetMl(state, date);
  const age = state.profile.body?.age || state.profile.age;
  return [
    estimated
      ? "A general estimate until your weight is known, not a minimum."
      : "An estimate from your weight and the day's training, not a minimum.",
    age >= 50
      ? "Pale urine is a good everyday sign; after about 50 thirst is a weaker guide, so drink with meals too."
      : "Thirst and pale urine are good everyday signs.",
  ].join(" ");
}

// The day's drinks against its target.
export function hydrationForDay(state: JournalState, date: string) {
  const drinks = (state.health.drinks ?? [])
    .filter((d) => d.date === date)
    .sort((a, b) => a.at.localeCompare(b.at));
  return {
    drinks,
    totalMl: drinks.reduce((sum, d) => sum + d.ml, 0),
    ...hydrationTargetMl(state, date),
    recorded: drinks.length > 0,
  };
}

// The day's drinks as the coaches see them: the target as an estimate with
// its range, and no target at all when the athlete hid it.
export function hydrationForCoach(state: JournalState, date: string) {
  const day = hydrationForDay(state, date);
  return {
    totalMl: day.totalMl,
    recorded: day.recorded,
    ...(day.hidden
      ? { targetHidden: true }
      : { targetMl: day.targetMl, lowMl: day.lowMl, highMl: day.highMl }),
  };
}

const litres = (ml: number, digits: number) =>
  (ml / 1000).toLocaleString("en-GB", { maximumFractionDigits: digits });
export const formatLitres = (ml: number) => `${litres(ml, 1)} L`;
// Targets are set in quarter litres: "2.25 L", and "1.75 to 2.75 L".
export const formatTargetLitres = (ml: number) => `${litres(ml, 2)} L`;
export const formatLitresRange = (lowMl: number, highMl: number) =>
  `${litres(lowMl, 2)} to ${formatTargetLitres(highMl)}`;
