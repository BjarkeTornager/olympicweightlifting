import type { JournalState, Workout } from "./model";
import type { CardioActivity, CardioEntry } from "./cardio";
import { sessionMinutes } from "./session-length";

// Calories burned. Every figure is an estimate, a watch's included, and every
// figure is net: energy above rest, as Apple's active energy is. Without a
// recorded figure the app estimates in code rather than by a model. These are
// for everyday context only; they never change food targets.

export type Burn = { kcal: number; estimated: boolean; method: string };

// Lifting at Compendium code 02052 (squats, deadlifts, slow or explosive: 5
// METs) less the 1 MET of rest. Measured sessions with long rests come out
// lower, so this is a rough figure at the generous end.
export const LIFTING_NET_KCAL_PER_KG_HOUR = 4;

// To the nearest 10 kcal: the figures are not more precise than that.
const tens = (kcal: number) => Math.round(kcal / 10) * 10;

// Within a quarter of each other: a real change between two weighings, or
// from an older weight in Settings, where a typo (185 for 85) or pounds for
// kilograms are not.
const near = (a: number, b?: number | null) =>
  b != null && b > 0 && Math.abs(a - b) <= b / 4;

// Bodyweight for a date: the latest check-in weight from the 30 days up to
// it, then the weight in Settings, then the one given when setting goals. A
// check-in far from both the weight already trusted and the weighing before
// it is passed over as a likely slip, so one typo can't double every
// estimate or the drinks target; the next weighing that agrees with it is
// trusted again.
export function bodyweightKg(state: JournalState, date: string) {
  const profile = state.profile.bodyweight || state.profile.body?.weightKg;
  let trusted: { kg: number; date: string } | null = null;
  let previous: number | null = null;
  for (const c of state.health.checkins
    .filter((c) => c.bodyweight != null && c.date <= date)
    .sort((a, b) => a.date.localeCompare(b.date))) {
    const kg = c.bodyweight!;
    const reference = trusted?.kg ?? profile;
    if (!reference || near(kg, reference) || near(kg, previous))
      trusted = { kg, date: c.date };
    previous = kg;
  }
  const recent =
    trusted && Date.parse(date) - Date.parse(trusted.date) <= 30 * 86400000;
  return (recent && trusted?.kg) || profile || null;
}

// A value between Compendium bands, so a speed never jumps a whole band.
function between(x: number, points: [number, number][]) {
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x0, y0] = points[i - 1];
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return points.at(-1)![1];
}
// Bicycling by speed in km/h, at the middle of each Compendium band: leisure,
// 16-19, 19-22, 22-26 and 26-31 km/h.
const cyclingMets: [number, number][] = [
  [13, 4],
  [17.5, 6.8],
  [20.9, 8],
  [24, 10],
  [28, 12],
];
// Apple Health's other workouts, and typed titles in English or Danish, in
// order: the first match wins. Martial arts, boxing, climbing and cross
// training are between Compendium entries.
const titledMets: [RegExp, number][] = [
  [/stair ?(master|stepper|machine|climb)|trappemaskine/, 9.3],
  [/stairs|trappe/, 6.8],
  [/jump ?rope|skipping|sjippe/, 11],
  [/cross-?country|langrend/, 8.5],
  [/ski|snowboard/, 6.3],
  [/hiit|circuit|crossfit|cirkel/, 8],
  [/mixed cardio/, 7.3],
  [/spin|bike|cykel/, 7],
  [/martial|karate|judo|kampsport/, 7.5],
  [/box/, 7],
  [/climb|klatr|boulder/, 7],
  [/football|soccer|fodbold/, 7],
  [/table tennis|bordtennis/, 4],
  [/tennis/, 6.8],
  [/cross ?training/, 6],
  [/badminton/, 5.5],
  [/danc|dans/, 5],
  [/golf/, 4.3],
  [/core/, 3.8],
  [/pilates/, 2.8],
  [/yoga/, 2.5],
  [/stretch|flexib|cool ?down|recover|mobilit|udstr/, 2.3],
  [/strength|styrke/, 5],
];

// Metabolic equivalents from the Compendium of Physical Activities (2024),
// adjusted by speed where a distance is known. These are gross: 1 MET is rest.
function met(entry: CardioEntry) {
  const hours = entry.durationSeconds / 3600;
  const speed =
    entry.distanceKm != null && hours > 0 ? entry.distanceKm / hours : null;
  const title = `${entry.title ?? ""}`.toLowerCase();
  switch (entry.activity) {
    case "running":
      // Roughly one MET per km/h across ordinary running speeds.
      return speed ? Math.min(16, Math.max(6, speed)) : 9.8;
    case "cycling":
      return speed ? between(speed, cyclingMets) : 7.5;
    case "walking":
      if (!speed) return 3.5;
      return speed < 4 ? 2.8 : speed < 5.5 ? 3.5 : speed < 6.5 ? 5 : 7;
    case "swimming":
      return 7;
    case "rowing":
      return 7;
    case "hiking":
      return 6;
    case "elliptical":
      return 5;
    default:
      return titledMets.find(([pattern]) => pattern.test(title))?.[1] ?? 5;
  }
}

