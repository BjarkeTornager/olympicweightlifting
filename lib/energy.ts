import type { JournalState, Workout } from "./model";
import type { CardioEntry } from "./cardio";

// Calories burned. A watch measurement is used as recorded; otherwise the
// app estimates, in code rather than by a model, and says it is an estimate.
// Estimates are for everyday context only; they never change food targets.

export type Burn = { kcal: number; estimated: boolean; method: string };

// Latest known bodyweight on or before the date.
export function bodyweightKg(state: JournalState, date: string) {
  return (
    state.profile.body?.weightKg ||
    state.profile.bodyweight ||
    [...state.health.checkins]
      .filter((c) => c.date <= date && c.bodyweight != null)
      .sort((a, b) => b.date.localeCompare(a.date))[0]?.bodyweight ||
    null
  );
}

// Metabolic equivalents from the Compendium of Physical Activities (2024),
// adjusted by speed where a distance is known.
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
      if (!speed) return 7.5;
      return speed < 16 ? 4 : speed < 19 ? 6.8 : speed < 22 ? 8 : 10;
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
      return /stair/.test(title)
        ? 9
        : /spin|bike/.test(title)
          ? 7
          : /hiit|circuit|crossfit/.test(title)
            ? 8
            : /yoga|stretch|mobility/.test(title)
              ? 2.5
              : 5;
  }
}

// Heart-rate estimate (Keytel et al. 2005) when heart rate, age and sex are
// known; it reflects the actual effort better than a table value.
function keytel(
  hr: number,
  weight: number,
  age: number,
  sex: "male" | "female",
  minutes: number,
) {
  const perMinute =
    sex === "male"
      ? (-55.0969 + 0.6309 * hr + 0.1988 * weight + 0.2017 * age) / 4.184
      : (-20.4022 + 0.4472 * hr - 0.1263 * weight + 0.074 * age) / 4.184;
  return perMinute * minutes;
}

export function cardioBurn(
  state: JournalState,
  entry: CardioEntry,
): Burn | null {
  if (entry.caloriesKcal != null)
    return {
      kcal: Math.round(entry.caloriesKcal),
      estimated: false,
      method: "measured",
    };
  const weight = bodyweightKg(state, entry.date);
  if (!weight || entry.durationSeconds <= 0) return null;
  const minutes = entry.durationSeconds / 60;
  const sex = state.profile.body?.sex;
  const age = state.profile.body?.age || state.profile.age;
  if (
    entry.averageHeartRate != null &&
    age &&
    (sex === "male" || sex === "female")
  ) {
    const kcal = keytel(entry.averageHeartRate, weight, age, sex, minutes);
    if (kcal > 0)
      return { kcal: Math.round(kcal), estimated: true, method: "heart rate" };
  }
  return {
    kcal: Math.round(met(entry) * weight * (minutes / 60)),
    estimated: true,
    method: "activity and duration",
  };
}

// Olympic weightlifting sessions are mostly rest between short efforts; the
// Compendium lists vigorous resistance training at about 5 METs overall.
export function strengthBurn(
  state: JournalState,
  workout: Workout,
): Burn | null {
  const weight = bodyweightKg(state, workout.date);
  if (!weight || !workout.startedAt || !workout.finishedAt) return null;
  const minutes =
    (Date.parse(workout.finishedAt) - Date.parse(workout.startedAt)) / 60000;
  // An unfinished session left open for hours is not training time.
  if (!(minutes >= 10 && minutes <= 240)) return null;
  return {
    kcal: Math.round(5 * weight * (minutes / 60)),
    estimated: true,
    method: "session length",
  };
}

// Calories burned in recorded training on a day, measured and estimated.
export function dayBurn(state: JournalState, date: string) {
  const burns = [
    ...state.cardio.sessions
      .filter((c) => c.date === date)
      .map((c) => cardioBurn(state, c)),
    ...state.sessions
      .filter((s) => s.date === date)
      .map((s) => strengthBurn(state, s)),
  ].filter((b): b is Burn => b != null);
  return {
    kcal: burns.reduce((sum, b) => sum + b.kcal, 0),
    estimated: burns.some((b) => b.estimated),
    count: burns.length,
  };
}

// Calories burned as the coaches see them: an estimate is always marked.
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
        calories_estimated_from: burn.estimated ? burn.method : undefined,
      }
    : {};

export const burnText = (burn: Burn | null) =>
  burn
    ? `${burn.estimated ? "~" : ""}${burn.kcal} kcal${burn.estimated ? " est." : ""}`
    : "";
