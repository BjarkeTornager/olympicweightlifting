import {
  repeatMeal,
  totalNutrients,
  retainFoodClassifications,
} from "../nutrition";
import { saveCardio, cardioTitle } from "../cardio";
import { saveCheckin } from "../health";
import { uid } from "../domain";
import type { JournalState } from "../model";
import type { ActionOf, PreparedChange } from "./actions";

// Logging a meal on a day reopens that day's "food complete" flag.
function reopenFoodDays(next: JournalState, ...dates: (string | undefined)[]) {
  if (next.nutrition.completeDays)
    next.nutrition.completeDays = next.nutrition.completeDays.filter(
      (d) => !dates.includes(d),
    );
}

export function prepareRepeatMeal(
  next: JournalState,
  action: ActionOf<"repeat_meal">,
  currentDate: string,
): PreparedChange {
  const original =
    next.nutrition.meals.find((m) => m.id === action.mealId) ??
    next.nutrition.favourites?.find((m) => m.id === action.mealId);
  if (!original) throw Error("That meal or favourite is not in your journal.");
  if (action.date > currentDate)
    throw Error("Meals eaten cannot be dated in the future.");
  const meal = repeatMeal(original, action.date);
  next.nutrition.meals.push(meal);
  reopenFoodDays(next, action.date);
  return {
    meal,
    title: "Repeat a meal",
    detail:
      "Copies the saved portions, nutrition and ingredient tags. Photos from the earlier meal are not attached to this new entry. Review whether the portions were the same.",
  };
}

export function prepareMeal(
  next: JournalState,
  action: ActionOf<"record_meal" | "update_meal">,
  currentDate: string,
): PreparedChange {
  if (action.meal.date > currentDate)
    throw Error("Meals eaten cannot be dated in the future.");
  const existing =
    action.kind === "update_meal"
      ? next.nutrition.meals.find((m) => m.id === action.mealId)
      : undefined;
  if (action.kind === "update_meal" && !existing)
    throw Error("That meal is not in your food journal.");
  const meal = {
    ...action.meal,
    items: retainFoodClassifications(action.meal.items, existing?.items ?? []),
    id: existing?.id ?? uid(),
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  };
  next.nutrition.meals = [
    ...next.nutrition.meals.filter((m) => m.id !== meal.id),
    meal,
  ];
  reopenFoodDays(next, meal.date, existing?.date);
  const totals = totalNutrients(meal.items);
  return {
    meal,
    title: existing ? "Update your meal" : "Log your meal",
    detail: `${totals.calories} kcal · ${totals.protein} g protein. ${meal.estimated ? "Estimated portions and nutrition. Check the assumptions below." : "Using the nutrition values you supplied."} You can correct this proposal in chat or edit the meal in Food after saving.`,
  };
}

export function prepareDietTargets(
  next: JournalState,
  action: ActionOf<"set_diet_targets">,
): PreparedChange {
  next.nutrition.targets = action.targets;
  return {
    targets: action.targets,
    title: "Update your daily nutrition targets",
    detail:
      "These are your chosen daily targets. They are not a calculated calorie prescription.",
  };
}

export function prepareCardio(
  next: JournalState,
  action: ActionOf<"record_cardio" | "update_cardio" | "delete_cardio">,
  // The journal before this change, to warn about a likely duplicate.
  before: JournalState,
  currentDate: string,
): PreparedChange {
  if (action.kind === "delete_cardio") {
    const cardio = next.cardio.sessions.find((s) => s.id === action.cardioId);
    if (!cardio) throw Error("That activity is not in your journal.");
    next.cardio.sessions = next.cardio.sessions.filter(
      (s) => s.id !== action.cardioId,
    );
    return {
      cardio,
      title: "Delete this cardio activity",
      detail: `Removes ${cardioTitle(cardio)} on ${cardio.date}. Review the activity being removed below. Other entries are kept.`,
    };
  }
  const cardio =
    action.kind === "record_cardio"
      ? saveCardio(next, action.cardio, currentDate)
      : saveCardio(next, action.changes, currentDate, action.cardioId);
  return {
    cardio,
    title:
      action.kind === "record_cardio"
        ? "Log your cardio"
        : "Update your cardio",
    detail:
      action.kind === "record_cardio" &&
      before.cardio.sessions.some(
        (s) => s.date === cardio.date && s.activity === cardio.activity,
      )
        ? "A similar activity is already logged on this date. Review whether this is another activity before saving."
        : `${cardioTitle(cardio)} on ${cardio.date}. Check the details below. Other training, food and health entries are kept.`,
  };
}

export function prepareCheckin(
  next: JournalState,
  action: ActionOf<"record_checkin">,
  currentDate: string,
): PreparedChange {
  const checkin = saveCheckin(next, action.checkin, currentDate);
  return {
    checkin,
    title:
      action.checkin.sleepHours != null
        ? "Log your sleep"
        : "Save your daily check-in",
    detail: `Updates your check-in for ${checkin.date}. Values you haven’t changed are kept. This records how you feel without changing your workout or diet targets.`,
  };
}
