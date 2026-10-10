import type { JournalState } from "./model";
import {
  dailyTarget,
  totalNutrients,
  type DietTargets,
  type Nutrients,
} from "./nutrition";
import {
  athleteAge,
  CARBS_FLOOR_G,
  planForState,
  pregnancyCarbsFloorG,
} from "./body-goals";
import { offsetDate } from "./health";
import { targetsOn } from "./target-history";

// How a day's food reads against its targets: the same words on the
// website, the iPhone and to both coaches. Intake and targets are both
// estimates (logged intake runs about a fifth low, labels may be 20 % out,
// and prediction equations miss individuals by hundreds of kcal), so
// amounts are whole numbers, differences are rounded and close counts as
// on target. Protein is a minimum, so it is reached rather than passed;
// fat and carbohydrate are ranges. A calorie target below the athlete's
// estimated minimum, or anyone under 18, never sees "above target".

export const nutrientKeys = ["calories", "protein", "carbs", "fat"] as const;
export type NutrientKey = (typeof nutrientKeys)[number];

// Under 800 kcal a day is a very-low-energy diet, which needs a doctor or
// dietitian.
export const VERY_LOW_KCAL = 800;
// The least the app plans for without goals to work a minimum out from:
// where supervised weight-loss diets start (1,200 kcal for women; the plan
// uses 1,500 for men, whose sex is known only from the goals).
export const LEAST_KCAL = 1200;
// The minimum is an estimate that moves with the week's weigh-ins (about
// 20 kcal a kg), so a target within 50 kcal of it is not below it: the
// plan's own target at its floor stays clear of it in a heavier week.
export const MINIMUM_MARGIN_KCAL = 50;
// Within 100 kcal or a tenth of the target, whichever is more, a day is
// about on target: closer than intake can be known.
export const onTargetKcal = (target: number) => Math.max(100, target / 10);
// Fat runs from a quarter of the day's energy to 35 %, the top of the
// reference ranges (EFSA, NASEM), or from a target outside that up to a
// tenth more of the energy. Carbohydrate runs down from its target by the
// same tenth, as it is what's left after protein and fat. Without the
// energy to go by, fat runs 40 % over its target and carbohydrate a fifth
// under.
export const FAT_SHARE = { low: 0.25, high: 0.35 };
export const RANGE_SHARE = 0.1;

const whole = (n: number) => Math.round(n).toLocaleString("en-GB");
const nearest = (n: number, step: number) => Math.round(n / step) * step;
const down5 = (n: number) => Math.floor(n / 5 + 1e-9) * 5;
const up5 = (n: number) => Math.ceil(n / 5 - 1e-9) * 5;
const nb = "\u00a0";

// The least calorie target the app plans for this athlete: resting energy
// and training from the goals plan, never under 1,200 kcal (1,500 for
// men), or 1,200 kcal without goals.
export function minimumKcal(state: JournalState, today: string) {
  return planForState(state, today)?.floorKcal ?? LEAST_KCAL;
}

export type BelowMinimum = {
  // To the 50 kcal, as the note gives it.
  minimumKcal: number;
  // Under VERY_LOW_KCAL.
  veryLow: boolean;
  note: string;
};

// A calorie target more than MINIMUM_MARGIN_KCAL under the athlete's
// estimated minimum, with a plain note: it informs, never blocks, as the
// target stays theirs. The note and Coach get the minimum to the 50 kcal,
// which the margin keeps above the target.
export function belowMinimum(
  calories: number | null | undefined,
  state: JournalState,
  today: string,
): BelowMinimum | null {
  const target = dailyTarget(calories);
  if (target == null) return null;
  const minimum = minimumKcal(state, today);
  if (target >= minimum - MINIMUM_MARGIN_KCAL) return null;
  const veryLow = target < VERY_LOW_KCAL;
  const goals = state.profile.body != null;
  const rounded = nearest(minimum, 50);
  const shown = whole(rounded);
  return {
    minimumKcal: rounded,
    veryLow,
    note: veryLow
      ? `Your calorie target is in the very-low-energy range, under ${whole(VERY_LOW_KCAL)}${nb}kcal a day. Plan it with a doctor or dietitian.`
      : goals
        ? `Your calorie target is below your estimated minimum of about ${shown}${nb}kcal a day, which covers your resting energy and training. Eating this little for long can harm training and health, so ask Coach to review it with you.`
        : `Your calorie target is below about ${shown}${nb}kcal a day, the least a diet usually plans for without a doctor or dietitian. Ask Coach to review it with you.`,
  };
}

