import { z } from "zod";
import { foodDate } from "./nutrition";
import type { JournalState } from "./model";

// Body fat percentage, as the athlete reports it or a smart scale measures
// it through Apple Health. Readings differ by method and by day (a scale
// moves with hydration), so each keeps its method and the trend matters
// more than any one reading. One reading per date and source.
export const bodyFatMethods = [
  "scale",
  "dexa",
  "calipers",
  "tape",
  "estimate",
  "other",
] as const;
export const bodyFatInputSchema = z
  .object({
    date: foodDate,
    percent: z.number().finite().min(3).max(70),
    method: z.enum(bodyFatMethods).nullable().default(null),
  })
  .strict();
export const bodyFatSchema = bodyFatInputSchema.extend({
  source: z.enum(["reported", "apple-health"]),
  updatedAt: z.iso.datetime(),
});
export type BodyFat = z.infer<typeof bodyFatSchema>;
export type BodyFatInput = z.input<typeof bodyFatInputSchema>;

// What the athlete is working towards, beside the weight goal in
// profile.body: the focus and an optional body fat target.
export const bodyFocuses = [
  "lose_fat",
  "build_muscle",
  "recomposition",
  "maintain",
] as const;
export type BodyFocus = (typeof bodyFocuses)[number];
export const bodyTargetsSchema = z
  .object({
    focus: z.enum(bodyFocuses),
    targetBodyFatPercent: z.number().finite().min(3).max(60).nullable(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type BodyTargets = z.infer<typeof bodyTargetsSchema>;

const round1 = (n: number) => Math.round(n * 10) / 10;

export function saveBodyFat(
  state: JournalState,
  input: BodyFatInput,
  currentDate: string,
  source: BodyFat["source"] = "reported",
  at = new Date(),
): BodyFat {
  const value = bodyFatInputSchema.parse(input);
  if (value.date > currentDate)
    throw Error("Body fat can't be recorded for a future date.");
  const entry = bodyFatSchema.parse({
    ...value,
    percent: round1(value.percent),
    source,
    updatedAt: at.toISOString(),
  });
  state.health.bodyFat = [
    ...(state.health.bodyFat ?? []).filter(
      (b) => !(b.date === entry.date && b.source === source),
    ),
    entry,
  ].sort((a, b) => a.date.localeCompare(b.date));
  return entry;
}

// Only what the athlete reported can be removed; a scale reading stays until
// it is removed in Apple Health.
export function removeBodyFat(state: JournalState, date: string) {
  const entry = (state.health.bodyFat ?? []).find(
    (b) => b.date === date && b.source === "reported",
  );
  if (!entry) throw Error(`No body fat reading you entered on ${date}.`);
  state.health.bodyFat = (state.health.bodyFat ?? []).filter(
    (b) => b !== entry,
  );
  return entry;
}

// One reading per date: the athlete's own report wins over a scale reading
// on the same day.
export function bodyFatByDate(state: JournalState, from: string, to: string) {
  const days = new Map<string, BodyFat>();
  for (const b of state.health.bodyFat ?? []) {
    if (b.date < from || b.date > to) continue;
    const seen = days.get(b.date);
    if (!seen || (seen.source === "apple-health" && b.source === "reported"))
      days.set(b.date, b);
  }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function latestBodyFat(
  state: JournalState,
  onOrBefore: string,
  withinDays = 90,
) {
  const from = new Date(`${onOrBefore}T12:00:00Z`);
  from.setUTCDate(from.getUTCDate() - withinDays);
  return (
    bodyFatByDate(state, from.toISOString().slice(0, 10), onOrBefore).at(-1) ??
    null
  );
}

// The trend in plain numbers: first and latest reading in the window, and
// the lean and fat mass they imply when a bodyweight was recorded near them.
export function bodyFatTrend(state: JournalState, from: string, to: string) {
  const readings = bodyFatByDate(state, from, to);
  if (!readings.length) return null;
  const first = readings[0]!,
    last = readings.at(-1)!;
  const weightNear = (date: string) =>
    [...state.health.checkins]
      .filter((c) => c.bodyweight != null && c.date <= date)
      .sort((a, b) => b.date.localeCompare(a.date))
      .find((c) => (Date.parse(date) - Date.parse(c.date)) / 86400000 <= 7)
      ?.bodyweight ?? null;
  const split = (b: BodyFat) => {
    const weight = weightNear(b.date);
    return weight == null
      ? null
      : {
          weight_kg: weight,
          lean_kg: round1(weight * (1 - b.percent / 100)),
          fat_kg: round1((weight * b.percent) / 100),
        };
  };
  return {
    readings: readings.length,
    first: { date: first.date, percent: first.percent, ...split(first) },
    latest: { date: last.date, percent: last.percent, ...split(last) },
    change_points: round1(last.percent - first.percent),
    methods: [...new Set(readings.map((r) => r.method ?? "unknown"))],
  };
}

// Bodyweight over the last four weeks from check-ins: the first and latest
// weigh-ins and the average change a week between them.
export function weightTrend(state: JournalState, date: string, days = 28) {
  const from = new Date(`${date}T12:00:00Z`);
  from.setUTCDate(from.getUTCDate() - days);
  const start = from.toISOString().slice(0, 10);
  const weights = state.health.checkins
    .filter((c) => c.bodyweight != null && c.date >= start && c.date <= date)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (weights.length < 2) return null;
  const first = weights[0]!,
    last = weights.at(-1)!;
  const weeks = (Date.parse(last.date) - Date.parse(first.date)) / 604800000;
  return {
    weigh_ins: weights.length,
    first: { date: first.date, kg: first.bodyweight! },
    latest: { date: last.date, kg: last.bodyweight! },
    kg_per_week:
      weeks >= 1
        ? Math.round(((last.bodyweight! - first.bodyweight!) / weeks) * 100) /
          100
        : null,
  };
}

// Essential fat and very lean limits, by sex. Without a stated sex, the
// midpoint. Used for notes, never to refuse a record.
export function leannessLimits(sex: "male" | "female" | "unspecified") {
  return sex === "male"
    ? { essential: 5, veryLean: 8, lean: 12, higher: 25 }
    : sex === "female"
      ? { essential: 13, veryLean: 16, lean: 22, higher: 32 }
      : { essential: 9, veryLean: 12, lean: 17, higher: 28 };
}
