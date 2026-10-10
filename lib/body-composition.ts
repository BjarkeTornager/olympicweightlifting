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

// A day's weight from Apple Health (a smart scale, or one entered there):
// the first reading of the day, as a morning weigh-in is the steadiest. Kept
// apart from check-ins, which hold what the athlete reports here, so an
// import never overwrites a self-report.
export const bodyMassSchema = z
  .object({
    date: foodDate,
    kg: z.number().finite().min(20).max(500),
    source: z.literal("apple-health"),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type BodyMass = z.infer<typeof bodyMassSchema>;

export type WeighIn = {
  date: string;
  kg: number;
  source: "checkin" | "apple-health";
  // When it was recorded, for a weigh-in on the day the goals were saved.
  updatedAt: string;
};

// One weigh-in a day, oldest first: the athlete's check-in, else Apple
// Health's first reading of the day.
export function weighIns(state: JournalState, from: string, to: string) {
  const days = new Map<string, WeighIn>();
  for (const m of state.health.bodyMass ?? [])
    if (m.date >= from && m.date <= to)
      days.set(m.date, {
        date: m.date,
        kg: m.kg,
        source: "apple-health",
        updatedAt: m.updatedAt,
      });
  for (const c of state.health.checkins)
    if (c.bodyweight != null && c.date >= from && c.date <= to)
      days.set(c.date, {
        date: c.date,
        kg: c.bodyweight,
        source: "checkin",
        updatedAt: c.updatedAt,
      });
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}

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
// The date a number of days before another.
export function daysBefore(date: string, days: number) {
  const day = new Date(`${date}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() - days);
  return day.toISOString().slice(0, 10);
}

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
    weighIns(state, daysBefore(date, 7), date).at(-1)?.kg ?? null;
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

// A weight trend takes at least 4 weigh-ins over at least 14 days, the
// first and latest counted, so two weeks of daily weigh-ins make one.
// Weight swings about 0.5 kg from day to day, so two weigh-ins a week apart
// can point the wrong way: in simulation, for a real loss of 0.5 kg a week,
// about a quarter of the time.
export const TREND_MIN_WEIGH_INS = 4;
export const TREND_MIN_DAYS = 14;
export const NOT_ENOUGH_WEIGH_INS =
  "Not enough weigh-ins for a trend yet (it takes 4 spread over 14 days)";

const dayNumber = (date: string) => Date.parse(`${date}T12:00:00Z`) / 86400000;

// The weigh-ins without likely slips: one a quarter away from the middle
// reading (185 for 85, or pounds for kilograms) is passed over, as
// currentWeightKg passes over one a quarter away from the one before. With
// two or fewer there is no middle to tell a slip from a change.
export function steadyWeighIns<T extends { kg: number }>(weights: T[]) {
  if (weights.length < 3) return weights;
  const sorted = weights.map((w) => w.kg).sort((a, b) => a - b);
  const half = sorted.length / 2;
  const middle =
    sorted.length % 2
      ? sorted[Math.floor(half)]!
      : (sorted[half - 1]! + sorted[half]!) / 2;
  return weights.filter((w) => Math.abs(w.kg - middle) <= middle / 4);
}

export type WeightFit = {
  // The least-squares slope, kg a week, and its standard error.
  kgPerWeek: number;
  seKgPerWeek: number;
  // The weight on the line at the latest weigh-in.
  trendKg: number;
  weighIns: number;
  // The first and latest weigh-in's days, and the days between them.
  from: string;
  to: string;
  days: number;
};

// The least-squares line through dated weigh-ins, oldest first:
// b = 7 × Σ(t − t̄)(w − w̄) / Σ(t − t̄)² kg a week, with its standard error
// from the scatter about the line. Null for fewer than 3, or all on one
// day, when there is no line or no error to tell.
export function fitWeights(
  weights: readonly { date: string; kg: number }[],
): WeightFit | null {
  const n = weights.length;
  if (n < 3) return null;
  const t = weights.map((w) => dayNumber(w.date));
  const tMean = t.reduce((sum, x) => sum + x, 0) / n;
  const wMean = weights.reduce((sum, w) => sum + w.kg, 0) / n;
  let stt = 0,
    stw = 0;
  weights.forEach((w, i) => {
    stt += (t[i]! - tMean) ** 2;
    stw += (t[i]! - tMean) * (w.kg - wMean);
  });
  if (stt === 0) return null;
  const perDay = stw / stt;
  const scatter = weights.reduce(
    (sum, w, i) => sum + (w.kg - (wMean + perDay * (t[i]! - tMean))) ** 2,
    0,
  );
  return {
    kgPerWeek: 7 * perDay,
    seKgPerWeek: 7 * Math.sqrt(scatter / (n - 2) / stt),
    trendKg: wMean + perDay * (t.at(-1)! - tMean),
    weighIns: n,
    from: weights[0]!.date,
    to: weights.at(-1)!.date,
    days: t.at(-1)! - t[0]!,
  };
}

// The fit when there are enough weigh-ins for a trend: at least 4 over at
// least the given days, the first and latest counted (14 for a trend).
export function trendFit(
  weights: readonly { date: string; kg: number }[],
  minDays = TREND_MIN_DAYS,
) {
  const fit = fitWeights(weights);
  return fit && fit.weighIns >= TREND_MIN_WEIGH_INS && fit.days + 1 >= minDays
    ? fit
    : null;
}

const dayMonth = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });

// The weeks a fit covers, in words: "over the last 3 weeks", from its first
// weigh-in to the date, or "over 2 weeks to 12 September" when its latest
// weigh-in is more than a week before the date, so an old trend never reads
// as this week's. At least 2 weeks, the least a trend takes.
export function fitPeriod(fit: WeightFit, date: string) {
  const weeks = (days: number) => Math.max(2, Math.round(days / 7));
  return fit.to >= daysBefore(date, 7)
    ? `over the last ${weeks(dayNumber(date) - dayNumber(fit.from))} weeks`
    : `over ${weeks(fit.days)} weeks to ${dayMonth(fit.to)}`;
}

// About stable: under 0.1 kg a week, or under twice its standard error,
// when the weigh-ins can't tell it from no change.
export const aboutStable = (fit: WeightFit) =>
  Math.abs(fit.kgPerWeek) < Math.max(0.1, 2 * fit.seKgPerWeek);

export type TrendStatus = "not_enough" | "stable" | "losing" | "gaining";

// Bodyweight over the last four weeks from weigh-ins (weighIns, without
// likely slips), by least squares rather than from the first and latest
// alone: the change a week, to 0.1 kg and as a share of bodyweight, and
// the trend weight, on the line at the latest weigh-in. "About stable"
// when the change can't be told from none (aboutStable), and the weeks it
// covers (fitPeriod). With fewer than 4 weigh-ins over 14 days, not enough
// for a trend yet. Null with none.
export function weightTrend(state: JournalState, date: string, days = 28) {
  const weights = steadyWeighIns(weighIns(state, daysBefore(date, days), date));
  if (!weights.length) return null;
  const first = weights[0]!,
    last = weights.at(-1)!;
  const fit = trendFit(weights);
  const status: TrendStatus = !fit
    ? "not_enough"
    : aboutStable(fit)
      ? "stable"
      : fit.kgPerWeek < 0
        ? "losing"
        : "gaining";
  const kgPerWeek = fit && round1(fit.kgPerWeek);
  const percentPerWeek = fit && round1((100 * fit.kgPerWeek) / fit.trendKg);
  const period = fit && fitPeriod(fit, date);
  return {
    weigh_ins: weights.length,
    first: { date: first.date, kg: first.kg },
    latest: { date: last.date, kg: last.kg },
    status,
    trend_kg: fit && round1(fit.trendKg),
    kg_per_week: kgPerWeek,
    percent_per_week: percentPerWeek,
    summary:
      status === "not_enough"
        ? NOT_ENOUGH_WEIGH_INS
        : status === "stable"
          ? `About stable ${period}`
          : `${status === "losing" ? "Down" : "Up"} about ${Math.abs(kgPerWeek!)} kg a week (${Math.abs(percentPerWeek!)}% of bodyweight) ${period}`,
  };
}
export type WeightTrend = NonNullable<ReturnType<typeof weightTrend>>;

// The lowest healthy body fat (NATA: about 5 % for men, 12 % for women) and
// the very lean, lean and higher limits, by sex. Without a stated sex, the
// women's lowest healthy and very lean levels, so no plan heads leaner than
// is safe for either, and the midpoint of the others. Used for notes and
// plan limits, never to refuse a record.
export function leannessLimits(sex: "male" | "female" | "unspecified") {
  return sex === "male"
    ? { minimum: 5, veryLean: 8, lean: 12, higher: 25 }
    : sex === "female"
      ? { minimum: 12, veryLean: 16, lean: 22, higher: 32 }
      : { minimum: 12, veryLean: 16, lean: 17, higher: 28 };
}