// The least carbohydrate the plan keeps: more in pregnancy and while
// breastfeeding.
export function carbsFloorG(state: JournalState) {
  const pregnancy = state.profile.goalChecks?.pregnancy;
  return pregnancy ? pregnancyCarbsFloorG[pregnancy] : CARBS_FLOOR_G;
}

export type Range = { low: number; high: number };

// Fat and carbohydrate as ranges around their targets (FAT_SHARE,
// RANGE_SHARE), to the 5 g, so the target itself is always in range. Fat's
// top is rounded down, so it never passes 35 % of energy unless its target
// does. Carbohydrate never goes under the floor the plan keeps, unless its
// target does; held there, its range runs up instead, never narrower.
export function macroRanges(
  targets: DietTargets,
  floorG: number = CARBS_FLOOR_G,
): { fat: Range | null; carbs: Range | null } {
  const kcal = dailyTarget(targets.calories);
  const protein = dailyTarget(targets.protein);
  const carbs = dailyTarget(targets.carbs);
  const fat = dailyTarget(targets.fat);
  const energy =
    kcal ??
    (protein != null && carbs != null && fat != null
      ? 4 * protein + 4 * carbs + 9 * fat
      : null);
  const room = energy == null ? null : energy * RANGE_SHARE;
  const fatRange = (g: number): Range => {
    if (energy == null || room == null)
      return { low: down5(g), high: up5(1.4 * g) };
    const low = (energy * FAT_SHARE.low) / 9;
    const high = (energy * FAT_SHARE.high) / 9;
    if (g > high) return { low: down5(g), high: up5(g + room / 9) };
    return {
      low: down5(Math.min(g, low)),
      high: Math.max(up5(g), down5(Math.min(g + room / 9, high))),
    };
  };
  const carbsRange = (g: number): Range => {
    const width = room == null ? 0.2 * g : room / 4;
    const low = Math.max(Math.min(g, floorG), g - width);
    return { low: down5(low), high: up5(Math.max(g, low + width)) };
  };
  return {
    fat: fat == null ? null : fatRange(fat),
    carbs: carbs == null ? null : carbsRange(carbs),
  };
}

// Where a nutrient stands: on_target only for calories, reached only for
// protein, in_range for fat and carbohydrate; null without a target.
export type ProgressState =
  "on_target" | "remaining" | "under" | "over" | "reached" | "in_range";

export type NutrientProgress = {
  key: NutrientKey;
  // Whole kcal or grams.
  eaten: number;
  // Calories' and protein's target, or a range for fat and carbohydrate.
  target: number | null;
  range: Range | null;
  // "about 2,400 kcal", "at least 150 g", "about 70 to 95 g".
  targetText: string | null;
  state: ProgressState | null;
  // "About 450 kcal remaining", "Reached", "In range", "No daily target";
  // empty when nothing is said, as over a target that hides it, or with
  // carbohydrate over its range.
  text: string;
};

// A day still under way (today, not marked complete) has an amount
// remaining; a day that is over, or marked complete, is under target.
type Progress = { done: boolean; hideOver: boolean };

