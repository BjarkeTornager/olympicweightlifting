import { z } from "zod";
import {
  dailyTarget,
  dietTargetsSchema,
  foodDate,
  type DietTargets,
} from "./nutrition";
import { daysBefore, weighIns } from "./body-composition";
import { localClock, timeZoneSchema } from "./reminders";
import { savedByOldPlan } from "./old-goal-plan";
import type { JournalState } from "./model";

// Where the daily targets came from, and when: the plan's, from the goals or
// a suggestion the athlete took, or their own, set by hand or with Coach.
// Each change is kept in profile.targetHistory, beside nutrition.targets
// (whose shape older versions of the app check strictly), so Trends can
// draw the target that applied each day, and the plan can tell what has
// changed since the targets were set. Saved targets change only when the
// athlete sets or accepts them; the plan only suggests (target-proposals).
export const targetSources = ["plan", "manual"] as const;
export type TargetSource = (typeof targetSources)[number];
const kg = z.number().finite().min(20).max(500);
export const targetRecordSchema = z
  .object({
    ...dietTargetsSchema.shape,
    // Null for targets saved before records were kept, or by an older
    // version of the app.
    source: z.enum(targetSources).nullable(),
    // The day they apply from, in the athlete's time zone; null for the
    // targets in force before records were kept.
    from: foodDate.nullable(),
    setAt: z.iso.datetime().nullable(),
    // The weight the plan used, or the current weight for the athlete's
    // own, and the lean mass when a body fat reading gave one.
    weightKgAtSet: kg.nullable(),
    leanMassKgAtSet: z.number().finite().min(10).max(300).optional(),
  })
  .strict();
export type TargetRecord = z.infer<typeof targetRecordSchema>;
// A suggestion the athlete chose not to take, keeping their targets: it
// isn't offered again until the plan moves on from it.
export const declinedTargetsSchema = z
  .object({
    ...dietTargetsSchema.shape,
    date: foodDate,
    at: z.iso.datetime(),
    weightKg: kg.nullable(),
    leanMassKg: z.number().finite().min(10).max(300).nullable(),
  })
  .strict();
export type DeclinedTargets = z.infer<typeof declinedTargetsSchema>;
// About a year of changes, made every few days.
export const TARGET_HISTORY_MAX = 200;

const round1 = (n: number) => Math.round(n * 10) / 10;
const dayAfter = (date: string) => daysBefore(date, -1);

// The same goal and the same targets, a target of 0 counting as none.
export function sameTargets(a: DietTargets, b: DietTargets) {
  return (
    a.goal === b.goal &&
    (["calories", "protein", "carbs", "fat"] as const).every(
      (key) => dailyTarget(a[key]) === dailyTarget(b[key]),
    )
  );
}
const targetsOf = (r: DietTargets): DietTargets => ({
  goal: r.goal,
  calories: r.calories,
  protein: r.protein,
  carbs: r.carbs,
  fat: r.fat,
});
const anyTarget = (t: DietTargets) =>
  t.goal !== "maintain" ||
  (["calories", "protein", "carbs", "fat"] as const).some(
    (key) => dailyTarget(t[key]) != null,
  );

// The day an instant fell on for the athlete: their time zone, else
// Copenhagen's, where most athletes are.
export function localDay(at: string, state: JournalState) {
  const zone = timeZoneSchema.safeParse(state.profile.timezone).success
    ? state.profile.timezone!
    : "Europe/Copenhagen";
  return localClock(new Date(at), zone).date;
}

const records = (state: JournalState) => state.profile.targetHistory ?? [];

// The saved targets as a record: the latest one when it matches them.
// Otherwise they were saved before records were kept, and are the plan's
// when they are what it gave then (savedByOldPlan), else the athlete's own;
// or they were saved since by an older version of the app, most likely by
// hand, and count as the athlete's own. Nothing else is known about them.
export function targetsInForce(state: JournalState): TargetRecord & {
  recorded: boolean;
} {
  const saved = state.nutrition.targets;
  const latest = records(state).at(-1);
  if (latest && sameTargets(latest, saved))
    return { ...latest, ...targetsOf(saved), recorded: true };
  return {
    ...targetsOf(saved),
    source: !latest && savedByOldPlan(state) ? "plan" : "manual",
    from: null,
    setAt: null,
    weightKgAtSet: null,
    recorded: false,
  };
}