// Steady work of the kind Keytel's equation was derived from.
const steadyCardio = new Set<CardioActivity>([
  "running",
  "cycling",
  "rowing",
  "elliptical",
  "walking",
  "hiking",
]);

// Heart-rate estimate (Keytel et al. 2005, without VO2max), gross kcal. It
// was derived from adults aged 18 to 45 in steady treadmill or cycle work at
// about 57-90 % of maximum heart rate, so it is used only there: from 46 to
// 65 as a marked extrapolation, and never for lifting, where heart rate runs
// high for the energy used.
function keytel(
  entry: CardioEntry,
  weight: number,
  age: number,
  sex: "male" | "female",
) {
  const hr = entry.averageHeartRate;
  const minutes = entry.durationSeconds / 60;
  if (hr == null || !steadyCardio.has(entry.activity) || minutes < 10)
    return null;
  if (!(age >= 18 && age <= 65)) return null;
  const maxHr = Math.max(entry.maxHeartRate ?? 0, 208 - 0.7 * age);
  if (hr < 0.6 * maxHr || hr > 0.9 * maxHr) return null;
  const perMinute =
    sex === "male"
      ? (-55.0969 + 0.6309 * hr + 0.1988 * weight + 0.2017 * age) / 4.184
      : (-20.4022 + 0.4472 * hr - 0.1263 * weight + 0.074 * age) / 4.184;
  return { gross: perMinute * minutes, extrapolated: age > 45 };
}

// A recorded 0 for a workout of five minutes or more is a gap, not a reading.
const recordedKcal = (entry: CardioEntry) =>
  entry.caloriesKcal != null &&
  !(entry.caloriesKcal === 0 && entry.durationSeconds >= 300)
    ? entry.caloriesKcal
    : null;

// An activity's calories: its recorded figure, labelled with where it came
// from (Apple Health's workouts carry the watch's or the recording app's own
// estimate), else the app's estimate from heart rate or the activity's table
// value. The source is kept on the entry, so every screen and Coach give an
// entry the same figure and label.
export function cardioBurn(
  state: JournalState,
  entry: CardioEntry,
): Burn | null {
  const recorded = recordedKcal(entry);
  if (recorded != null) {
    // Saved before sources were kept: a photo, or else unknown.
    const source =
      entry.caloriesSource ?? (entry.photoIds?.length ? "photo" : "recorded");
    return source === "apple-health"
      ? { kcal: tens(recorded), estimated: true, method: "watch" }
      : { kcal: Math.round(recorded), estimated: true, method: source };
  }
  const weight = bodyweightKg(state, entry.date);
  const hours = entry.durationSeconds / 3600;
  // Longer than six hours is more likely a typing slip than one activity.
  if (!weight || hours <= 0 || hours > 6) return null;
  const rest = weight * hours;
  const table = (met(entry) - 1) * rest;
  if (table > 3000) return null;
  const sex = state.profile.body?.sex;
  const age = state.profile.body?.age || state.profile.age;
  const heart =
    age && (sex === "male" || sex === "female")
      ? keytel(entry, weight, age, sex)
      : null;
  const net = heart ? heart.gross - rest : 0;
  // Heart rate refines the table value, but one far from it is more likely
  // a sensor or an equation out of its depth than the actual effort.
  if (heart && net >= table / 1.5 && net <= table * 1.5)
    return {
      kcal: tens(net),
      estimated: true,
      method: heart.extrapolated
        ? "heart rate, extrapolated beyond age 45"
        : "heart rate",
    };
  return {
    kcal: tens(table),
    estimated: true,
    method: "activity and duration",
  };
}

// A lifting session from how long it took (see sessionMinutes): none for an
// untimed one, or one too short or long to be a session.
export function strengthBurn(
  state: JournalState,
  workout: Workout,
): Burn | null {
  const weight = bodyweightKg(state, workout.date);
  const minutes = sessionMinutes(workout);
  if (!weight || minutes == null) return null;
  // An unfinished session left open for hours is not training time.
  if (!(minutes >= 10 && minutes <= 240)) return null;
  return {
    kcal: tens(LIFTING_NET_KCAL_PER_KG_HOUR * weight * (minutes / 60)),
    estimated: true,
    method: "session length",
  };
}