function caloriesProgress(
  eaten: number,
  target: number | null,
  { done, hideOver }: Progress,
): NutrientProgress {
  const base = { key: "calories" as const, eaten, target, range: null };
  if (target == null)
    return {
      ...base,
      targetText: null,
      state: null,
      text: "No daily target",
    };
  const targetText = `about ${whole(target)}${nb}kcal`;
  const diff = eaten - target;
  const off = `About ${whole(nearest(Math.abs(diff), 50))}${nb}kcal`;
  if (Math.abs(diff) <= onTargetKcal(target))
    return { ...base, targetText, state: "on_target", text: "About on target" };
  if (diff < 0)
    return done
      ? { ...base, targetText, state: "under", text: `${off} under target` }
      : { ...base, targetText, state: "remaining", text: `${off} remaining` };
  return {
    ...base,
    targetText,
    state: "over",
    text: hideOver ? "" : `${off} above target`,
  };
}

// Grams short of a target or range, to the 5 g and never "0 g".
const shortBy = (grams: number) => `About ${Math.max(5, nearest(grams, 5))}`;

function proteinProgress(
  eaten: number,
  target: number | null,
  { done }: Progress,
): NutrientProgress {
  const base = { key: "protein" as const, eaten, target, range: null };
  if (target == null)
    return { ...base, targetText: null, state: null, text: "No daily target" };
  const targetText = `at least ${whole(target)}${nb}g`;
  if (eaten >= target)
    return { ...base, targetText, state: "reached", text: "Reached" };
  const short = `${shortBy(target - eaten)}${nb}g`;
  return done
    ? { ...base, targetText, state: "under", text: `${short} under target` }
    : { ...base, targetText, state: "remaining", text: `${short} remaining` };
}

// Over its range, fat is said to be, as 35 % of energy is the top of the
// reference ranges. Carbohydrate never is: it is what's left after protein
// and fat, not a ceiling (lifters do well on 3 to 5 g/kg), and calories
// already say when a day is over.
function rangeProgress(
  key: "carbs" | "fat",
  eaten: number,
  range: Range | null,
  { done, hideOver }: Progress,
): NutrientProgress {
  const base = { key, eaten, target: null, range };
  if (range == null)
    return { ...base, targetText: null, state: null, text: "No daily target" };
  const targetText =
    range.low === range.high
      ? `about ${whole(range.low)}${nb}g`
      : `about ${whole(range.low)} to ${whole(range.high)}${nb}g`;
  if (eaten < range.low) {
    const short = `${shortBy(range.low - eaten)}${nb}g`;
    return done
      ? {
          ...base,
          targetText,
          state: "under",
          text: `${short} under the range`,
        }
      : { ...base, targetText, state: "remaining", text: `${short} remaining` };
  }
  if (eaten <= range.high)
    return { ...base, targetText, state: "in_range", text: "In range" };
  return {
    ...base,
    targetText,
    state: "over",
    text:
      hideOver || key === "carbs"
        ? ""
        : `${shortBy(eaten - range.high)}${nb}g above the range`,
  };
}

export type FoodDay = {
  date: string;
  meals: number;
  // Some of it is an estimate (a photo or a description): "~" on totals.
  estimated: boolean;
  // Marked complete by the athlete.
  complete: boolean;
  // Complete, or a day already over.
  done: boolean;
  // Whole kcal and grams.
  eaten: Nutrients;
  // The targets in force that day (targetsOn), null before any.
  targets: DietTargets | null;
  belowMinimum: BelowMinimum | null;
  // Nothing past a target is shown: no "above target" text, no marks past
  // it. A calorie target below the minimum, or under 18.
  hideOver: boolean;
  progress: Record<NutrientKey, NutrientProgress>;
};

// Under 18 the app shows no "above target": growing athletes are guided
// on habits, not on eating less (AAP).
const minor = (state: JournalState) => {
  const age = athleteAge(state);
  return age != null && age < 18;
};