// The saved protein target as the athlete's own figure (their doctor's or
// dietitian's, perhaps), which stays beside a plan that sets none. Null
// when the saved targets are the plan's from before records were kept: it
// set protein for everyone then, breastfeeding included, so that protein
// is the plan's, not theirs.
export function ownProtein(
  state: JournalState,
  set: TargetRecord & { recorded: boolean } = targetsInForce(state),
) {
  return !set.recorded && set.source === "plan"
    ? null
    : dailyTarget(state.nutrition.targets.protein);
}

// Saves the daily targets with where they came from, adding them to the
// history; a suggestion kept over before goes, as these targets replace
// what it was compared with. Targets saved without a record (before
// records, or by an older version of the app) are recorded first, so the
// history still holds them.
export function recordTargets(
  state: JournalState,
  targets: DietTargets,
  today: string,
  provenance: {
    source: TargetSource;
    weightKg: number | null;
    leanMassKg?: number | null;
    at?: string;
  },
) {
  const history = [...records(state)];
  const before = state.nutrition.targets;
  const latest = history.at(-1);
  if (!latest ? anyTarget(before) : !sameTargets(latest, before))
    history.push({
      ...targetsOf(before),
      source: null,
      from: latest?.from ? [dayAfter(latest.from), today].sort()[0]! : null,
      setAt: null,
      weightKgAtSet: null,
    });
  const weight =
    provenance.weightKg != null && kg.safeParse(provenance.weightKg).success
      ? round1(provenance.weightKg)
      : null;
  history.push(
    targetRecordSchema.parse({
      ...targetsOf(targets),
      source: provenance.source,
      from: today,
      setAt: provenance.at ?? new Date().toISOString(),
      weightKgAtSet: weight,
      ...(provenance.leanMassKg != null && {
        leanMassKgAtSet: round1(provenance.leanMassKg),
      }),
    }),
  );
  state.nutrition.targets = targetsOf(targets);
  state.profile.targetHistory = history.slice(-TARGET_HISTORY_MAX);
  delete state.profile.declinedTargets;
}

// The targets that applied on a day: the last set on or before it. Saved
// targets without a record count from the day after the last record (today
// at the latest), and with no records at all, the saved targets count for
// every day, as before records were kept. Null before any target was set.
export function targetsOn(
  state: JournalState,
  date: string,
  today: string,
): DietTargets | null {
  const history = records(state);
  const saved = state.nutrition.targets;
  if (!history.length) return targetsOf(saved);
  const latest = history.at(-1)!;
  const all: { from: string | null; targets: DietTargets }[] = history.map(
    (r) => ({ from: r.from, targets: targetsOf(r) }),
  );
  if (!sameTargets(latest, saved))
    all.push({
      from: latest.from ? [dayAfter(latest.from), today].sort()[0]! : null,
      targets: targetsOf(saved),
    });
  return (
    all.filter((r) => r.from == null || r.from <= date).at(-1)?.targets ?? null
  );
}

// The weight given in Settings since the app recorded when, and that day.
function settingsWeight(state: JournalState) {
  const { bodyweight, bodyweightSetAt } = state.profile;
  return bodyweight > 0 && bodyweightSetAt
    ? {
        kg: bodyweight,
        day: localDay(bodyweightSetAt, state),
        at: bodyweightSetAt,
      }
    : null;
}

// Saves the weight given in Settings, with when, so it counts from then as
// the goals' weight does; 0 removes it.
export function setSettingsWeight(
  state: JournalState,
  kg: number,
  at = new Date().toISOString(),
) {
  if (kg === state.profile.bodyweight) return;
  state.profile.bodyweight = kg;
  if (kg > 0) state.profile.bodyweightSetAt = at;
  else delete state.profile.bodyweightSetAt;
}

// The weight the athlete last gave, and when: with the goals, in Settings,
// or the current weight when they took the plan's targets. Weigh-ins from
// before then don't count towards the current weight, so the plan right
// after saving is the one they saw.
function weightAnchor(state: JournalState) {
  const body = state.profile.body;
  const plan = [...records(state)]
    .reverse()
    .find(
      (r) =>
        r.source === "plan" &&
        r.setAt != null &&
        r.from != null &&
        r.weightKgAtSet != null,
    );
  return (
    [
      plan && { kg: plan.weightKgAtSet!, day: plan.from!, at: plan.setAt! },
      body && {
        kg: body.weightKg,
        day: localDay(body.updatedAt, state),
        at: body.updatedAt,
      },
      settingsWeight(state),
    ]
      .filter((a): a is { kg: number; day: string; at: string } => Boolean(a))
      // The latest; the plan's record before the goals saved with it.
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0] ?? null
  );
}

