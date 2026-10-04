import {
  addDrink,
  alcoholInFood,
  alcoholKinds,
  formatLitres,
  formatTargetLitres,
  hydrationForDay,
  removeDrink,
} from "../hydration";
import {
  addSupplement,
  removeSupplement,
  supplementText,
  supplementsForDay,
} from "../supplements";
import { applyGoals, describePlan, splitGoals } from "../body-goals";
import {
  followUpGoals,
  goalsCheckClosedNote,
  goalsCheckNote,
  moveGoalsCheck,
} from "../coaching";
import { bodyFatTrend, removeBodyFat, saveBodyFat } from "../body-composition";
import { setDailyTargets, targetsProposal } from "../target-proposals";
import { sameTargets } from "../target-history";
import { offsetDate } from "../health";
import {
  mergeDietTargets,
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

export function prepareDeleteMeal(
  next: JournalState,
  action: ActionOf<"delete_meal">,
): PreparedChange {
  const meal = next.nutrition.meals.find((m) => m.id === action.mealId);
  if (!meal) throw Error("That meal is not in your food journal.");
  next.nutrition.meals = next.nutrition.meals.filter((m) => m.id !== meal.id);
  reopenFoodDays(next, meal.date);
  return {
    meal,
    title: "Delete a meal",
    detail: `Removes “${meal.name}” from ${meal.date}. Its photos stay in your library.`,
  };
}

export function prepareDrink(
  next: JournalState,
  action: ActionOf<"log_drink" | "delete_drink">,
  currentDate: string,
  mealDates: ReadonlySet<string> = new Set(),
): PreparedChange {
  const drink =
    action.kind === "log_drink"
      ? (() => {
          if (action.drink.date > currentDate)
            throw Error("Drinks cannot be dated in the future.");
          return addDrink(next, action.drink);
        })()
      : removeDrink(next, action.drinkId);
  const day = hydrationForDay(next, drink.date);
  const what = `${drink.estimated ? "about " : ""}${drink.ml} ml ${drink.name || drink.kind}`;
  // Alcohol's energy belongs in Food too, unless its meal comes with it or
  // Food already names it that day. Voice, and a drink saved on its own,
  // may log the meal next, so the line doesn't assume it is missing.
  const food =
    action.kind === "log_drink" &&
    alcoholKinds.includes(drink.kind) &&
    !mealDates.has(drink.date) &&
    !alcoholInFood(next, drink)
      ? ` ${drink.kind[0].toUpperCase()}${drink.kind.slice(1)} ${drink.kind === "spirits" ? "have" : "has"} energy too: if it isn't in Food yet, log it there as well.`
      : "";
  return {
    title: action.kind === "log_drink" ? "Log a drink" : "Remove a drink",
    detail: `${action.kind === "log_drink" ? what : `Removes ${what}`}. ${formatLitres(day.totalMl)}${day.hidden ? "" : ` of about ${formatTargetLitres(day.targetMl)}`} on ${drink.date}.${food}`,
    drink: {
      name: drink.name || drink.kind,
      ml: drink.ml,
      date: drink.date,
      ...(action.kind === "delete_drink" ? { removed: true } : {}),
      ...(drink.estimated ? { estimated: true } : {}),
      dayTotalMl: day.totalMl,
      ...(day.hidden ? {} : { dayTargetMl: day.targetMl }),
    },
  };
}

export function prepareDietTargets(
  next: JournalState,
  action: ActionOf<"set_diet_targets">,
  currentDate: string,
): PreparedChange {
  // Only the targets named change; the rest, and the goal, are kept.
  if (!Object.keys(action.targets).length)
    throw Error("Name the targets to change.");
  const before = next.nutrition.targets;
  // Recorded as the plan's when they are what it gives now, otherwise as
  // the athlete's own (setDailyTargets).
  setDailyTargets(next, mergeDietTargets(before, action.targets), currentDate);
  // New calories at a goals check that is due move it on (moveGoalsCheck).
  const calories = next.nutrition.targets.calories;
  const followUp =
    calories != null && calories > 0 && calories !== before.calories
      ? moveGoalsCheck(next, calories, currentDate)
      : null;
  return {
    targets: next.nutrition.targets,
    targetsBefore: before,
    title: "Update your daily nutrition targets",
    detail: `These are your chosen daily targets. They are not a calculated calorie prescription.${followUp ? ` Coach can check them against your weight trend with you from ${followUp.followUpDate}, about 3 weeks on.` : ""}`,
    ...(followUp ? { plan: followUp } : {}),
  };
}

// Coach's goals change: the plan, and with one that loses, gains or
// recomposes, the agreed check of the weight trend about 3 weeks on, or
// with one that no longer does, an active check closed (followUpGoals), in
// the same review.
export function prepareBodyGoals(
  next: JournalState,
  action: ActionOf<"set_body_goals">,
  currentDate: string,
): PreparedChange {
  const before = next.nutrition.targets;
  const plan = applyGoals(next, action.bodyGoals, currentDate);
  const { agreed, closed } = followUpGoals(next, plan, currentDate);
  return {
    targets: next.nutrition.targets,
    targetsBefore: before,
    title: "Set your goals",
    // A removed or changed health answer comes first, so the review and the
    // voice read-back never leave it out.
    detail: [
      ...plan.changes,
      describePlan(splitGoals(action.bodyGoals).goals, plan),
      ...plan.notes,
      ...(agreed ? [goalsCheckNote(agreed.followUpDate)] : []),
      ...(closed ? [goalsCheckClosedNote(closed.followUpDate)] : []),
    ].join(" "),
    ...(agreed ? { plan: agreed } : {}),
    ...(plan.safetyNotes.length ? { notes: plan.safetyNotes } : {}),
  };
}

export function prepareBodyFat(
  next: JournalState,
  action: ActionOf<"record_body_fat" | "delete_body_fat">,
  currentDate: string,
): PreparedChange {
  const suggested = targetsProposal(next, currentDate);
  const entry =
    action.kind === "record_body_fat"
      ? saveBodyFat(next, action.bodyFat, currentDate)
      : removeBodyFat(next, action.date);
  const trend = bodyFatTrend(next, offsetDate(entry.date, -90), entry.date);
  const change =
    action.kind === "record_body_fat" && trend && trend.readings > 1
      ? ` ${trend.change_points > 0 ? "+" : ""}${trend.change_points} points since ${trend.first.date}.`
      : "";
  // A reading never changes the daily targets; when it moves the plan
  // enough, the plan suggests new ones for the athlete to take or leave.
  const proposal = targetsProposal(next, currentDate);
  const targets =
    proposal &&
    (!suggested || !sameTargets(suggested.targets, proposal.targets))
      ? " Your daily targets stay as they are; your goals plan now suggests new ones, which you can take or leave on Today."
      : "";
  return {
    title:
      action.kind === "record_body_fat"
        ? "Record body fat"
        : "Remove a body fat reading",
    detail: `${action.kind === "record_body_fat" ? "" : "Removes "}${entry.percent}% body fat on ${entry.date}${entry.method ? ` (${entry.method})` : ""}.${change}${targets}`,
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

export function prepareSupplement(
  next: JournalState,
  action: ActionOf<"log_supplement" | "delete_supplement">,
  currentDate: string,
): PreparedChange {
  const supplement =
    action.kind === "log_supplement"
      ? (() => {
          if (action.supplement.date > currentDate)
            throw Error("Supplements cannot be dated in the future.");
          return addSupplement(next, action.supplement);
        })()
      : removeSupplement(next, action.supplementId);
  const taken = supplementsForDay(next, supplement.date).taken;
  const what = supplementText(supplement);
  return {
    title:
      action.kind === "log_supplement"
        ? "Log a supplement"
        : "Remove a supplement",
    detail: `${action.kind === "log_supplement" ? what : `Removes ${what}`}. Taken on ${supplement.date}: ${taken.map(supplementText).join(", ") || "nothing"}.`,
  };
}
