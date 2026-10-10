import type { CoachVisual } from "./coach-visuals";
import type { JournalState } from "./model";
import { dailyTarget } from "./nutrition";
import { hydrationTargetMl } from "./hydration";
import { minimumKcal } from "./food-progress";

// A progress visual's targets for energy, protein, carbohydrate, fat or
// drinks are the athlete's own daily targets, as Food and the iPhone show
// them, never figures the model supplies (such as the goals plan's
// recalculation): the server puts the saved one in. Any other target is
// marked as suggested by Coach. A daily calorie target Coach makes up
// below the athlete's estimated minimum is refused.

type Daily = "calories" | "protein" | "carbs" | "fat" | "water";

// What a target item measures, by its label and unit; null for anything
// else (steps, sleep, body fat, a lift).
function measured(label: string, unit: string): Daily | null {
  const name = label.toLowerCase();
  const u = unit.trim().toLowerCase();
  if (u === "kcal" || (/calori|energy/.test(name) && u === ""))
    return "calories";
  if (u === "g") {
    if (/protein/.test(name)) return "protein";
    if (/carb/.test(name)) return "carbs";
    if (/\bfats?\b/.test(name) && !/body/.test(name)) return "fat";
  }
  if (
    /water|drink|hydrat|fluid/.test(name) &&
    ["ml", "l", "litre", "litres", "liter", "liters"].includes(u)
  )
    return "water";
  return null;
}

// A target for part of a day or more than one, which no daily target
// replaces: "Protein at lunch", "Calories this week".
const notDaily =
  /breakfast|lunch|dinner|supper|snack|meal|before|after|pre-|post-|session|workout|training|week|month|per /;

// A figure from 0.4 to 2.5 times the daily target is meant as the day's,
// however far off Coach's own figure is; further off, it counts something
// else, such as a meal (a third of the day or less) or several days.
const daily = (given: number, saved: number) =>
  given >= saved * 0.4 && given <= saved * 2.5;

export function withSavedTargets(
  visual: CoachVisual,
  state: JournalState,
  today: string,
): CoachVisual {
  if (visual.kind !== "progress") return visual;
  const saved = state.nutrition.targets;
  const water = hydrationTargetMl(state, today);
  return {
    ...visual,
    targets: visual.targets.map((item) => {
      // Whatever Coach's tool sent, the server decides what is suggested.
      const given = {
        label: item.label,
        value: item.value,
        target: item.target,
        unit: item.unit,
      };
      const what = measured(given.label, given.unit);
      const perDay = what != null && !notDaily.test(given.label.toLowerCase());
      const litres = given.unit.trim().toLowerCase() !== "ml";
      const savedTarget = !perDay
        ? null
        : what === "water"
          ? water.hidden
            ? null
            : litres
              ? water.targetMl / 1000
              : water.targetMl
          : dailyTarget(saved[what!]);
      if (savedTarget != null && daily(given.target, savedTarget))
        return { ...given, target: savedTarget };
      if (what === "calories" && perDay) {
        const least = minimumKcal(state, today);
        if (given.target < least)
          throw Error(
            `A daily calorie target of ${Math.round(given.target)} kcal is below the athlete's estimated minimum of about ${Math.round(least)} kcal. Show their saved daily target (dailyTargets), or none; never one of your own below it.`,
          );
      }
      return { ...given, suggested: true };
    }),
  };
}