// Recorded training on a day, net of rest. Entries without a figure are
// counted apart, so a total never silently leaves them out: lifting without a
// recorded length, and, when the weight is known, a session or activity too
// short or long for the app to estimate.
export function dayBurn(state: JournalState, date: string) {
  const lifting = state.sessions.filter((s) => s.date === date);
  const burns = [
    ...state.cardio.sessions
      .filter((c) => c.date === date)
      .map((c) => cardioBurn(state, c)),
    ...lifting.map((s) => strengthBurn(state, s)),
  ];
  const counted = burns.filter((b): b is Burn => b != null);
  const untimed = lifting.filter((s) => sessionMinutes(s) == null).length;
  return {
    kcal: tens(counted.reduce((sum, b) => sum + b.kcal, 0)),
    estimated: true,
    count: counted.length,
    untimed,
    unestimated: bodyweightKg(state, date)
      ? burns.length - counted.length - untimed
      : 0,
  };
}

// The day's calories burned, as Today shows them and Coach reads them, in two
// figures that are never added together: Apple Health's active energy, which
// counts all movement but only the lifting a watch saw, and the training
// recorded in the journal.
export type DayBurned = {
  active: {
    kcal: number;
    unusual: boolean;
    syncedAt: string;
  } | null;
  training: {
    kcal: number;
    count: number;
    untimed: number;
    unestimated: number;
  } | null;
};
// Apple Health's active energy for a day, kept within 0-10,000 kcal.
export const activeEnergyKcal = (kcal: number) =>
  tens(Math.min(10000, Math.max(0, kcal)));
// Above 6,000 kcal: shown, but worth checking in Apple Health.
export const unusualActiveEnergy = (kcal: number) => kcal > 6000;
export function burnedToday(
  state: JournalState,
  date: string,
): DayBurned | null {
  const vitals = state.health.vitals?.find((v) => v.date === date);
  const active =
    vitals?.activeEnergyKcal != null
      ? {
          kcal: activeEnergyKcal(vitals.activeEnergyKcal),
          unusual: unusualActiveEnergy(vitals.activeEnergyKcal),
          syncedAt: vitals.updatedAt,
        }
      : null;
  const { kcal, count, untimed, unestimated } = dayBurn(state, date);
  const training =
    count || untimed || unestimated
      ? { kcal, count, untimed, unestimated }
      : null;
  return active || training ? { active, training } : null;
}

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;
const kcalText = (kcal: number) => `~${kcal.toLocaleString("en-GB")}`;

// What a training figure leaves out, in words: "1 session without a recorded
// length and 2 entries too short or long to estimate", or "".
export const notCounted = (untimed: number, unestimated: number) =>
  [
    untimed &&
      `${plural(untimed, "session", "sessions")} without a recorded length`,
    unestimated &&
      `${plural(unestimated, "entry", "entries")} too short or long to estimate`,
  ]
    .filter(Boolean)
    .join(" and ");

// Today's burned figures line by line, the first one leading: what the
// website and the iPhone print.
export type BurnedLine = {
  label: string;
  kcal: number;
  // "~610": the figure as printed, always marked as an estimate; empty when
  // nothing recorded that day has a figure.
  text: string;
  note: string;
};
export function burnedLines(b: DayBurned): BurnedLine[] {
  const lines: BurnedLine[] = [];
  if (b.active)
    lines.push({
      label: "Active energy",
      kcal: b.active.kcal,
      text: kcalText(b.active.kcal),
      note: b.active.unusual
        ? "Apple Health, so far; unusually high, worth checking there"
        : "Apple Health, so far",
    });
  if (b.training) {
    const { kcal, count, untimed, unestimated } = b.training;
    const left = notCounted(untimed, unestimated);
    lines.push({
      label: "Training",
      kcal,
      text: count ? kcalText(kcal) : "",
      note: !left
        ? "Estimated"
        : count
          ? `Estimated, not counting ${left}`
          : `No estimate for ${left}`,
    });
  }
  return lines;
}
export const burnedContext =
  "Doesn't include the energy your body uses at rest.";

// How each recorded figure is labelled where it is shown.
const recordedText: Record<string, string> = {
  watch: "watch",
  photo: "from the photo",
  entered: "as entered",
  recorded: "as recorded",
};

// Where a recorded figure came from, as the coaches read it.
const recordedFrom: Record<string, string> = {
  watch: "the watch or app that recorded it, through Apple Health",
  photo: "read from a photo",
  entered: "typed in",
  recorded: "recorded by a watch or app, or typed in",
};

// Calories burned as the coaches see them: always an estimate, with where it
// came from.
export const burnFields = (
  burn: Burn | null,
): {
  calories_kcal?: number;
  calories_estimated?: boolean;
  calories_estimated_from?: string;
} =>
  burn
    ? {
        calories_kcal: burn.kcal,
        calories_estimated: burn.estimated,
        calories_estimated_from: recordedFrom[burn.method] ?? burn.method,
      }
    : {};

export const burnText = (burn: Burn | null) =>
  burn
    ? `${kcalText(burn.kcal)} kcal${recordedText[burn.method] ? ` · ${recordedText[burn.method]}` : " est."}`
    : "";
