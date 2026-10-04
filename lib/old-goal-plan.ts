import { latestBodyFat, type BodyFocus } from "./body-composition";
import type { BodyGoals } from "./body-goals";
import type { JournalState } from "./model";
import { dailyTarget } from "./nutrition";
import { localClock, timeZoneSchema } from "./reminders";

// Daily targets saved before 4 October 2026 carry no record of where they
// came from (target-history.ts). The plan as it was then is kept here to
// recognise them: the release check brings those that break a hard limit
// back to the plan (legacy-goal-targets.ts), and the plan suggests new
// targets only beside its own, never beside ones set by hand
// (target-proposals.ts). Nothing here reads the database, so the website
// can use it too.

const round = (value: number, step = 1) => Math.round(value / step) * step;
// The old plan's rate limits by body fat, as they were then.
export const oldLimits = {
  male: { lean: 12, higher: 25 },
  female: { lean: 22, higher: 32 },
  unspecified: { lean: 17, higher: 28 },
};

// What planGoals gave before the safety limits, frozen to recognise its
// targets; never used to plan. Fat and carbohydrate came from the unrounded
// calories until 2026-10-04 and from the rounded ones after, so both count.
export function oldPlan(
  g: BodyGoals,
  today: string,
  composition: { focus?: BodyFocus; bodyFatPercent: number | null },
) {
  const bodyFat = composition.bodyFatPercent;
  const lean = bodyFat == null ? null : g.weightKg * (1 - bodyFat / 100);
  const sexTerm = g.sex === "male" ? 5 : g.sex === "female" ? -161 : -78;
  const resting =
    lean != null
      ? 370 + 21.6 * lean
      : 10 * g.weightKg + 6.25 * g.heightCm - 5 * g.age + sexTerm;
  const training = (g.trainingDays * g.sessionMinutes * 0.075 * g.weightKg) / 7;
  const maintenance =
    resting * { low: 1.2, moderate: 1.375, high: 1.55 }[g.activity] + training;
  const difference = g.targetWeightKg - g.weightKg;
  const direction =
    Math.abs(difference) < 0.5 ? "maintain" : difference < 0 ? "lose" : "gain";
  const focus =
    composition.focus ??
    (direction === "lose"
      ? "lose_fat"
      : direction === "gain"
        ? "build_muscle"
        : "maintain");
  const limits = oldLimits[g.sex];
  const loseRate =
    bodyFat == null
      ? 0.005
      : bodyFat >= limits.higher
        ? 0.0075
        : bodyFat <= limits.lean
          ? 0.004
          : 0.005;
  const gainRate = { new: 0.0035, developing: 0.0025, experienced: 0.0015 }[
    g.experience
  ];
  const maxRate =
    g.weightKg *
    (focus === "recomposition"
      ? Math.min(0.0025, direction === "lose" ? loseRate : gainRate)
      : direction === "lose"
        ? loseRate
        : gainRate);
  let rate = direction === "maintain" ? 0 : maxRate;
  if (direction !== "maintain" && g.targetDate) {
    const days = (Date.parse(g.targetDate) - Date.parse(today)) / 86400000;
    if (days >= 7) rate = Math.min(Math.abs(difference) / (days / 7), maxRate);
  }
  const change = (rate * 7700) / 7;
  let calories = maintenance + (direction === "lose" ? -change : change);
  if (focus === "recomposition" && direction === "maintain")
    calories = maintenance * 0.95;
  if (calories < resting) calories = resting;
  const losing = direction === "lose" || focus === "recomposition";
  const protein =
    lean != null
      ? round(lean * (losing ? 2.5 : 2.2))
      : round(g.weightKg * (losing ? 2 : 1.8));
  const kcal = round(calories, 10);
  const macros = [calories, kcal].map((energy) => {
    const fat = round(Math.max(g.weightKg * 0.8, (energy * 0.25) / 9));
    return {
      fat,
      carbs: round(Math.max(0, (energy - protein * 4 - fat * 9) / 4)),
    };
  });
  return {
    goal: direction,
    calories: kcal,
    protein,
    macros,
    deficit: maintenance - calories,
    // Resting energy plus training, never under 1,200 kcal (1,500 for men):
    // today's floor for these goals.
    floor: Math.max(resting + training, g.sex === "male" ? 1500 : 1200),
    unrounded: calories,
    bodyFat,
  };
}

// The old plan the saved targets are, worked out for the day the goals
// were saved, in the time zone given or UTC, with the body fat known then;
// undefined when they aren't its.
export function oldPlanOfTargets(state: JournalState, timezone: string) {
  const body = state.profile.body;
  if (!body) return undefined;
  const saved = state.nutrition.targets;
  const days = new Set([
    localClock(new Date(body.updatedAt), timezone).date,
    body.updatedAt.slice(0, 10),
  ]);
  return [...days]
    .map((day) =>
      oldPlan(body, day, {
        focus: state.profile.bodyTargets?.focus,
        bodyFatPercent: latestBodyFat(state, day)?.percent ?? null,
      }),
    )
    .find(
      (p) =>
        p.goal === saved.goal &&
        p.calories === saved.calories &&
        p.protein === saved.protein &&
        p.macros.some((m) => m.fat === saved.fat && m.carbs === saved.carbs),
    );
}

// Whether targets saved before records were kept are the plan's: what the
// old plan gave for the saved goals (oldPlanOfTargets), or what the plan
// gave from 4 October 2026, with its safety limits, at the goals' save or
// at the release check. That plan's fat was a quarter of the calories, or
// 0.8 g per kg of the goals' weight when more, and carbohydrate the rest,
// with the goal its own or maintain; in pregnancy it saved none. Targets
// set by hand, a number or two changed, almost never add up that way.
export function savedByOldPlan(state: JournalState) {
  const body = state.profile.body;
  if (!body) return false;
  const zone = timeZoneSchema.safeParse(state.profile.timezone).success
    ? state.profile.timezone!
    : "Europe/Copenhagen";
  if (oldPlanOfTargets(state, zone)) return true;
  const t = state.nutrition.targets;
  const [calories, protein, carbs, fat] = (
    ["calories", "protein", "carbs", "fat"] as const
  ).map((key) => dailyTarget(t[key]));
  if (calories == null)
    return (
      t.goal === "maintain" && protein == null && carbs == null && fat == null
    );
  if (protein == null || carbs == null || fat == null) return false;
  const difference = body.targetWeightKg - body.weightKg;
  const goal = difference < 0 ? "lose" : "gain";
  const fatFor = round(Math.max(body.weightKg * 0.8, (calories * 0.25) / 9));
  return (
    (t.goal === "maintain" || t.goal === goal) &&
    fat === fatFor &&
    carbs === round(Math.max(0, (calories - protein * 4 - fat * 9) / 4))
  );
}