// A day's food against the targets in force that day.
export function foodDay(
  state: JournalState,
  date: string,
  today: string,
): FoodDay {
  const meals = state.nutrition.meals.filter((m) => m.date === date);
  const total = totalNutrients(meals.flatMap((m) => m.items));
  const eaten = {
    calories: Math.round(total.calories),
    protein: Math.round(total.protein),
    carbs: Math.round(total.carbs),
    fat: Math.round(total.fat),
  };
  const targets = targetsOn(state, date, today);
  const complete = Boolean(state.nutrition.completeDays?.includes(date));
  const done = complete || date < today;
  const below = belowMinimum(targets?.calories, state, today);
  const hideOver = below != null || minor(state);
  const progress = { done, hideOver };
  const ranges = targets
    ? macroRanges(targets, carbsFloorG(state))
    : { fat: null, carbs: null };
  return {
    date,
    meals: meals.length,
    estimated: meals.some((m) => m.estimated),
    complete,
    done,
    eaten,
    targets,
    belowMinimum: below,
    hideOver,
    progress: {
      calories: caloriesProgress(
        eaten.calories,
        dailyTarget(targets?.calories),
        progress,
      ),
      protein: proteinProgress(
        eaten.protein,
        dailyTarget(targets?.protein),
        progress,
      ),
      carbs: rangeProgress("carbs", eaten.carbs, ranges.carbs, progress),
      fat: rangeProgress("fat", eaten.fat, ranges.fat, progress),
    },
  };
}

// "1,850 kcal", or "~1,850 kcal" when some of it is an estimate.
export const eatenText = (day: FoodDay, key: NutrientKey) =>
  `${day.estimated ? "~" : ""}${whole(day.eaten[key])}${nb}${key === "calories" ? "kcal" : "g"}`;

const lower = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

// "1,850 kcal of about 2,400 kcal, about 550 kcal remaining", as the
// coaches read a nutrient; "1,850 kcal, no daily target" without one.
export function progressLine(day: FoodDay, key: NutrientKey) {
  const p = day.progress[key];
  if (!p.targetText) return `${eatenText(day, key)}, no daily target`;
  return [`${eatenText(day, key)} of ${p.targetText}`, p.text && lower(p.text)]
    .filter(Boolean)
    .join(", ");
}

export type WeekAverage = {
  // Complete days among the 7 days to the end date, today only once it is
  // marked complete.
  days: number;
  calories: number | null;
  protein: number | null;
  estimated: boolean;
  // Against the calorie targets in force on those days, when each had one.
  state: ProgressState | null;
  text: string;
};

// The average of the complete days in the 7 days to endDate, against the
// calorie targets in force on them. Partly logged days would pull it down,
// and a day still under way is partly logged until it is marked complete,
// so only days the athlete marked complete count (as the weekly review's).
export function completeDayAverage(
  state: JournalState,
  endDate: string,
  today: string,
): WeekAverage {
  const days = Array.from({ length: 7 }, (_, i) => offsetDate(endDate, -i))
    .filter((d) => d <= today && state.nutrition.completeDays?.includes(d))
    .map((d) => foodDay(state, d, today));
  if (!days.length)
    return {
      days: 0,
      calories: null,
      protein: null,
      estimated: false,
      state: null,
      text: "No complete days in the last 7. A day counts once it is marked complete, with everything logged.",
    };
  const mean = (values: number[]) =>
    Math.round(values.reduce((sum, v) => sum + v, 0) / values.length);
  const calories = mean(days.map((d) => d.eaten.calories));
  const protein = mean(days.map((d) => d.eaten.protein));
  const estimated = days.some((d) => d.estimated);
  const targets = days.map((d) => dailyTarget(d.targets?.calories));
  const status = targets.every((t) => t != null)
    ? caloriesProgress(calories, mean(targets as number[]), {
        done: true,
        hideOver:
          belowMinimum(state.nutrition.targets.calories, state, today) !=
            null || minor(state),
      })
    : null;
  const about = estimated ? "about " : "";
  return {
    days: days.length,
    calories,
    protein,
    estimated,
    state: status?.state ?? null,
    text: `${days.length} complete ${days.length === 1 ? "day" : "days"} in the last 7: ${about}${whole(calories)}${nb}kcal and ${whole(protein)}${nb}g protein a day on average${status?.text ? `, ${lower(status.text)}` : ""}.`,
  };
}