// The weight nearest a day, to pair with a body fat reading taken then, so
// the lean mass it gives stays the one measured as the weight changes:
// the weight given with the goals or in Settings, a weigh-in (weighIns),
// or a weight the daily targets were set at (the goals' weight before they
// were saved again), whichever is closest in days, one on or before the
// day first. On the same day the weight given comes first, as a reading
// given with the goals goes with it, then a weigh-in. given is a weight
// being given with goals not saved yet. Null with no weight at all.
export function weightNearKg(
  state: JournalState,
  date: string,
  given?: { day: string; kg: number },
) {
  const body = state.profile.body;
  const settings = settingsWeight(state);
  const known = [
    ...(given ? [{ ...given, rank: 0 }] : []),
    ...(body
      ? [{ day: localDay(body.updatedAt, state), kg: body.weightKg, rank: 0 }]
      : []),
    ...(settings ? [{ day: settings.day, kg: settings.kg, rank: 0 }] : []),
    ...weighIns(state, "0001-01-01", "9999-12-31").map((w) => ({
      day: w.date,
      kg: w.kg,
      rank: 1,
    })),
    ...records(state).flatMap((r) =>
      r.from != null && r.weightKgAtSet != null
        ? [{ day: r.from, kg: r.weightKgAtSet, rank: 2 }]
        : [],
    ),
  ];
  const apart = (day: string) => Math.abs(Date.parse(day) - Date.parse(date));
  const after = (day: string) => Number(day > date);
  known.sort(
    (a, b) =>
      apart(a.day) - apart(b.day) ||
      after(a.day) - after(b.day) ||
      a.rank - b.rank,
  );
  return known[0]?.kg ?? null;
}

// Within a quarter of each other: a real change between two weighings,
// where a slip (185 for 85, or pounds for kilograms) is not.
const near = (a: number, b: number | null) =>
  b != null && b > 0 && Math.abs(a - b) <= b / 4;

// The athlete's current weight, to 0.1 kg: the average of the weigh-ins in
// the 7 days up to the date (a check-in, else Apple Health's first reading
// of the day), else the latest weigh-in, else the weight given with the
// goals or in Settings. The weight given with the goals, or since in
// Settings, counts as that day's weigh-in, and earlier ones don't count,
// as it is the athlete's latest word on it. A weigh-in a quarter away from
// the one before is passed over as a likely slip; when the next one agrees
// with it, the weight has really changed, and the two start afresh without
// the ones before. Until a weight is backed up, by the goals, Settings or
// two weigh-ins in a row that agree, the latest weigh-in is taken as
// given, so a slip in the very first one lasts only until the next.
export function currentWeightKg(state: JournalState, date: string) {
  const anchor = weightAnchor(state);
  const since = anchor && anchor.day <= date ? anchor : null;
  const readings = weighIns(state, "0001-01-01", date)
    .filter(
      (w) =>
        !since ||
        w.date > since.day ||
        (w.date === since.day &&
          Date.parse(w.updatedAt) > Date.parse(since.at)),
    )
    .map((w) => ({ date: w.date, kg: w.kg }));
  if (since && !readings.some((r) => r.date === since.day))
    readings.unshift({ date: since.day, kg: since.kg });
  let trusted: number | null = since?.kg ?? (state.profile.bodyweight || null);
  let backed = trusted != null;
  let previous: (typeof readings)[number] | null = null;
  let kept: typeof readings = [];
  for (const r of readings) {
    const fits = near(r.kg, trusted);
    const repeats = !fits && previous != null && near(r.kg, previous.kg);
    if (fits) kept.push(r);
    else if (repeats) kept = [previous!, r];
    else if (!backed) kept = [r];
    if (fits || repeats || !backed) trusted = r.kg;
    backed ||= fits || repeats;
    previous = r;
  }
  const week = kept.filter((r) => r.date >= daysBefore(date, 6));
  const weight = week.length
    ? week.reduce((sum, r) => sum + r.kg, 0) / week.length
    : (kept.at(-1)?.kg ?? anchor?.kg ?? (state.profile.bodyweight || null));
  return weight == null ? null : round1(weight);
}
